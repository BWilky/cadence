"""Mirror the engine status into Home Assistant as two state-only entities.

    sensor.cadence_status   state: auto | hold | off | idle
                            attributes: everything the Lovelace card needs to draw the day
    sensor.cadence_chapter  state: the current chapter's name (or "none")

Dashboards read these like any other entity, so every Home Assistant account can see what
Cadence is doing (guests and non-admin tablets included; the ingress API is admin-only).

Only fields that change at chapter / variant / mode boundaries are published. Raw lux, motion
timestamps and fade progress are left out on purpose: each post with new attributes is a new
row in the recorder, and the engine ticks every few seconds.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Any

from ..models import EngineStatus, TimeWindow

log = logging.getLogger(__name__)

STATUS_ENTITY = "sensor.cadence_status"
CHAPTER_ENTITY = "sensor.cadence_chapter"
COMMAND_EVENT = "cadence_command"


def status_state(st: EngineStatus) -> str:
    if not st.auto_active:
        return "off"
    if st.hold.active:
        return "hold"
    if not st.chapter:
        return "idle"
    return "auto"


def build_entities(
    st: EngineStatus,
    *,
    version: str,
    auto_mode: str,
    auto_windows: list[TimeWindow],
    auto_source: str,
    auto_entity: str | None = None,
    show: dict | None = None,
) -> dict[str, tuple[str, dict[str, Any]]]:
    """{entity_id: (state, attributes)} for the current status."""
    ch = st.chapter or None
    nxt = st.next_chapter or None
    timeline = [
        {
            "id": r.chapter_id,
            "name": r.name,
            "color": r.color,
            "kind": r.kind,
            "start": r.start,
            "nominal": r.nominal,
            "pending": r.pending_condition,
            "enabled": r.enabled,
            "fade": r.fade_minutes,
            "held_by": r.held_by,
            "forced": r.forced_variant,
            "variants": [{"key": v.get("key"), "label": v.get("label")} for v in r.variants],
        }
        for r in st.timeline
    ]
    state = status_state(st)
    attrs: dict[str, Any] = {
        "friendly_name": "Cadence",
        "icon": {"auto": "mdi:robot-outline", "hold": "mdi:hand-back-left-outline", "off": "mdi:robot-off-outline"}.get(state, "mdi:movie-open-play"),
        "version": version,
        "date": st.date,
        "timezone": st.timezone,
        "dry_run": st.dry_run,
        "ha_connected": st.ha_connected,
        "auto_active": st.auto_active,
        "auto_reason": st.auto_reason,
        "auto_override": st.auto_override,
        "auto_mode": auto_mode,
        "auto_source": auto_source,
        "auto_entity": auto_entity,
        "auto_windows": [{"start": w.start, "end": w.end} for w in auto_windows],
        "template": st.template_name,
        "template_kind": st.template_kind,
        "template_reason": st.template_reason,
        "chapter": (
            {"id": ch.get("id"), "name": ch.get("name"), "color": ch.get("color"), "start": ch.get("start"), "kind": ch.get("kind")} if ch else None
        ),
        "variant": st.variant,
        "scenes": [sc.get("name") for sc in st.scenes],
        "next": ({"id": nxt.get("id"), "name": nxt.get("name"), "at": nxt.get("at"), "pending": nxt.get("pending_condition")} if nxt else None),
        "hold": st.hold.model_dump(),
        "chapter_hold": (
            {"chapter": st.chapter_hold.get("chapter_id"), "label": st.chapter_hold.get("label"), "until": st.chapter_hold.get("until")}
            if st.chapter_hold
            else None
        ),
        "carry_over": st.carry_over.model_dump() if st.carry_over else None,
        "sky": (st.sky or {}).get("state"),
        "weather": (st.sky or {}).get("weather"),
        "motion": (st.motion or {}).get("active"),
        "occupied": st.occupied,
        "occupied_reason": st.occupied_reason,
        "asleep": st.asleep,
        "sunrise": (st.sun or {}).get("sunrise"),
        "sunset": (st.sun or {}).get("sunset"),
        "timeline": timeline,
        "show": show,
    }
    chapter_attrs: dict[str, Any] = {
        "friendly_name": "Cadence chapter",
        "icon": "mdi:book-open-page-variant-outline",
        "chapter_id": ch.get("id") if ch else None,
        "color": ch.get("color") if ch else None,
        "since": ch.get("start") if ch else None,
        "variant": (st.variant or {}).get("label"),
        "next": nxt.get("name") if nxt else None,
        "next_at": nxt.get("at") if nxt else None,
        "auto_active": st.auto_active,
        "template": st.template_name,
    }
    return {
        STATUS_ENTITY: (state, attrs),
        CHAPTER_ENTITY: ((ch.get("name") or "none") if ch else "none", chapter_attrs),
    }


class Publisher:
    """Posts entity states to Home Assistant, skipping posts that would change nothing."""

    def __init__(self, ha: Any) -> None:
        self.ha = ha
        self._last: dict[str, tuple[str, dict]] = {}
        self._want: dict[str, tuple[str, dict]] = {}
        self._task: asyncio.Task | None = None

    def reset(self) -> None:
        """Forget what was posted (Home Assistant restarted or the connection dropped)."""
        self._last.clear()

    def update(self, entities: dict[str, tuple[str, dict]]) -> None:
        self._want.update(entities)
        if any(self._last.get(k) != v for k, v in self._want.items()) and (self._task is None or self._task.done()):
            self._task = asyncio.create_task(self._flush(), name="cadence-publish")

    async def _flush(self) -> None:
        # Loop until what we want has been posted: updates arriving mid-flush are picked up here.
        for _ in range(5):
            todo = {k: v for k, v in self._want.items() if self._last.get(k) != v}
            if not todo:
                return
            for eid, (state, attrs) in todo.items():
                try:
                    await self.ha.set_state(eid, state, attrs)
                    self._last[eid] = (state, attrs)
                except Exception as exc:  # noqa: BLE001 — never let publishing break the engine
                    log.warning("could not publish %s: %s", eid, exc)
                    return

    async def mark_unavailable(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task
        for eid, (_, attrs) in list(self._last.items()):
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self.ha.set_state(eid, "unavailable", {k: attrs.get(k) for k in ("friendly_name", "icon")}), 3)
        self._last.clear()
