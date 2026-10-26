"""sensor.cadence_status / sensor.cadence_chapter and the cadence_command event."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime

from cadence.engine.publish import CHAPTER_ENTITY, STATUS_ENTITY

from .test_engine import TZ, _configure, _freeze


async def _settle():
    # The publisher posts from a background task.
    for _ in range(5):
        await asyncio.sleep(0)


def _last(fake_ha, eid):
    return next(p for p in reversed(fake_ha.posted) if p[0] == eid)


async def test_status_entities_published(engine, fake_ha):
    _configure(engine, fake_ha)
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    await engine.tick()
    await _settle()
    _, state, attrs = _last(fake_ha, STATUS_ENTITY)
    assert state == "auto"
    assert attrs["auto_active"] is True
    assert attrs["chapter"]["name"] == "Daytime"
    assert attrs["variant"]["key"] == "sunny"
    assert attrs["next"]["name"]
    assert attrs["timeline"] and {"id", "name", "start", "variants"} <= set(attrs["timeline"][0])
    assert attrs["auto_mode"] == "windows" and attrs["auto_windows"] == [{"start": "00:00", "end": "00:00"}]
    json.dumps(attrs)  # must be JSON-serialisable for the REST API
    assert len(json.dumps(attrs)) < 16000  # recorder skips attributes over 16 kB
    _, chapter, _ = _last(fake_ha, CHAPTER_ENTITY)
    assert chapter == "Daytime"


async def test_unchanged_status_is_not_reposted(engine, fake_ha):
    _configure(engine, fake_ha)
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    await engine.tick()
    await _settle()
    n = len(fake_ha.posted)
    fake_ha.set("sensor.lux", "520")  # lux wobble inside the same sky state
    _freeze(engine, datetime(2026, 9, 22, 9, 1, tzinfo=TZ))
    await engine.tick()
    await _settle()
    assert len(fake_ha.posted) == n
    # A reconnect forgets what was posted, so the entities come back after a Home Assistant restart.
    engine._on_connection(True)
    await engine.tick()
    await _settle()
    assert len(fake_ha.posted) == n + 2


async def test_auto_command_turns_auto_off_and_back(engine, fake_ha):
    _configure(engine, fake_ha)
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    assert await engine.handle_command({"command": "auto", "mode": "off"})
    await engine.tick()
    await _settle()
    _, state, attrs = _last(fake_ha, STATUS_ENTITY)
    assert state == "off" and attrs["auto_override"] == "off"
    assert await engine.handle_command({"command": "auto", "mode": "schedule"})
    await engine.tick()
    await _settle()
    assert _last(fake_ha, STATUS_ENTITY)[1] == "auto"
    assert not await engine.handle_command({"command": "auto", "mode": "sideways"})


async def test_apply_resume_and_show_commands(engine, fake_ha):
    _configure(engine, fake_ha)
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    await engine.tick()
    engine.hold.active = True
    assert await engine.handle_command({"command": "resume"})
    assert not engine.hold.active
    first = engine.last_status.timeline[0]
    assert await engine.handle_command({"command": "apply", "chapter_id": first.chapter_id})
    assert engine.applied["chapter_id"] == first.chapter_id
    assert await engine.handle_command({"command": "show", "tab": "today", "screens": "tablets"})
    await engine.tick()
    await _settle()
    show = _last(fake_ha, STATUS_ENTITY)[2]["show"]
    assert show["tab"] == "today" and show["screens"] == "tablets" and show["at"]
    assert not await engine.handle_command({"command": "dance"})


async def test_command_event_runs_off_the_reader(engine, fake_ha):
    _configure(engine, fake_ha)
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    for cb in fake_ha._events["cadence_command"]:
        cb({"event_type": "cadence_command", "data": {"command": "auto", "mode": "on"}, "context": {"user_id": "abc"}})
    await _settle()
    assert engine.auto_override == "on"
