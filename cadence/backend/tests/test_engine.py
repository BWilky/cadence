from __future__ import annotations

import time
from datetime import datetime
from zoneinfo import ZoneInfo

from cadence.engine.engine import KIND_SCENE, KIND_SETTINGS
from cadence.models import CadenceScene, SceneLink, Settings, TimeWindow, WeeklySchedule

TZ = ZoneInfo("America/Vancouver")


def _configure(engine, fake_ha, *, auto_always=True):
    s = engine.settings()
    s.sky.lux_entity = "sensor.lux"
    s.motion_entity = "binary_sensor.motion"
    s.auto_source = "always" if auto_always else "schedule"
    s.auto_schedule = WeeklySchedule(windows={str(d): [TimeWindow(start="00:00", end="00:00")] for d in range(7)})
    engine.save_settings(s)
    # Give the starter scenes real HA scene links + LEDs so we can watch them.
    for sid, scene, led in [
        ("day_sunny", "scene.day_sunny", "switch.led_day_sunny"),
        ("day_cloudy", "scene.day_cloudy", "switch.led_day_cloudy"),
        ("evening_dark", "scene.evening", "switch.led_evening"),
    ]:
        sc = CadenceScene(**engine.store.get(KIND_SCENE, sid))
        sc.ha_scenes = [SceneLink(entity_id=scene, led_entity=led)]
        engine.store.put(KIND_SCENE, sid, sc.model_dump())


def _freeze(engine, when: datetime):
    engine.now = lambda: when  # type: ignore[method-assign]


async def test_tick_applies_current_chapter_and_variant(engine, fake_ha):
    _configure(engine, fake_ha)
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))  # Daytime (08:30) with lux 500 -> sunny
    await engine.tick()
    st = engine.last_status
    assert st.chapter["name"] == "Daytime"
    assert st.variant["key"] == "sunny"
    assert ("scene", "turn_on", {"entity_id": "scene.day_sunny"}, None) in fake_ha.calls
    assert engine.applied["chapter_id"] == "daytime_am"
    # second tick with nothing changed: no new calls
    n = len(fake_ha.calls)
    await engine.tick()
    assert len(fake_ha.calls) == n


async def test_variant_reevaluates_when_sky_changes(engine, fake_ha):
    _configure(engine, fake_ha)
    s = engine.settings()
    s.sky.min_dwell_minutes = 0
    engine.save_settings(s)
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    await engine.tick()
    fake_ha.set("sensor.lux", "100")
    _freeze(engine, datetime(2026, 9, 22, 9, 20, tzinfo=TZ))
    await engine.tick()
    assert engine.last_status.variant["key"] == "cloudy"
    assert ("scene", "turn_on", {"entity_id": "scene.day_cloudy"}, None) in fake_ha.calls


async def test_dry_run_makes_no_calls(engine, fake_ha):
    _configure(engine, fake_ha)
    s = engine.settings()
    s.dry_run = True
    engine.save_settings(s)
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    await engine.tick()
    assert fake_ha.calls == []
    assert engine.last_status.dry_run is True
    assert any("DRY RUN" in e["message"] for e in engine.store.recent_log())


async def test_manual_led_change_starts_hold_until_next_chapter(engine, fake_ha):
    _configure(engine, fake_ha)
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    await engine.tick()
    # Our LED lights as expected inside the grace window.
    await fake_ha.fire("switch.led_day_sunny", "on")
    assert "switch.led_day_sunny" in engine.active_leds
    assert not engine.hold.active
    # Later, someone presses Evening on a keypad: a foreign LED comes on.
    for k in list(engine.expected_leds):
        engine.expected_leds[k] = (engine.expected_leds[k][0], time.time() - 1)
    await fake_ha.fire("switch.led_evening", "on")
    assert engine.hold.active
    assert "led_evening" in engine.hold.reason
    # While held, a sky change must not re-apply.
    n = len(fake_ha.calls)
    fake_ha.set("sensor.lux", "50")
    _freeze(engine, datetime(2026, 9, 22, 9, 30, tzinfo=TZ))
    await engine.tick()
    assert len(fake_ha.calls) == n
    # Next chapter boundary releases the hold and applies again.
    _freeze(engine, datetime(2026, 9, 22, 11, 46, tzinfo=TZ))
    await engine.tick()
    assert not engine.hold.active
    assert engine.last_status.chapter["name"] == "Daytime Meal"


