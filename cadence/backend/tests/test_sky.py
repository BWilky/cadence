from datetime import UTC, datetime, timedelta

from cadence.engine.sky import SkyClassifier
from cadence.models import SkyConfig


def t(minutes=0):
    return datetime(2026, 9, 22, 12, 0, tzinfo=UTC) + timedelta(minutes=minutes)


def test_basic_thresholds():
    c = SkyClassifier(SkyConfig(dark_lux=30, sunny_lux=400, min_dwell_minutes=0))
    assert c.classify(t(), 500, 0, 30).state == "sunny"
    assert c.classify(t(), 200, 0, 30).state == "cloudy"
    assert c.classify(t(), 10, 0, 30).state == "dark"


def test_sun_below_horizon_is_dark_regardless_of_lux():
    c = SkyClassifier(SkyConfig())
    r = c.classify(t(), 5000, 0, -6)
    assert r.state == "dark"
    assert "sun" in r.reason


def test_hysteresis_prevents_flapping_around_sunny_threshold():
    c = SkyClassifier(SkyConfig(sunny_lux=400, hysteresis_pct=15, min_dwell_minutes=0))
    assert c.classify(t(), 500, 0, 40).state == "sunny"
    # 380 is below 400 but within the 15% band -> stay sunny
    assert c.classify(t(1), 380, 0, 40).state == "sunny"
    # 330 is below 400*(1-0.15)=340 -> cloudy
    assert c.classify(t(2), 330, 0, 40).state == "cloudy"
    # back up to 420: above 400 but below 460 -> stay cloudy
    assert c.classify(t(3), 420, 0, 40).state == "cloudy"
    assert c.classify(t(4), 470, 0, 40).state == "sunny"


def test_dwell_holds_state():
    c = SkyClassifier(SkyConfig(min_dwell_minutes=10, hysteresis_pct=0))
    assert c.classify(t(0), 500, 0, 40).state == "sunny"
    r = c.classify(t(2), 100, 0, 40)
    assert r.state == "sunny" and "dwell" in r.reason
    assert c.classify(t(11), 100, 0, 40).state == "cloudy"


def test_stale_lux_falls_back_to_sun():
    c = SkyClassifier(SkyConfig(stale_minutes=30))
    r = c.classify(t(), 5, 3600, 40)  # lux says dark but is an hour old
    assert r.state == "sunny"
    assert r.lux is None
