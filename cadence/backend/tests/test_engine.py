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


def _hold_template(engine):
    from cadence.engine.engine import KIND_TEMPLATE
    from cadence.models import Chapter, ChapterHold, ChapterStart, Template, Variant

    t = Template(
        id="standard_day",
        name="Hold day",
        chapters=[
            Chapter(
                id="night",
                name="Nightlight",
                start=ChapterStart(kind="clock", time="00:00"),
                variants=[Variant(key="q", label="Quiet", scene_ids=["nightlight_quiet"])],
            ),
            Chapter(
                id="day",
                name="Daytime",
                start=ChapterStart(kind="clock", time="08:30"),
                variants=[Variant(key="s", label="Sunny", scene_ids=["day_sunny"])],
            ),
            Chapter(
                id="late",
                name="Late Night Crowd",
                start=ChapterStart(kind="clock", time="20:00"),
                hold=ChapterHold(entity_id="binary_sensor.lounge", while_state="on", latest="01:30"),
                variants=[Variant(key="on", label="On", scene_ids=["evening_dark"])],
            ),
            Chapter(
                id="wind",
                name="Wind down",
                start=ChapterStart(kind="clock", time="22:00"),
                variants=[Variant(key="c", label="Cloudy", scene_ids=["day_cloudy"])],
            ),
        ],
    )
    engine.store.put(KIND_TEMPLATE, "standard_day", t.model_dump())


async def test_chapter_hold_defers_next_until_sensor_clears(engine, fake_ha):
    _configure(engine, fake_ha)
    _hold_template(engine)
    fake_ha.set("binary_sensor.lounge", "on")
    _freeze(engine, datetime(2026, 9, 22, 22, 30, tzinfo=TZ))
    await engine.tick()
    st = engine.last_status
    assert st.chapter["name"] == "Late Night Crowd"
    assert st.next_chapter["name"] == "Wind down" and st.next_chapter["pending_condition"]
    held = next(r for r in st.timeline if r.chapter_id == "wind")
    assert held.held_by == "Late Night Crowd" and held.start is None
    assert st.chapter_hold and st.chapter_hold["entity_id"] == "binary_sensor.lounge"
    assert st.chapter_hold["until"].startswith("2026-09-23T01:30")
    # Lounge empties → Wind down starts right away, at the release time.
    fake_ha.set("binary_sensor.lounge", "off")
    _freeze(engine, datetime(2026, 9, 22, 22, 40, tzinfo=TZ))
    await engine.tick()
    st = engine.last_status
    assert st.chapter["name"] == "Wind down"
    assert st.chapter["start"].startswith("2026-09-22T22:40")
    assert st.chapter_hold is None
    assert ("scene", "turn_on", {"entity_id": "scene.day_cloudy"}, None) in fake_ha.calls


async def test_chapter_hold_carries_past_midnight_then_hard_end(engine, fake_ha):
    _configure(engine, fake_ha)
    _hold_template(engine)
    fake_ha.set("binary_sensor.lounge", "on")
    fake_ha.set("sun.sun", "below_horizon", elevation=-30.0)
    # 00:30 the next morning: yesterday's Late Night Crowd still holds; today's Nightlight waits.
    _freeze(engine, datetime(2026, 9, 23, 0, 30, tzinfo=TZ))
    await engine.tick()
    st = engine.last_status
    assert st.chapter["name"] == "Late Night Crowd"
    night = next(r for r in st.timeline if r.chapter_id == "night")
    assert night.held_by == "Late Night Crowd"
    assert st.carry_over and st.carry_over.name == "Late Night Crowd"
    # 01:35: hard end passed even though the lounge is still occupied → Nightlight starts at 01:30.
    _freeze(engine, datetime(2026, 9, 23, 1, 35, tzinfo=TZ))
    await engine.tick()
    st = engine.last_status
    assert st.chapter["name"] == "Nightlight"
    assert st.chapter["start"].startswith("2026-09-23T01:30")