async def test_auto_off_outside_schedule(engine, fake_ha):
    _configure(engine, fake_ha, auto_always=False)
    s = engine.settings()
    s.auto_schedule = WeeklySchedule(windows={"1": [TimeWindow(start="10:00", end="12:00")]})
    engine.save_settings(s)
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    await engine.tick()
    assert not engine.last_status.auto_active
    assert fake_ha.calls == []
    _freeze(engine, datetime(2026, 9, 22, 10, 30, tzinfo=TZ))
    await engine.tick()
    assert engine.last_status.auto_active
    assert fake_ha.calls


async def test_asleep_chapter_waits_then_triggers(engine, fake_ha):
    _configure(engine, fake_ha)
    s = engine.settings()
    s.asleep_entity = "binary_sensor.asleep"
    engine.save_settings(s)
    fake_ha.set("binary_sensor.asleep", "off")
    fake_ha.set("sun.sun", "below_horizon", elevation=-20.0)
    _freeze(engine, datetime(2026, 9, 22, 22, 0, tzinfo=TZ))
    await engine.tick()
    assert engine.last_status.chapter["name"] == "Late Night Crowd"
    nxt = engine.last_status.next_chapter
    assert nxt["name"] == "Nightlight" and nxt["pending_condition"]
    fake_ha.set("binary_sensor.asleep", "on")
    _freeze(engine, datetime(2026, 9, 22, 22, 5, tzinfo=TZ))
    await engine.tick()
    assert engine.last_status.chapter["name"] == "Nightlight"
    assert engine.last_status.variant["key"] == "quiet"


async def test_carry_over_from_previous_day(engine, fake_ha):
    _configure(engine, fake_ha)
    # Remove the 00:00 chapter so early morning has nothing started today.
    from cadence.engine.engine import KIND_TEMPLATE
    from cadence.models import Template

    t = Template(**engine.store.get(KIND_TEMPLATE, "standard_day"))
    t.chapters = [c for c in t.chapters if c.id != "nightlight_early"]
    engine.store.put(KIND_TEMPLATE, "standard_day", t.model_dump())
    fake_ha.set("sun.sun", "below_horizon", elevation=-30.0)
    _freeze(engine, datetime(2026, 9, 22, 3, 0, tzinfo=TZ))
    await engine.tick()
    # Yesterday's last started chapter is Late Night Crowd (sun kind, always resolves).
    assert engine.last_status.chapter["name"] == "Late Night Crowd"


def test_settings_roundtrip(store):
    s = Settings(site_name="X")
    store.put(KIND_SETTINGS, "main", s.model_dump())
    assert Settings(**store.get(KIND_SETTINGS, "main")).site_name == "X"


async def test_day_only_chapter_is_applied(engine, fake_ha):
    from cadence.engine.engine import KIND_PLAN
    from cadence.models import Chapter, ChapterStart, DayPlan, Variant

    _configure(engine, fake_ha)
    extra = Chapter(
        id="pop_up",
        name="Pop-up event",
        start=ChapterStart(kind="clock", time="09:30"),
        variants=[Variant(key="on", label="On", scene_ids=["evening_dark"])],
    )
    engine.store.put(KIND_PLAN, "2026-09-22", DayPlan(date="2026-09-22", extra_chapters=[extra]).model_dump())
    _freeze(engine, datetime(2026, 9, 22, 9, 45, tzinfo=TZ))
    await engine.tick()
    assert engine.last_status.chapter["name"] == "Pop-up event"
    assert ("scene", "turn_on", {"entity_id": "scene.evening"}, None) in fake_ha.calls
    row = next(r for r in engine.last_status.timeline if r.chapter_id == "pop_up")
    assert row.source == "day"


async def test_spotify_context_and_fade_from_zero(engine, fake_ha):
    from cadence.models import MusicAction

    _configure(engine, fake_ha)
    fake_ha.set("media_player.bose", "on", volume_level=0.5)
    await engine.exec.run_music(
        MusicAction(kind="spotify_context", entity_id="media_player.sp", media_content_id="spotify:playlist:abc", device="Dining Room", shuffle=True)
    )
    assert (
        "spotifyplus",
        "player_media_play_context",
        None,
        {"entity_id": "media_player.sp", "context_uri": "spotify:playlist:abc", "device_id": "Dining Room", "shuffle": True},
    ) in fake_ha.calls
    await engine.exec.run_music(MusicAction(kind="volume_fade", entity_id="media_player.bose", volume=0.3, minutes=0, from_zero=True))
    # from_zero drops the zone to 0 before ramping; a 0-minute fade jumps straight to the target
    import asyncio

    await asyncio.sleep(0.05)
    vols = [d["volume_level"] for (dom, svc, tgt, d) in fake_ha.calls if svc == "volume_set" and tgt == {"entity_id": "media_player.bose"}]
    assert vols[:2] == [0.0, 0.3]
