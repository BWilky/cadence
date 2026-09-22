"""Sunny / Cloudy / Dark classification with hysteresis and dwell time."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ..models import SkyConfig, SkyState


@dataclass
class SkyReading:
    state: SkyState
    lux: float | None
    lux_age_s: float | None
    elevation: float | None
    reason: str
    changed_at: datetime | None = None


@dataclass
class SkyClassifier:
    cfg: SkyConfig
    state: SkyState | None = None
    changed_at: datetime | None = None
    history: list[tuple[datetime, SkyState]] = field(default_factory=list)

    def classify(
        self,
        now: datetime,
        lux: float | None,
        lux_age_s: float | None,
        elevation: float | None,
    ) -> SkyReading:
        cfg = self.cfg
        lux_ok = lux is not None and (lux_age_s is None or lux_age_s <= cfg.stale_minutes * 60)
        h = cfg.hysteresis_pct / 100.0
        prev = self.state

        # 1. Dark from the sun: authoritative when the sun is well below the horizon.
        if elevation is not None and elevation < cfg.dark_elevation:
            new: SkyState = "dark"
            reason = f"sun {elevation:.1f}° below {cfg.dark_elevation:g}°"
        elif lux_ok:
            assert lux is not None
            # 2. Lux with hysteresis: thresholds move depending on where we currently are.
            dark_up = cfg.dark_lux * (1 + h)
            dark_down = cfg.dark_lux * (1 - h)
            sunny_up = cfg.sunny_lux * (1 + h)
            sunny_down = cfg.sunny_lux * (1 - h)
            if prev == "dark":
                new = "dark" if lux < dark_up else ("sunny" if lux >= sunny_up else "cloudy")
            elif prev == "sunny":
                new = "sunny" if lux >= sunny_down else ("dark" if lux < dark_down else "cloudy")
            elif prev == "cloudy":
                new = "sunny" if lux >= sunny_up else ("dark" if lux < dark_down else "cloudy")
            else:
                new = "dark" if lux < cfg.dark_lux else ("sunny" if lux >= cfg.sunny_lux else "cloudy")
            reason = f"lux {lux:.0f}"
        elif elevation is not None:
            # 3. No usable lux: sun-only. Low sun counts as cloudy-ish light, high sun as sunny.
            new = "cloudy" if elevation < 15 else "sunny"
            reason = f"no lux; sun {elevation:.1f}°"
        else:
            new = prev or "cloudy"
            reason = "no sensors"

        # 4. Dwell: don't bounce sunny<->cloudy faster than min_dwell.
        if prev is not None and new != prev and {prev, new} == {"sunny", "cloudy"} and self.changed_at:
            if now - self.changed_at < timedelta(minutes=cfg.min_dwell_minutes):
                new = prev
                reason += " (dwell)"

        if new != prev:
            self.state = new
            self.changed_at = now
            self.history.append((now, new))
            self.history = self.history[-50:]
        return SkyReading(new, lux if lux_ok else None, lux_age_s, elevation, reason, self.changed_at)