async def test_sensor_start_kind(engine, fake_ha):
    from cadence.engine.engine import KIND_TEMPLATE
    from cadence.models import Chapter, ChapterStart, Template, Variant

    _configure(engine, fake_ha)
    t = Template(
        id="standard_day",
        name="Sensor day",
        chapters=[
            Chapter(
                id="night",
                name="Nightlight",
                start=ChapterStart(kind="clock", time="00:00"),
                variants=[Variant(key="q", label="Quiet", scene_ids=["nightlight_quiet"])],
            ),
            Chapter(
                id="coffee",
                name="Coffee Bar",
                start=ChapterStart(kind="sensor", entity_id="binary_sensor.occ", to_state="on", earliest="06:00", latest="06:45"),
                variants=[Variant(key="l", label="Light", scene_ids=["day_sunny"])],
            ),
        ],
    )
    engine.store.put(KIND_TEMPLATE, "standard_day", t.model_dump())
    fake_ha.set("binary_sensor.occ", "off", _age_s=3600)
    _freeze(engine, datetime(2026, 9, 22, 6, 10, tzinfo=TZ))
    await engine.tick()
    assert engine.last_status.chapter["name"] == "Nightlight"
    assert engine.last_status.next_chapter["name"] == "Coffee Bar" and engine.last_status.next_chapter["pending_condition"]
    fake_ha.set("binary_sensor.occ", "on")
    _freeze(engine, datetime(2026, 9, 22, 6, 20, tzinfo=TZ))
    await engine.tick()
    assert engine.last_status.chapter["name"] == "Coffee Bar"
    assert engine.last_status.chapter["start"].startswith("2026-09-22T06:20")


async def test_sensor_start_hard_time_without_trigger(engine, fake_ha):
    from cadence.engine.engine import KIND_TEMPLATE
    from cadence.models import Chapter, ChapterStart, Template, Variant

    _configure(engine, fake_ha)
    t = Template(
        id="standard_day",
        name="Sensor day",
        chapters=[
            Chapter(
                id="night",
                name="Nightlight",
                start=ChapterStart(kind="clock", time="00:00"),
                variants=[Variant(key="q", label="Quiet", scene_ids=["nightlight_quiet"])],
            ),
            Chapter(
                id="coffee",
                name="Coffee Bar",
                start=ChapterStart(kind="sensor", entity_id="binary_sensor.occ", earliest="06:00", latest="06:45"),
                variants=[Variant(key="l", label="Light", scene_ids=["day_sunny"])],
            ),
        ],
    )
    engine.store.put(KIND_TEMPLATE, "standard_day", t.model_dump())
    fake_ha.set("binary_sensor.occ", "off", _age_s=3600)
    _freeze(engine, datetime(2026, 9, 22, 6, 50, tzinfo=TZ))
    await engine.tick()
    assert engine.last_status.chapter["name"] == "Coffee Bar"
    assert engine.last_status.chapter["start"].startswith("2026-09-22T06:45")


async def test_sensor_group_reference_any_and_all(engine, fake_ha):
    from cadence.models import SensorGroup

    _configure(engine, fake_ha)
    s = engine.settings()
    s.sensor_groups = [
        SensorGroup(id="lounge", name="Lounge", entities=["binary_sensor.a", "binary_sensor.b"], mode="any"),
        SensorGroup(id="both", name="Both", entities=["binary_sensor.a", "binary_sensor.b"], mode="all"),
    ]
    engine.save_settings(s)
    fake_ha.set("binary_sensor.a", "on")
    fake_ha.set("binary_sensor.b", "off")
    assert engine._sensor_state("group:lounge") == "on"
    assert engine._sensor_state("group:both") == "off"
    assert engine._sensor_state("group:missing") is None
    assert engine._sensor_state("binary_sensor.b") == "off"
    assert engine._sensor_label("group:lounge") == "Lounge (group)"
    fake_ha.set("binary_sensor.b", "on")
    assert engine._sensor_state("group:both") == "on"


