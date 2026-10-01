from __future__ import annotations

from datetime import date

from cadence.engine.rules import describe_condition, in_window, match_rule
from cadence.migrate import migrate_settings
from cadence.models import RuleCondition, Settings, TemplateRule
from cadence.store import Store


def test_in_window_absolute_recurring_and_wrapping():
    assert in_window(date(2026, 6, 15), "2026-06-01", "2026-08-31")
    assert not in_window(date(2026, 9, 1), "2026-06-01", "2026-08-31")
    assert in_window(date(2027, 7, 4), "06-01", "08-31")  # recurs every year
    assert in_window(date(2026, 12, 25), "11-15", "02-10") and in_window(date(2027, 1, 20), "11-15", "02-10")
    assert not in_window(date(2026, 6, 1), "11-15", "02-10")
    assert in_window(date(2026, 1, 1), None, None)
    assert in_window(date(2026, 3, 1), "2026-03-01", None) and not in_window(date(2026, 2, 28), "2026-03-01", None)


def _ev(summary, **kw):
    ev = {"calendar": kw.get("calendar", "calendar.a"), "summary": summary, "all_day": kw.get("all_day", True)}
    return {**ev, "location": kw.get("location"), "description": kw.get("description")}


def test_calendar_condition_variants():
    d = date(2026, 6, 14)
    events = [_ev("Arrow Camp Week"), _ev("Yoga", calendar="calendar.b", all_day=False, location="Lounge")]
    contains = TemplateRule(id="r", name="r", conditions=[RuleCondition(kind="calendar", terms=["camp"])])
    assert match_rule(contains, d, events) == (True, "calendar: Arrow Camp Week")
    exact = TemplateRule(id="r", name="r", conditions=[RuleCondition(kind="calendar", match="exact", terms=["arrow camp"])])
    assert match_rule(exact, d, events)[0] is False
    regex = TemplateRule(id="r", name="r", conditions=[RuleCondition(kind="calendar", match="regex", terms=[r"^arrow\s+camp"])])
    assert match_rule(regex, d, events)[0] is True
    c = RuleCondition(kind="calendar", calendars=["calendar.b"], all_day=False, field="location", terms=["lounge"])
    only_b_timed = TemplateRule(id="r", name="r", conditions=[c])
    assert match_rule(only_b_timed, d, events)[0] is True
    any_event = TemplateRule(id="r", name="r", conditions=[RuleCondition(kind="calendar")])
    assert match_rule(any_event, d, [])[0] is False and match_rule(any_event, d, events)[0] is True
    none_today = TemplateRule(id="r", name="r", conditions=[RuleCondition(kind="calendar", negate=True)])
    assert match_rule(none_today, d, []) == (True, "no matching event") and match_rule(none_today, d, events)[0] is False
    assert match_rule(contains, d, None)[0] is None  # calendar not loaded: undecided


def test_weekday_date_range_window_and_disabled():
    sat = date(2026, 9, 26)
    r = TemplateRule(id="r", name="r", conditions=[RuleCondition(kind="weekday", weekdays=[5, 6])])
    assert match_rule(r, sat, [])[0] is True and match_rule(r, date(2026, 9, 22), [])[0] is False
    r = TemplateRule(id="r", name="r", conditions=[RuleCondition(kind="date_range", start="09-20", end="09-30", negate=True)])
    assert match_rule(r, sat, [])[0] is False
    r = TemplateRule(id="r", name="r", valid_from="2026-10-01")
    assert match_rule(r, sat, []) == (False, "outside validity window")
    r = TemplateRule(id="r", name="r", enabled=False)
    assert match_rule(r, sat, [])[0] is False
    assert match_rule(TemplateRule(id="r", name="r"), sat, []) == (True, "every day")


def test_live_conditions():
    d = date(2026, 9, 22)
    states = {"input_boolean.occ": "on", "group:lounge": "off"}
    numbers = {"sensor.wifi_clients": 23.0}
    ent = TemplateRule(id="r", name="r", conditions=[RuleCondition(kind="entity", entity_id="input_boolean.occ")])
    assert match_rule(ent, d, [], states.get, numbers.get) == (True, "input_boolean.occ is on")
    assert match_rule(ent, d, [])[0] is None  # no sensors offered: only decidable on the day
    grp = TemplateRule(id="r", name="r", conditions=[RuleCondition(kind="entity", entity_id="group:lounge", state="off")])
    assert match_rule(grp, d, [], states.get, numbers.get)[0] is True
    num = TemplateRule(id="r", name="r", conditions=[RuleCondition(kind="numeric", entity_id="sensor.wifi_clients", above=20)])
    assert match_rule(num, d, [], states.get, numbers.get) == (True, "sensor.wifi_clients = 23")
    num_hi = TemplateRule(id="r", name="r", conditions=[RuleCondition(kind="numeric", entity_id="sensor.wifi_clients", above=20, below=22)])
    assert match_rule(num_hi, d, [], states.get, numbers.get)[0] is False
    missing = TemplateRule(id="r", name="r", conditions=[RuleCondition(kind="numeric", entity_id="sensor.nope", above=1)])
    assert match_rule(missing, d, [], states.get, numbers.get)[0] is None
    assert ent.live and not TemplateRule(id="r", name="r", conditions=[RuleCondition(kind="weekday")]).live


def test_describe_condition():
    assert describe_condition(RuleCondition(kind="calendar", terms=["camp", "retreat"])) == "calendar summary contains camp, retreat"
    assert describe_condition(RuleCondition(kind="weekday", weekdays=[5, 6])) == "Sat, Sun"
    assert describe_condition(RuleCondition(kind="numeric", entity_id="sensor.w", above=10, negate=True)) == "not sensor.w > 10"


def test_migration_turns_occupancy_evidence_into_rules(tmp_path):
    store = Store(tmp_path / "m.db")
    try:
        store.put(
            "settings",
            "main",
            {
                "default_template_id": "standard_day",
                "vacant_template_id": "vacant",
                "calendars": ["calendar.bookings"],
                "calendar_keywords": ["retreat", "camp"],
                "occupied_entity": "input_boolean.occ",
                "site_name": "X",
            },
        )
        assert migrate_settings(store) is True
        s = Settings(**store.get("settings", "main"))
        assert s.schema_version == 1 and s.default_template_id == "vacant" and s.site_name == "X"
        assert [r.id for r in s.rules] == ["guests_on_calendar", "occupied_sensor"]
        assert s.rules[0].template_id == "standard_day" and s.rules[0].conditions[0].terms == ["retreat", "camp"] and s.rules[0].set_occupied
        assert s.rules[1].conditions[0].entity_id == "input_boolean.occ"
        assert migrate_settings(store) is False  # idempotent
    finally:
        store.close()


def test_migration_without_evidence_sources_keeps_default(tmp_path):
    store = Store(tmp_path / "m.db")
    try:
        store.put("settings", "main", {"default_template_id": "standard_day", "calendar_keywords": ["x"]})
        migrate_settings(store)
        s = Settings(**store.get("settings", "main"))
        assert s.default_template_id == "standard_day" and s.rules == []
    finally:
        store.close()
