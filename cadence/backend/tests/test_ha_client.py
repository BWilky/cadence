"""Exercise HAClient against a tiny fake Home Assistant WebSocket server."""

from __future__ import annotations

import asyncio
import json

import pytest
from aiohttp import web

from cadence.ha.client import HAClient


async def _fake_ha(app_calls: list) -> web.Application:
    async def ws_handler(request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.send_json({"type": "auth_required", "ha_version": "2026.8.2"})
        msg = await ws.receive_json()
        if msg.get("access_token") != "secret":
            await ws.send_json({"type": "auth_invalid", "message": "bad token"})
            await ws.close()
            return ws
        await ws.send_json({"type": "auth_ok", "ha_version": "2026.8.2"})
        request.app["sockets"].append(ws)
        async for m in ws:
            if m.type != web.WSMsgType.TEXT:
                break
            data = json.loads(m.data)
            mid, mtype = data["id"], data["type"]
            if mtype == "get_config":
                await ws.send_json(
                    {
                        "id": mid,
                        "type": "result",
                        "success": True,
                        "result": {"time_zone": "America/Vancouver", "latitude": 49.4, "longitude": -123.4},
                    }
                )
            elif mtype == "get_states":
                await ws.send_json(
                    {
                        "id": mid,
                        "type": "result",
                        "success": True,
                        "result": [{"entity_id": "switch.led", "state": "off", "attributes": {"friendly_name": "LED"}}],
                    }
                )
            elif mtype == "subscribe_events":
                await ws.send_json({"id": mid, "type": "result", "success": True, "result": None})
            elif mtype == "call_service":
                app_calls.append(data)
                res = {"context": {"id": "ctx"}}
                if data.get("return_response"):
                    res["response"] = {"calendar.x": {"events": []}}
                await ws.send_json({"id": mid, "type": "result", "success": True, "result": res})
            else:
                await ws.send_json({"id": mid, "type": "result", "success": False, "error": {"code": "unknown_command", "message": mtype}})
        return ws

    app = web.Application()
    app["sockets"] = []
    app.router.add_get("/api/websocket", ws_handler)
    return app


@pytest.fixture
async def fake_server(aiohttp_unused_port):
    calls: list = []
    app = await _fake_ha(calls)
    port = aiohttp_unused_port()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", port)
    await site.start()
    yield app, port, calls
    await runner.cleanup()


@pytest.fixture
def aiohttp_unused_port():
    import socket

    def _get() -> int:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]

    return _get


async def test_client_bootstraps_and_tracks_state(fake_server):
    app, port, calls = fake_server
    client = HAClient(f"ws://127.0.0.1:{port}/api/websocket", "secret")
    seen: list[tuple] = []
    client.on_state(lambda eid, old, new: seen.append((eid, old and old["state"], new and new["state"])))
    conns: list[bool] = []
    client.on_connection(conns.append)
    client.start()
    try:
        await asyncio.wait_for(client.connected.wait(), 5)
        assert client.config["time_zone"] == "America/Vancouver"
        assert client.state("switch.led") == "off"
        assert conns == [True]

        # A state_changed event pushed by "HA" updates the cache and notifies listeners.
        ws = app["sockets"][0]
        await ws.send_json(
            {
                "type": "event",
                "event": {
                    "event_type": "state_changed",
                    "data": {
                        "entity_id": "switch.led",
                        "old_state": {"entity_id": "switch.led", "state": "off", "attributes": {}},
                        "new_state": {"entity_id": "switch.led", "state": "on", "attributes": {}},
                    },
                },
            }
        )
        for _ in range(50):
            if seen:
                break
            await asyncio.sleep(0.02)
        assert seen == [("switch.led", "off", "on")]
        assert client.is_on("switch.led") is True

        # Service calls round-trip, including return_response.
        await client.call_service("scene", "turn_on", target={"entity_id": "scene.x"})
        res = await client.call_service(
            "calendar", "get_events", target={"entity_id": ["calendar.x"]}, data={"start_date_time": "a"}, return_response=True
        )
        assert res["response"]["calendar.x"] == {"events": []}
        assert calls[0]["domain"] == "scene" and calls[0]["target"] == {"entity_id": "scene.x"}
        assert calls[1]["return_response"] is True and calls[1]["service_data"] == {"start_date_time": "a"}
    finally:
        await client.stop()


async def test_client_rejects_bad_token(fake_server):
    _, port, _ = fake_server
    client = HAClient(f"ws://127.0.0.1:{port}/api/websocket", "wrong")
    client.start()
    try:
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(client.connected.wait(), 0.8)
    finally:
        await client.stop()