async def test_hold_on_sensor_group(engine, fake_ha):
    from cadence.engine.engine import KIND_TEMPLATE
    from cadence.models import Chapter, ChapterHold, ChapterStart, SensorGroup, Template, Variant

    _configure(engine, fake_ha)
    s = engine.settings()
    s.sensor_groups = [SensorGroup(id="lounge", name="Lounge", entities=["binary_sensor.a", "binary_sensor.b"], mode="any")]
    engine.save_settings(s)
    t = Template(
        id="standard_day",
        name="x",
        chapters=[
            Chapter(
                id="night",
                name="Nightlight",
                start=ChapterStart(kind="clock", time="00:00"),
                variants=[Variant(key="q", label="Q", scene_ids=["nightlight_quiet"])],
            ),
            Chapter(
                id="late",
                name="Late",
                start=ChapterStart(kind="clock", time="20:00"),
                hold=ChapterHold(entity_id="group:lounge", latest="01:30"),
                variants=[Variant(key="o", label="O", scene_ids=["evening_dark"])],
            ),
            Chapter(
                id="wind",
                name="Wind down",
                start=ChapterStart(kind="clock", time="22:00"),
                variants=[Variant(key="c", label="C", scene_ids=["day_cloudy"])],
            ),
        ],
    )
    engine.store.put(KIND_TEMPLATE, "standard_day", t.model_dump())
    fake_ha.set("binary_sensor.a", "off")
    fake_ha.set("binary_sensor.b", "on")
    _freeze(engine, datetime(2026, 9, 22, 22, 30, tzinfo=TZ))
    await engine.tick()
    assert engine.last_status.chapter["name"] == "Late"
    assert engine.last_status.chapter_hold["label"] == "Lounge (group)"
    held = next(r for r in engine.last_status.timeline if r.chapter_id == "wind")
    assert held.hold is None and held.held_by == "Late"
    late = next(r for r in engine.last_status.timeline if r.chapter_id == "late")
    assert late.hold["label"] == "Lounge (group)"
    fake_ha.set("binary_sensor.b", "off")
    _freeze(engine, datetime(2026, 9, 22, 22, 45, tzinfo=TZ))
    await engine.tick()
    assert engine.last_status.chapter["name"] == "Wind down"


# ----------------------------------------------------------------------------- template rules, occupancy, own chapters


def _security_template(engine, tid="vacant", name="Vacant"):
    from cadence.engine.engine import KIND_TEMPLATE
    from cadence.models import Chapter, ChapterStart, Template, Variant

    engine.store.put(
        KIND_TEMPLATE,
        tid,
        Template(
            id=tid,
            name=name,
            chapters=[
                Chapter(
                    id="security",
                    name="Security",
                    start=ChapterStart(kind="clock", time="00:00"),
                    variants=[Variant(key="on", label="On", scene_ids=["evening_dark"])],
                )
            ],
        ).model_dump(),
    )


def _rules_setup(engine, fake_ha, *, default="vacant"):
    """Default = the 'Vacant' security template (or nothing); rule 'Guests' puts Standard day on days the
    occupied sensor is on; rule 'Camp' on days with 'camp' on the calendar."""
    from cadence.models import RuleCondition, TemplateRule

    _configure(engine, fake_ha)
    _security_template(engine)
    s = engine.settings()
    s.default_template_id = default
    s.calendars = ["calendar.bookings"]
    s.rules = [
        TemplateRule(
            id="camp",
            name="Camp",
            template_id="standard_day",
            conditions=[RuleCondition(kind="calendar", terms=["camp"])],
            set_occupied=True,
            note="Camp day",
        ),
        TemplateRule(
            id="guests",
            name="Guests",
            template_id="standard_day",
            conditions=[RuleCondition(kind="entity", entity_id="input_boolean.occ", state="on")],
            set_occupied=True,
        ),
    ]
    engine.save_settings(s)
    fake_ha.set("input_boolean.occ", "off", 3600)


def _events(engine, day: str, *summaries: str):
    """Put all-day events on the fake HA calendar and drop any cached view of that day."""
    for x in summaries:
        engine.ha.add_event("calendar.bookings", day, x)
    engine.calendar_cache.pop(day, None)


async def test_unmatched_day_runs_nothing_without_default(engine, fake_ha):
    _rules_setup(engine, fake_ha, default=None)
    _events(engine, "2026-09-22")
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    await engine.tick()
    st = engine.last_status
    assert st.occupied is False and st.occupied_reason == "none"
    assert st.chapter is None and st.template_id is None and st.template_kind == "none"
    assert not [c for c in fake_ha.calls if c[0] == "scene"]


