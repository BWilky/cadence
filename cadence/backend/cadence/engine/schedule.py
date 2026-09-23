"""Turn a Template + DayPlan into concrete chapter start times for one date."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from ..models import (
    Chapter,
    ChapterOverride,
    ChapterStart,
    DayPlan,
    ResolvedChapter,
    Settings,
    Template,
    TimeWindow,
)
from .suntimes import Sun


def parse_hhmm(s: str) -> time:
    h, m = s.split(":")
    return time(int(h), int(m))


def at(day: date, hhmm: str, tz: ZoneInfo) -> datetime:
    return datetime.combine(day, parse_hhmm(hhmm), tzinfo=tz)


def apply_overrides(chapters: list[Chapter], overrides: list[ChapterOverride]) -> list[tuple[Chapter, str | None]]:
    """Return (chapter with overridden start/enabled, forced_variant) pairs."""
    by_id = {o.chapter_id: o for o in overrides}
    out: list[tuple[Chapter, str | None]] = []
    for ch in chapters:
        o = by_id.get(ch.id)
        if not o:
            out.append((ch, None))
            continue
        c = ch.model_copy(deep=True)
        if o.start is not None:
            c.start = o.start
        if o.enabled is not None:
            c.enabled = o.enabled
        out.append((c, o.variant_key))
    return out


def resolve_start(start: ChapterStart, day: date, tz: ZoneInfo, sun: Sun | None) -> tuple[datetime | None, datetime]:
    """Return (concrete start or None if it waits on a condition, nominal ordering time)."""
    if start.kind == "clock":
        t = at(day, start.time or "00:00", tz)
        return t, t
    if start.kind == "sun":
        t = None
        if sun:
            t = sun.resolve(day, start.sun_event, start.elevation, start.direction, start.offset_minutes)
        if t is None:
            # No sun crossing today (high latitude) — fall back to latest, then earliest, then noon.
            fb = start.latest or start.earliest or "12:00"
            t = at(day, fb, tz)
        return t, t
    # motion / asleep: armed at `earliest`, guaranteed by `latest`
    nominal = at(day, start.earliest or start.latest or "00:00", tz)
    return None, nominal


def resolve_day(
    day: date,
    template: Template | None,
    plan: DayPlan | None,
    settings: Settings,
    tz: ZoneInfo,
    sun: Sun | None,
) -> list[ResolvedChapter]:
    base = list(template.chapters) if template else []
    extras = list(plan.extra_chapters) if plan else []
    if not base and not extras:
        return []
    extra_ids = {c.id for c in extras}
    pairs = apply_overrides(base + extras, plan.chapter_overrides if plan else [])
    out: list[ResolvedChapter] = []
    for ch, forced in pairs:
        start, nominal = resolve_start(ch.start, day, tz, sun)
        out.append(
            ResolvedChapter(
                chapter_id=ch.id,
                name=ch.name,
                kind=ch.start.kind,
                start=start.isoformat() if start else None,
                nominal=nominal.isoformat(),
                pending_condition=start is None,
                fade_minutes=ch.fade_minutes,
                color=ch.color,
                variants=[v.model_dump() for v in ch.variants],
                forced_variant=forced,
                enabled=ch.enabled,
                note=ch.note,
                source="day" if ch.id in extra_ids else "template",
            )
        )
    out.sort(key=lambda r: r.nominal)
    return out


def window_active(windows: list[TimeWindow], now: datetime) -> bool:
    t = now.time()
    for w in windows:
        s, e = parse_hhmm(w.start), parse_hhmm(w.end)
        if s < e:
            if s <= t < e:
                return True
        else:  # wraps midnight (or start == end -> whole day)
            if t >= s or t < e:
                return True
    return False


def auto_windows_for(day: date, settings: Settings, plan: DayPlan | None) -> tuple[str, list[TimeWindow]]:
    """Return (mode, windows) for the date. mode: on | off | windows."""
    if plan and plan.auto == "on":
        return "on", []
    if plan and plan.auto == "off":
        return "off", []
    if plan and plan.auto == "windows":
        return "windows", plan.auto_windows
    wins = settings.auto_schedule.windows.get(str(day.weekday()), [])
    return "windows", wins


def latest_before(chapters: list[ResolvedChapter], now: datetime) -> ResolvedChapter | None:
    cur = None
    for r in chapters:
        if not r.enabled or r.start is None:
            continue
        if datetime.fromisoformat(r.start) <= now:
            cur = r
    return cur


def next_after(chapters: list[ResolvedChapter], now: datetime) -> ResolvedChapter | None:
    # An armed motion/asleep chapter that is waiting for its condition is "next" — it can start any moment.
    for r in chapters:
        if r.enabled and r.pending_condition and datetime.fromisoformat(r.nominal) <= now:
            return r
    for r in chapters:
        if not r.enabled:
            continue
        ref = datetime.fromisoformat(r.start or r.nominal)
        if ref > now:
            return r
    return None


def midnight(day: date, tz: ZoneInfo) -> datetime:
    return datetime.combine(day, time(0, 0), tzinfo=tz)


def add_days(day: date, n: int) -> date:
    return day + timedelta(days=n)
