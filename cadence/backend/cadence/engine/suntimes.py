"""Sun geometry for chapter starts, using astral with Home Assistant's location."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from astral import LocationInfo, SunDirection
from astral.location import Location
from astral.sun import time_at_elevation


class Sun:
    def __init__(self, latitude: float, longitude: float, tz: str, elevation_m: float = 0.0) -> None:
        self.tz = ZoneInfo(tz)
        self.loc = Location(LocationInfo("site", "site", tz, latitude, longitude))
        self.loc.observer.elevation = elevation_m

    def event(self, day: date, name: str) -> datetime | None:
        try:
            if name == "sunrise":
                return self.loc.sunrise(day, local=True)
            if name == "sunset":
                return self.loc.sunset(day, local=True)
            if name == "dawn":
                return self.loc.dawn(day, local=True)
            if name == "dusk":
                return self.loc.dusk(day, local=True)
        except ValueError:
            return None
        return None

    def at_elevation(self, day: date, elevation: float, direction: str) -> datetime | None:
        d = SunDirection.RISING if direction == "rising" else SunDirection.SETTING
        try:
            t = time_at_elevation(self.loc.observer, elevation, day, d, tzinfo=self.tz)
        except ValueError:
            return None
        # astral may hand back the previous/next day's crossing for polar-ish cases; keep same day
        if t.date() != day:
            t = t.replace(year=day.year, month=day.month, day=day.day)
        return t

    def elevation_now(self, when: datetime) -> float:
        return self.loc.solar_elevation(when)

    def resolve(self, day: date, sun_event: str | None, elevation: float | None, direction: str, offset_min: int):
        if sun_event == "elevation" or (sun_event is None and elevation is not None):
            base = self.at_elevation(day, elevation if elevation is not None else 0.0, direction)
        else:
            base = self.event(day, sun_event or "sunset")
        if base is None:
            return None
        return base + timedelta(minutes=offset_min)