async def test_unmatched_day_runs_default(engine, fake_ha):
    _rules_setup(engine, fake_ha)
    _events(engine, "2026-09-22")
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    await engine.tick()
    st = engine.last_status
    assert st.template_id == "vacant" and st.chapter["name"] == "Security" and st.template_kind == "default"
    assert st.occupied is True and st.occupied_reason == "template"
    assert ("scene", "turn_on", {"entity_id": "scene.evening"}, None) in fake_ha.calls


async def test_sensor_rule_takes_provisional_default_and_locks(engine, fake_ha):
    _rules_setup(engine, fake_ha)
    _events(engine, "2026-09-22")
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    await engine.tick()
    assert engine.last_status.template_id == "vacant"
    views = await engine.day_views(datetime(2026, 9, 22).date(), datetime(2026, 9, 22).date())
    assert [p.rule_id for p in views[0].pending_rules] == ["guests"]  # may still take the day
    fake_ha.set("input_boolean.occ", "on")
    await engine.tick()
    st = engine.last_status
    assert st.template_id == "standard_day" and st.chapter["name"] == "Daytime" and st.template_kind == "rule"
    assert st.occupied is True and st.occupied_reason == "forced"  # the rule set occupied on the day
    plan = engine.plan(datetime(2026, 9, 22).date())
    assert plan.decision.rule_id == "guests" and plan.occupied is True
    # The sensor dropping later does not flip the day back.
    fake_ha.set("input_boolean.occ", "off")
    _freeze(engine, datetime(2026, 9, 22, 15, 0, tzinfo=TZ))
    await engine.tick()
    assert engine.last_status.template_id == "standard_day"
    views = await engine.day_views(datetime(2026, 9, 22).date(), datetime(2026, 9, 23).date())
    assert views[0].template_kind == "rule" and views[0].decided and views[0].rule_name == "Guests"
    assert views[1].template_kind == "default" and views[1].predicted and not views[1].decided


async def test_sensor_rule_ignored_after_scan_cutoff(engine, fake_ha):
    _rules_setup(engine, fake_ha)
    _events(engine, "2026-09-22")
    fake_ha.set("input_boolean.occ", "on")
    _freeze(engine, datetime(2026, 9, 22, 12, 30, tzinfo=TZ))
    await engine.tick()
    assert engine.last_status.template_id == "vacant" and engine.plan(datetime(2026, 9, 22).date()) is None
    views = await engine.day_views(datetime(2026, 9, 22).date(), datetime(2026, 9, 22).date())
    assert views[0].pending_rules == []
    s = engine.settings()
    s.rule_scan_until = "23:00"
    engine.save_settings(s)
    await engine.tick()
    assert engine.last_status.template_id == "standard_day"


async def test_calendar_rule_locks_early_and_survives_event_removal(engine, fake_ha):
    _rules_setup(engine, fake_ha)
    _events(engine, "2026-09-22", "Arrow Camp week")
    _freeze(engine, datetime(2026, 9, 22, 0, 5, tzinfo=TZ))
    await engine.tick()
    plan = engine.plan(datetime(2026, 9, 22).date())
    assert plan.decision.rule_id == "camp" and "Arrow Camp week" in plan.decision.why
    assert plan.notes == "Camp day"
    assert engine.last_status.template_reason.startswith("Camp · calendar: Arrow Camp week")
    _events(engine, "2026-09-22")  # event deleted mid-day
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    await engine.tick()
    assert engine.last_status.template_id == "standard_day" and engine.last_status.chapter["name"] == "Daytime"


