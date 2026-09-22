"""Live feed for the planner and tablet: status snapshots, zone brightness, log lines."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

log = logging.getLogger(__name__)


class Broadcaster:
    def __init__(self) -> None:
        self._queues: set[asyncio.Queue] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    def emit(self, msg: dict) -> None:
        for q in list(self._queues):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                # Slow consumer — drop the oldest to make room for the newest state.
                with contextlib.suppress(asyncio.QueueEmpty):
                    q.get_nowait()
                with contextlib.suppress(asyncio.QueueFull):
                    q.put_nowait(msg)

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._queues.discard(q)

    @property
    def clients(self) -> int:
        return len(self._queues)


async def serve(ws: WebSocket, bc: Broadcaster, initial: Any) -> None:
    await ws.accept()
    q = bc.subscribe()
    try:
        if initial is not None:
            await ws.send_json({"type": "status", "status": initial})

        async def reader() -> None:
            while True:
                msg = await ws.receive_json()
                if msg.get("type") == "ping":
                    await ws.send_json({"type": "pong"})

        rtask = asyncio.create_task(reader())
        try:
            while True:
                msg = await q.get()
                await ws.send_json(msg)
        finally:
            rtask.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await rtask
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        bc.unsubscribe(q)
