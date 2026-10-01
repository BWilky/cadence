"""Template rules: decide which template a day runs from its calendar, the date and live sensors.

Pure functions. The engine supplies the day's calendar events and two callbacks for live sensor
state, so the same code answers "what would this rule do on June 14?" in the planner and "does it
apply right now?" in the engine tick.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from datetime import date

from ..models import RuleCondition, TemplateRule

SensorState = Callable[[str], str | None]  # entity or group:<id> -> "on" / "off" / None
Numeric = Callable[[str], float | None]


def _parse(spec: str) -> tuple[int | None, int, int]:
    """'2026-06-01' -> (2026, 6, 1); '06-01' -> (None, 6, 1)."""
    parts = spec.split("-")
    if len(parts) == 3:
        return int(parts[0]), int(parts[1]), int(parts[2])
    return None, int(parts[0]), int(parts[1])


def in_window(day: date, start: str | None, end: str | None) -> bool:
    """Inclusive date window. Either bound may be absolute (YYYY-MM-DD) or recurring (MM-DD).
    A recurring window whose end is before its start wraps the new year (Nov 15 – Feb 10)."""
    if not start and not end:
        return True
    md = (day.month, day.day)
    s = _parse(start) if start else None
    e = _parse(end) if end else None
    if s and e and s[0] is None and e[0] is None and (s[1], s[2]) > (e[1], e[2]):
        return md >= (s[1], s[2]) or md <= (e[1], e[2])
    if s:
        if s[0] is not None:
            if day < date(s[0], s[1], s[2]):
                return False
        elif md < (s[1], s[2]):
            return False
    if e:
        if e[0] is not None:
            if day > date(e[0], e[1], e[2]):
                return False
        elif md > (e[1], e[2]):
            return False
    return True


def _text_matches(cond: RuleCondition, text: str) -> bool:
    terms = [t.strip() for t in cond.terms if t and t.strip()]
    if not terms:
        return True
    low = text.lower()
    if cond.match == "contains":
        return any(t.lower() in low for t in terms)
    if cond.match == "exact":
        return any(t.lower() == low.strip() for t in terms)
    try:
        return re.search(terms[0], text, re.IGNORECASE) is not None
    except re.error:
        return False


def _calendar(cond: RuleCondition, events: list[dict] | None) -> tuple[bool, str]:
    for ev in events or []:
        if cond.calendars and ev.get("calendar") not in cond.calendars:
            continue
        if cond.all_day is not None and bool(ev.get("all_day")) != cond.all_day:
            continue
        text = ev.get(cond.field) or ""
        if _text_matches(cond, text):
            return True, f"calendar: {ev.get('summary') or text or 'event'}"
    return False, "no matching event"


def describe_condition(c: RuleCondition) -> str:
    """Short human label for the editor and the planner tooltip."""
    neg = "not " if c.negate else ""
    if c.kind == "calendar":
        terms = ", ".join(t for t in c.terms if t.strip())
        what = f"{c.field} {c.match} {terms}" if terms else "any event"
        return f"{neg}calendar {what}"
    if c.kind == "weekday":
        names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        return neg + ", ".join(names[d] for d in sorted(set(c.weekdays)) if 0 <= d <= 6)
    if c.kind == "date_range":
        return f"{neg}{c.start or '…'} – {c.end or '…'}"
    if c.kind == "entity":
        return f"{neg}{c.entity_id or '?'} is {c.state}"
    parts = []
    if c.above is not None:
        parts.append(f"> {c.above:g}")
    if c.below is not None:
        parts.append(f"< {c.below:g}")
    return f"{neg}{c.entity_id or '?'} {' and '.join(parts) or '?'}"


def eval_condition(
    cond: RuleCondition, day: date, events: list[dict] | None, sensor_state: SensorState | None, numeric: Numeric | None
) -> tuple[bool | None, str]:
    """(result, why). result None means it cannot be judged: a live sensor on another day, or missing data."""
    ok: bool | None
    why = describe_condition(cond)
    if cond.kind == "calendar":
        if events is None:
            return None, "calendar not loaded"
        ok, why = _calendar(cond, events)
    elif cond.kind == "weekday":
        ok = day.weekday() in set(cond.weekdays)
        why = day.strftime("%A")
    elif cond.kind == "date_range":
        ok = in_window(day, cond.start, cond.end)
        why = f"{'in' if ok else 'outside'} {cond.start or '…'} – {cond.end or '…'}"
    elif cond.kind == "entity":
        if sensor_state is None or not cond.entity_id:
            return None, why
        st = sensor_state(cond.entity_id)
        if st is None:
            return None, f"{cond.entity_id} unavailable"
        ok = st == cond.state
        why = f"{cond.entity_id} is {st}"
    else:  # numeric
        if numeric is None or not cond.entity_id:
            return None, why
        val = numeric(cond.entity_id)
        if val is None:
            return None, f"{cond.entity_id} has no number"
        ok = (cond.above is None or val > cond.above) and (cond.below is None or val < cond.below)
        why = f"{cond.entity_id} = {val:g}"
    if cond.negate:
        ok = not ok
        if cond.kind != "calendar":
            why = "not " + why
        else:
            why = "no matching event" if ok else why
    return ok, why


def match_rule(
    rule: TemplateRule,
    day: date,
    events: list[dict] | None,
    sensor_state: SensorState | None = None,
    numeric: Numeric | None = None,
) -> tuple[bool | None, str]:
    """Does the rule take this day? (True/False, why) or (None, why) when a condition cannot be judged
    (a live sensor on a day other than today). An enabled rule with no conditions matches every day
    in its validity window."""
    if not rule.enabled:
        return False, "disabled"
    if not in_window(day, rule.valid_from, rule.valid_until):
        return False, "outside validity window"
    whys: list[str] = []
    undecided = False
    for c in rule.conditions:
        ok, why = eval_condition(c, day, events, sensor_state, numeric)
        if ok is False:
            return False, why
        if ok is None:
            undecided = True
        whys.append(why)
    if undecided:
        return None, "; ".join(whys)
    return True, "; ".join(whys) if whys else "every day"