async def test_rules_first_match_wins_and_conflicts_are_flagged(engine, fake_ha):
    from cadence.models import RuleCondition, TemplateRule

    _rules_setup(engine, fake_ha)
    _security_template(engine, "arrow", "Arrow")
    s = engine.settings()
    # "Arrow Camp" above "Arrow": the substring rule still matches, so it shows as a conflict.
    cal = lambda *t: [RuleCondition(kind="calendar", terms=list(t))]  # noqa: E731
    s.rules = [
        TemplateRule(id="arrow_camp", name="Arrow Camp", template_id="standard_day", conditions=cal("arrow camp")),
        TemplateRule(id="arrow", name="Arrow", template_id="arrow", conditions=cal("arrow")),
    ]
    engine.save_settings(s)
    _events(engine, "2026-09-25", "Arrow Camp")
    _events(engine, "2026-09-26", "Arrow retreat")
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    views = await engine.day_views(datetime(2026, 9, 25).date(), datetime(2026, 9, 26).date())
    assert views[0].template_id == "standard_day" and views[0].rule_name == "Arrow Camp" and views[0].predicted
    assert [c.rule_name for c in views[0].conflicts] == ["Arrow"]
    assert views[1].template_id == "arrow" and views[1].conflicts == []
    # Day of: the decision records both matches and the log carries a warning.
    _events(engine, "2026-09-22", "Arrow Camp")
    await engine.tick()
    plan = engine.plan(datetime(2026, 9, 22).date())
    assert plan.decision.rule_id == "arrow_camp" and plan.decision.matched == ["arrow_camp", "arrow"]
    assert any(e["entry"]["level"] == "warning" and "2 rules matched" in e["entry"]["message"] for e in engine.events if e.get("type") == "log")


async def test_manual_choice_beats_rule_and_reset_reopens_the_day(engine, fake_ha):
    from cadence.engine.engine import KIND_PLAN
    from cadence.models import DayPlan

    _rules_setup(engine, fake_ha)
    _events(engine, "2026-09-22", "camp")
    engine.store.put(KIND_PLAN, "2026-09-22", DayPlan(date="2026-09-22", template_id="vacant").model_dump())
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    await engine.tick()
    assert engine.last_status.template_id == "vacant" and engine.last_status.template_kind == "custom"
    assert engine.plan(datetime(2026, 9, 22).date()).decision is None  # a chosen day is never scanned
    plan = engine.plan(datetime(2026, 9, 22).date())
    plan.template_id = None
    engine.store.put(KIND_PLAN, "2026-09-22", plan.model_dump())
    await engine.tick()
    assert engine.last_status.template_kind == "rule" and engine.last_status.template_id == "standard_day"
    # Reset clears the decision; before the cutoff the rule simply takes the day again.
    engine.reset_day(datetime(2026, 9, 22).date())
    assert (engine.plan(datetime(2026, 9, 22).date()) or DayPlan(date="2026-09-22")).decision is None
    await engine.tick()
    assert engine.plan(datetime(2026, 9, 22).date()).decision.rule_id == "camp"


async def test_rule_extras_auto_and_nothing_runs(engine, fake_ha):
    from cadence.models import RuleCondition, TemplateRule

    _rules_setup(engine, fake_ha)
    s = engine.settings()
    monday = [RuleCondition(kind="weekday", weekdays=[0])]
    s.rules = [TemplateRule(id="closed", name="Closed Mondays", template_id=None, conditions=monday, auto="off", set_occupied=False)]
    engine.save_settings(s)
    _events(engine, "2026-09-21")
    _freeze(engine, datetime(2026, 9, 21, 9, 0, tzinfo=TZ))  # a Monday
    await engine.tick()
    st = engine.last_status
    assert st.template_id is None and st.chapter is None and st.template_kind == "rule"
    assert st.auto_active is False and st.occupied is False and st.occupied_reason == "forced_off"
    assert engine.plan(datetime(2026, 9, 21).date()).auto == "off"
    assert not [c for c in fake_ha.calls if c[0] == "scene"]


async def test_forced_occupied_flag_feeds_variants_only(engine, fake_ha):
    _rules_setup(engine, fake_ha)
    _events(engine, "2026-09-22")
    engine.set_occupied(datetime(2026, 9, 22).date(), True)
    _freeze(engine, datetime(2026, 9, 22, 9, 0, tzinfo=TZ))
    await engine.tick()
    st = engine.last_status
    assert st.occupied_reason == "forced" and st.template_id == "vacant"  # the flag no longer picks a template


