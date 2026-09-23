"""Executes Cadence Scenes against Home Assistant — or only pretends to, in dry-run mode."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable
from typing import Any

from ..ha.client import HAClient
from ..models import CadenceScene, HAAction, MusicAction
from ..store import Store

log = logging.getLogger(__name__)


class Executor:
    def __init__(self, ha: HAClient, store: Store, is_dry_run: Callable[[], bool], emit: Callable[[dict], Any]) -> None:
        self.ha = ha
        self.store = store
        self.is_dry_run = is_dry_run
        self.emit = emit
        self._fades: dict[str, asyncio.Task] = {}
        self._delayed: set[asyncio.Task] = set()

    # ------------------------------------------------------------------ plumbing
    def _log(self, level: str, message: str, detail: dict | None = None) -> None:
        entry = self.store.log(level, "action", message, detail)
        self.emit({"type": "log", "entry": entry})

    async def call(self, domain: str, service: str, target: dict | None = None, data: dict | None = None) -> bool:
        desc = f"{domain}.{service} {target or ''} {data or ''}".strip()
        if self.is_dry_run():
            self._log("info", f"DRY RUN — would call {desc}", {"domain": domain, "service": service, "target": target, "data": data})
            return True
        try:
            await self.ha.call_service(domain, service, target=target, data=data)
            self._log("info", f"called {desc}", {"domain": domain, "service": service, "target": target, "data": data})
            return True
        except Exception as exc:  # noqa: BLE001
            self._log("error", f"failed {desc}: {exc}", {"domain": domain, "service": service, "error": str(exc)})
            return False

    # ------------------------------------------------------------------ scenes
    async def apply_scene(self, scene: CadenceScene, *, entering_chapter: bool, music_only_on_entry: bool) -> list[str]:
        """Fire every HA scene + action in a Cadence Scene. Returns the LED entities expected to light."""
        leds: list[str] = []
        for link in scene.ha_scenes:
            data = {"transition": link.transition} if link.transition is not None else None
            await self.call("scene", "turn_on", target={"entity_id": link.entity_id}, data=data)
            if link.led_entity:
                leds.append(link.led_entity)
        for extra in scene.extra_actions:
            await self.run_extra(extra)
        for m in scene.music:
            if not entering_chapter and music_only_on_entry and m.kind in ("play_playlist", "play", "pause", "stop"):
                continue
            self.schedule_music(m)
        return leds

    async def run_extra(self, action: HAAction) -> None:
        await self.call(action.domain, action.service, target=action.target, data=action.data)

    # ------------------------------------------------------------------ music
    def schedule_music(self, m: MusicAction) -> None:
        if m.delay_seconds and m.delay_seconds > 0:
            t = asyncio.create_task(self._delayed_music(m))
            self._delayed.add(t)
            t.add_done_callback(self._delayed.discard)
        else:
            asyncio.create_task(self.run_music(m))

    async def _delayed_music(self, m: MusicAction) -> None:
        await asyncio.sleep(m.delay_seconds)
        await self.run_music(m)

    async def run_music(self, m: MusicAction) -> None:
        eid = m.entity_id
        tgt = {"entity_id": eid}
        if m.kind == "volume_fade":
            start = 0.0 if m.from_zero else m.from_volume
            if m.from_zero:
                await self.call("media_player", "volume_set", tgt, {"volume_level": 0.0})
            self.start_fade(eid, start, m.volume if m.volume is not None else 0.0, m.minutes or 0)
        elif m.kind == "spotify_context":
            data: dict[str, Any] = {"entity_id": eid, "context_uri": m.media_content_id}
            if m.device:
                data["device_id"] = m.device
            if m.shuffle is not None:
                data["shuffle"] = m.shuffle
            # SpotifyPlus services take entity_id as a data field rather than a target.
            await self.call("spotifyplus", "player_media_play_context", None, data)
        elif m.kind == "volume_set":
            self.cancel_fade(eid)
            await self.call("media_player", "volume_set", tgt, {"volume_level": m.volume if m.volume is not None else 0.0})
        elif m.kind == "mute":
            await self.call("media_player", "volume_mute", tgt, {"is_volume_muted": True})
        elif m.kind == "unmute":
            await self.call("media_player", "volume_mute", tgt, {"is_volume_muted": False})
        elif m.kind == "source":
            await self.call("media_player", "select_source", tgt, {"source": m.source})
        elif m.kind == "play_playlist":
            data: dict[str, Any] = {
                "media_content_id": m.media_content_id,
                "media_content_type": m.media_content_type or "playlist",
            }
            if m.enqueue:
                data["enqueue"] = m.enqueue
            if m.shuffle is not None:
                await self.call("media_player", "shuffle_set", tgt, {"shuffle": m.shuffle})
            await self.call("media_player", "play_media", tgt, data)
        elif m.kind == "play":
            await self.call("media_player", "media_play", tgt)
        elif m.kind == "pause":
            await self.call("media_player", "media_pause", tgt)
        elif m.kind == "stop":
            await self.call("media_player", "media_stop", tgt)
        elif m.kind == "service" and m.service:
            domain, _, service = m.service.partition(".")
            await self.call(domain, service, tgt, m.data)

    def start_fade(self, entity_id: str, from_vol: float | None, to_vol: float, minutes: float) -> None:
        self.cancel_fade(entity_id)
        self._fades[entity_id] = asyncio.create_task(self._fade(entity_id, from_vol, to_vol, minutes))

    def cancel_fade(self, entity_id: str) -> None:
        t = self._fades.pop(entity_id, None)
        if t and not t.done():
            t.cancel()

    def cancel_all_fades(self) -> None:
        for eid in list(self._fades):
            self.cancel_fade(eid)

    @property
    def active_fades(self) -> list[str]:
        return [e for e, t in self._fades.items() if not t.done()]

    async def _fade(self, entity_id: str, from_vol: float | None, to_vol: float, minutes: float) -> None:
        start = from_vol
        if start is None:
            cur = self.ha.attr(entity_id, "volume_level")
            start = float(cur) if cur is not None else 0.0
        to_vol = max(0.0, min(1.0, to_vol))
        total_s = max(0.0, minutes * 60.0)
        if total_s <= 1 or abs(to_vol - start) < 0.005:
            await self.call("media_player", "volume_set", {"entity_id": entity_id}, {"volume_level": round(to_vol, 3)})
            return
        # One step per 1% of range, but never faster than every 3s and never more than ~200 steps.
        steps = int(min(200, max(1, abs(to_vol - start) * 100)))
        interval = max(3.0, total_s / steps)
        steps = max(1, int(total_s / interval))
        self._log(
            "info",
            f"fade {entity_id} {start:.2f} → {to_vol:.2f} over {minutes:g} min ({steps} steps)",
            {"entity_id": entity_id, "from": start, "to": to_vol, "minutes": minutes},
        )
        try:
            for i in range(1, steps + 1):
                await asyncio.sleep(interval)
                level = start + (to_vol - start) * (i / steps)
                # Quiet: fades log only at the end; individual volume_set calls go to debug.
                if self.is_dry_run():
                    log.debug("DRY RUN fade %s -> %.3f", entity_id, level)
                else:
                    with contextlib.suppress(Exception):
                        await self.ha.call_service(
                            "media_player", "volume_set", target={"entity_id": entity_id}, data={"volume_level": round(level, 3)}
                        )
            self._log("info", f"fade complete {entity_id} at {to_vol:.2f}", {"entity_id": entity_id})
        except asyncio.CancelledError:
            self._log("info", f"fade cancelled {entity_id}", {"entity_id": entity_id})
            raise
