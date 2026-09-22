"""Minimal, resilient Home Assistant WebSocket client.

Keeps a live cache of all entity states, fans out state_changed events to subscribers and
exposes call_service (with return_response) for the engine. Reconnects forever with backoff.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

import aiohttp

log = logging.getLogger(__name__)

StateListener = Callable[[str, dict | None, dict | None], Awaitable[None] | None]


class HAError(RuntimeError):
    pass


class HAClient:
    def __init__(self, ws_url: str, token: str, http_url: str = "") -> None:
        self.ws_url = ws_url
        self.http_url = http_url
        self.token = token
        self.states: dict[str, dict] = {}
        self.config: dict = {}
        self.connected = asyncio.Event()
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._session: aiohttp.ClientSession | None = None
        self._msg_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._listeners: list[StateListener] = []
        self._conn_listeners: list[Callable[[bool], Any]] = []
        self._task: asyncio.Task | None = None
        self._stop = False
        self.last_event_at: float = 0.0

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        if not self._task:
            self._stop = False
            self._task = asyncio.create_task(self._run(), name="ha-client")

    async def stop(self) -> None:
        self._stop = True
        if self._ws and not self._ws.closed:
            await self._ws.close()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        if self._session:
            await self._session.close()
            self._session = None

    def on_state(self, cb: StateListener) -> None:
        self._listeners.append(cb)

    def on_connection(self, cb: Callable[[bool], Any]) -> None:
        self._conn_listeners.append(cb)

    async def _run(self) -> None:
        backoff = 1.0
        while not self._stop:
            try:
                await self._connect_and_serve()
                backoff = 1.0
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — log and retry
                log.warning("HA connection lost: %s (retry in %.0fs)", exc, backoff)
            was_connected = self.connected.is_set()
            self.connected.clear()
            if was_connected:
                # Only announce the transition, not every failed retry.
                for cb in self._conn_listeners:
                    with contextlib.suppress(Exception):
                        cb(False)
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(HAError("connection lost"))
            self._pending.clear()
            if self._stop:
                break
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)

    async def _connect_and_serve(self) -> None:
        if not self._session or self._session.closed:
            self._session = aiohttp.ClientSession()
        log.info("Connecting to Home Assistant at %s", self.ws_url)
        async with self._session.ws_connect(self.ws_url, heartbeat=30, max_msg_size=64 * 1024 * 1024) as ws:
            self._ws = ws
            first = await ws.receive_json()
            if first.get("type") != "auth_required":
                raise HAError(f"unexpected greeting {first!r}")
            await ws.send_json({"type": "auth", "access_token": self.token})
            reply = await ws.receive_json()
            if reply.get("type") != "auth_ok":
                raise HAError(f"auth failed: {reply.get('message')}")
            log.info("Authenticated with Home Assistant %s", reply.get("ha_version"))

            # Bootstrap: config, all states, then subscribe.
            reader = asyncio.create_task(self._reader(ws))
            try:
                self.config = await self._send("get_config")
                states = await self._send("get_states")
                self.states = {s["entity_id"]: s for s in states}
                await self._send("subscribe_events", event_type="state_changed")
                self.connected.set()
                self.last_event_at = time.time()
                for cb in self._conn_listeners:
                    with contextlib.suppress(Exception):
                        cb(True)
                await reader
            finally:
                if not reader.done():
                    reader.cancel()
                self._ws = None

    async def _reader(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        async for msg in ws:
            if msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                break
            if msg.type != aiohttp.WSMsgType.TEXT:
                continue
            data = msg.json()
            mtype = data.get("type")
            if mtype == "event":
                await self._handle_event(data.get("event") or {})
            elif mtype == "result":
                fut = self._pending.pop(data.get("id"), None)
                if fut and not fut.done():
                    if data.get("success"):
                        fut.set_result(data.get("result"))
                    else:
                        err = data.get("error") or {}
                        fut.set_exception(HAError(f"{err.get('code')}: {err.get('message')}"))
            elif mtype == "pong":
                pass
        raise HAError("websocket closed")

    async def _handle_event(self, event: dict) -> None:
        if event.get("event_type") != "state_changed":
            return
        self.last_event_at = time.time()
        d = event.get("data") or {}
        entity_id = d.get("entity_id")
        new = d.get("new_state")
        old = d.get("old_state")
        if not entity_id:
            return
        if new is None:
            self.states.pop(entity_id, None)
        else:
            self.states[entity_id] = new
        for cb in self._listeners:
            try:
                res = cb(entity_id, old, new)
                if asyncio.iscoroutine(res):
                    await res
            except Exception:  # noqa: BLE001
                log.exception("state listener failed for %s", entity_id)

    # ------------------------------------------------------------------ commands
    async def _send(self, msg_type: str, **kwargs: Any) -> Any:
        if not self._ws or self._ws.closed:
            raise HAError("not connected")
        self._msg_id += 1
        mid = self._msg_id
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[mid] = fut
        await self._ws.send_json({"id": mid, "type": msg_type, **kwargs})
        return await asyncio.wait_for(fut, timeout=60)

    async def call_service(
        self,
        domain: str,
        service: str,
        *,
        target: dict | None = None,
        data: dict | None = None,
        return_response: bool = False,
    ) -> Any:
        payload: dict[str, Any] = {"domain": domain, "service": service}
        if target:
            payload["target"] = target
        if data:
            payload["service_data"] = data
        if return_response:
            payload["return_response"] = True
        return await self._send("call_service", **payload)

    async def render_template(self, template: str) -> Any:
        return await self._send("render_template", template=template, report_errors=True, timeout=5)

    # ------------------------------------------------------------------ helpers
    def state(self, entity_id: str | None) -> str | None:
        if not entity_id:
            return None
        s = self.states.get(entity_id)
        return s.get("state") if s else None

    def attr(self, entity_id: str | None, name: str, default: Any = None) -> Any:
        if not entity_id:
            return default
        s = self.states.get(entity_id)
        if not s:
            return default
        return (s.get("attributes") or {}).get(name, default)

    def is_on(self, entity_id: str | None) -> bool | None:
        st = self.state(entity_id)
        if st is None or st in ("unknown", "unavailable"):
            return None
        return st == "on"

    def numeric(self, entity_id: str | None) -> float | None:
        st = self.state(entity_id)
        if st is None:
            return None
        try:
            return float(st)
        except (TypeError, ValueError):
            return None

    def entities(self, domain: str | None = None) -> list[dict]:
        out = []
        for eid, s in self.states.items():
            if domain and not eid.startswith(domain + "."):
                continue
            out.append(
                {
                    "entity_id": eid,
                    "state": s.get("state"),
                    "name": (s.get("attributes") or {}).get("friendly_name") or eid,
                    "attributes": s.get("attributes") or {},
                }
            )
        out.sort(key=lambda e: e["name"].lower())
        return out