async def test_preview_rule_lists_matching_days(engine, fake_ha):
    from cadence.models import RuleCondition, TemplateRule

    _rules_setup(engine, fake_ha)
    _events(engine, "2026-09-24", "Arrow Camp")
    conds = [RuleCondition(kind="calendar", terms=["camp"]), RuleCondition(kind="weekday", weekdays=[3, 5])]
    rule = TemplateRule(id="x", name="x", template_id="standard_day", conditions=conds)
    out = await engine.preview_rule(rule, datetime(2026, 9, 21).date(), datetime(2026, 9, 27).date())
    assert [m["date"] for m in out] == ["2026-09-24"] and not out[0]["day_of"]
    conds = [RuleCondition(kind="weekday", weekdays=[5]), RuleCondition(kind="numeric", entity_id="sensor.wifi", above=10)]
    live = TemplateRule(id="y", name="y", template_id="standard_day", conditions=conds)
    out = await engine.preview_rule(live, datetime(2026, 9, 21).date(), datetime(2026, 9, 27).date())
    assert [m["date"] for m in out] == ["2026-09-26"] and out[0]["day_of"]


async def test_detach_day_then_refine_and_copy(engine, fake_ha):
    from cadence.engine.engine import KIND_PLAN, KIND_TEMPLATE
    from cadence.models import ChapterOverride, ChapterStart, Template

    _rules_setup(engine, fake_ha, default=None)
    _events(engine, "2026-09-22", "camp")
    _events(engine, "2026-09-25")
    _events(engine, "2026-09-26")
    day = datetime(2026, 9, 22).date()
    _freeze(engine, datetime(2026, 9, 22, 7, 0, tzinfo=TZ))
    await engine.tick()  # the camp rule takes the day
    tmpl = Template(**engine.store.get(KIND_TEMPLATE, "standard_day"))
    n = len(tmpl.chapters)
    # A tweak made while still on the template is folded into the detached copy.
    plan = engine.plan(day)
    plan.chapter_overrides = [ChapterOverride(chapter_id="daytime_am", start=ChapterStart(kind="clock", time="08:00"), variant_key="cloudy")]
    engine.store.put(KIND_PLAN, "2026-09-22", plan.model_dump())

    plan = engine.detach_day(day)
    assert plan.detached and len(plan.chapters) == n
    own = next(c for c in plan.chapters if c.id == "daytime_am")
    assert own.start.time == "08:00"
    assert [o.variant_key for o in plan.chapter_overrides] == ["cloudy"]
    assert engine.detach_day(day).chapters == plan.chapters  # idempotent

    # Refine the day: move Daytime to 07:45. The template itself is untouched.
    own.start = ChapterStart(kind="clock", time="07:45")
    engine.store.put(KIND_PLAN, "2026-09-22", plan.model_dump())
    _freeze(engine, datetime(2026, 9, 22, 7, 50, tzinfo=TZ))
    await engine.tick()
    st = engine.last_status
    assert st.chapter["name"] == "Daytime" and st.variant["key"] == "cloudy" and st.template_kind == "own"
    assert all(r.source == "own" for r in st.timeline)
    assert Template(**engine.store.get(KIND_TEMPLATE, "standard_day")).chapters == tmpl.chapters

    # Paste onto two other days (which would otherwise run nothing): they get their own copies, forced occupied.
    out = engine.copy_day(day, [datetime(2026, 9, 25).date(), datetime(2026, 9, 26).date(), day])
    assert [p.date for p in out] == ["2026-09-25", "2026-09-26"]
    views = await engine.day_views(datetime(2026, 9, 25).date(), datetime(2026, 9, 26).date())
    for v in views:
        assert v.detached and v.occupied_reason == "forced" and v.template_kind == "own"
        assert next(r for r in v.chapters if r.chapter_id == "daytime_am").start.endswith("07:45:00-07:00")

    # Reset: the decision is cleared too, and before the cutoff the camp rule takes the day again.
    plan = engine.reset_day(day)
    assert plan is not None and plan.chapters is None and plan.decision is None and plan.occupied is True
    await engine.tick()
    assert engine.last_status.template_id == "standard_day" and engine.last_status.template_kind == "rule"
    assert engine.last_status.chapter["name"] == "Breakfast"
