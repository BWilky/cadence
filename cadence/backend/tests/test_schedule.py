from datetime import date, datetime
from zoneinfo import ZoneInfo

from cadence.engine.schedule import auto_windows_for, latest_before, next_after, resolve_day, window_active
from cadence.engine.suntimes import Sun
from cadence.models import Chapter, ChapterOverride, ChapterStart, DayPlan, Settings, Template, TimeWindow, Variant, WeeklySchedule

TZ = ZoneInfo("America/Vancouver")
SUN = Sun(49.4078, -123.4509, "America/Vancouver")
DAY = date(2026, 9, 22)


def tmpl():
    return Template(
        id="t",
        name="t",
        chapters=[
            Chapter(id="a", name="A", start=ChapterStart(kind="clock", time="06:45"), variants=[Variant(key="x", label="x")]),
            Chapter(id="b", name="B", start=ChapterStart(kind="sun", sun_event="elevation", elevation=-5, direction="setting", latest="21:30")),
            Chapter(id="c", name="C", start=ChapterStart(kind="asleep", earliest="21:00", latest="01:00")),
            Chapter(id="d", name="D", start=ChapterStart(kind="sun", sun_event="sunset", offset_minutes=20)),
        ],
    )


def test_resolve_orders_and_computes_sun():
    res = resolve_day(DAY, tmpl(), None, Settings(), TZ, SUN)
    ids = [r.chapter_id for r in res]
    assert ids[0] == "a"
    b = next(r for r in res if r.chapter_id == "b")
    d = next(r for r in res if r.chapter_id == "d")
    c = next(r for r in res if r.chapter_id == "c")
    assert b.start is not None and d.start is not None
    sunset = SUN.event(DAY, "sunset")
    assert datetime.fromisoformat(b.start) > sunset  # -5° is after sunset
    assert abs((datetime.fromisoformat(d.start) - sunset).total_seconds() - 1200) < 1
    assert c.start is None and c.pending_condition
    assert c.nominal.endswith("21:00:00-07:00")


def test_overrides_change_start_and_force_variant():
    plan = DayPlan(
        date=DAY.isoformat(), chapter_overrides=[ChapterOverride(chapter_id="a", start=ChapterStart(kind="clock", time="08:00"), variant_key="x")]
    )
    res = resolve_day(DAY, tmpl(), plan, Settings(), TZ, SUN)
    a = next(r for r in res if r.chapter_id == "a")
    assert a.start.endswith("08:00:00-07:00")
    assert a.forced_variant == "x"


def test_latest_before_and_next_after():
    res = resolve_day(DAY, tmpl(), None, Settings(), TZ, SUN)
    now = datetime(2026, 9, 22, 12, 0, tzinfo=TZ)
    assert latest_before(res, now).chapter_id == "a"
    nxt = next_after(res, now)
    assert nxt.chapter_id == "d"  # sunset+20 comes before -5°
    early = datetime(2026, 9, 22, 3, 0, tzinfo=TZ)
    assert latest_before(res, early) is None


def test_window_active_wraps_midnight():
    w = [TimeWindow(start="22:00", end="02:00")]
    assert window_active(w, datetime(2026, 9, 22, 23, 0, tzinfo=TZ))
    assert window_active(w, datetime(2026, 9, 22, 1, 0, tzinfo=TZ))
    assert not window_active(w, datetime(2026, 9, 22, 12, 0, tzinfo=TZ))


def test_auto_windows_plan_override():
    s = Settings(auto_schedule=WeeklySchedule(windows={"1": [TimeWindow(start="06:00", end="22:00")]}))
    assert auto_windows_for(DAY, s, None) == ("windows", s.auto_schedule.windows["1"])  # 2026-09-22 is a Tuesday
    assert auto_windows_for(DAY, s, DayPlan(date=DAY.isoformat(), auto="off"))[0] == "off"
    m, w = auto_windows_for(DAY, s, DayPlan(date=DAY.isoformat(), auto="windows", auto_windows=[TimeWindow(start="09:00", end="10:00")]))
    assert m == "windows" and w[0].start == "09:00"
