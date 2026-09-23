"""Cadence domain model.

Vocabulary
----------
* **Cadence Scene** — a named look for the building. Maps to one or more Home Assistant scenes
  (RA2 phantom-button scenes, native HA scenes for WiZ bulbs, ...) plus music actions.
  Each linked HA scene may name the RA2 keypad LED switch that lights when that scene is active,
  which is how Cadence tracks fades and detects manual changes.
* **Variant** — one of the sub-looks of a chapter ("Sunny", "Cloudy", "Dark", "Motion", ...),
  chosen by a condition on the outside world. A variant activates one or more Cadence Scenes.
* **Chapter** — a block of the day with a start trigger (clock, sun, motion, asleep) and its variants.
* **Template** — a full day's ordered list of chapters.
* **DayPlan** — per-date override: a different template, tweaked chapter starts, forced variants,
  an auto-mode override.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _check_hhmm(v: str | None) -> str | None:
    if v is None or v == "":
        return None
    if not HHMM.match(v):
        raise ValueError(f"expected HH:MM, got {v!r}")
    return v


# ----------------------------------------------------------------------------- scenes


class HAAction(BaseModel):
    """A raw Home Assistant service call for anything the built-in actions don't cover."""

    domain: str
    service: str
    target: dict | None = None
    data: dict | None = None
    label: str = ""


class SceneLink(BaseModel):
    entity_id: str  # scene.kp_phantomscenes_station_day_sunny, scene.coffee_bar_wiz, ...
    led_entity: str | None = None  # switch.kp_phantomscenes_station_day_sunny — lit while active
    transition: float | None = None  # seconds, passed to scene.turn_on for HA-native scenes


MusicKind = Literal[
    "spotify_context",  # SpotifyPlus: play a playlist / album / artist context on a Spotify Connect device
    "volume_fade",  # ramp volume_level to `volume` over `minutes`
    "volume_set",
    "mute",
    "unmute",
    "source",
    "play_playlist",  # media_player.play_media with a Spotify (or other) URI
    "play",
    "pause",
    "stop",
    "service",  # arbitrary media_player service (e.g. spotifyplus.*)
]


class MusicAction(BaseModel):
    kind: MusicKind
    entity_id: str
    volume: float | None = Field(default=None, ge=0, le=1)
    from_volume: float | None = Field(default=None, ge=0, le=1)
    from_zero: bool = False  # fade: start from 0 instead of the current level
    minutes: float | None = Field(default=None, ge=0)
    label: str | None = None  # human name of the playlist / album / artist (display only)
    image: str | None = None  # cover art URL (display only)
    device: str | None = None  # spotify_context: Spotify Connect device name or id; None = active device
    source: str | None = None
    media_content_id: str | None = None
    media_content_type: str | None = "playlist"
    shuffle: bool | None = None
    enqueue: str | None = None  # "replace" by default in HA
    service: str | None = None  # for kind == service, e.g. "spotifyplus.player_media_play_context"
    data: dict | None = None
    delay_seconds: float = 0  # wait before running this action


class CadenceScene(BaseModel):
    id: str
    name: str
    description: str = ""
    color: str | None = None
    ha_scenes: list[SceneLink] = Field(default_factory=list)
    music: list[MusicAction] = Field(default_factory=list)
    extra_actions: list[HAAction] = Field(default_factory=list)
    zone_levels: dict[str, float] = Field(default_factory=dict)  # optional declared glow levels 0-100


# ----------------------------------------------------------------------------- chapters

SkyState = Literal["sunny", "cloudy", "dark"]


class VariantCondition(BaseModel):
    """All set fields must match. An empty condition always matches (use as the default)."""

    sky: list[SkyState] | None = None
    light: Literal["light", "dark"] | None = None  # light == sky in (sunny, cloudy)
    motion: bool | None = None
    asleep: bool | None = None
    occupied: bool | None = None  # calendar/occupancy flag for the day

    def is_empty(self) -> bool:
        return all(v is None for v in (self.sky, self.light, self.motion, self.asleep, self.occupied))


class Variant(BaseModel):
    key: str
    label: str
    when: VariantCondition = Field(default_factory=VariantCondition)
    scene_ids: list[str] = Field(default_factory=list)
    note: str = ""


StartKind = Literal["clock", "sun", "motion", "asleep", "sensor"]


class ChapterStart(BaseModel):
    kind: StartKind = "clock"
    time: str | None = None  # clock: HH:MM
    # sensor: start when `entity_id` reaches `to_state` (motion / asleep are presets that use the global entities)
    entity_id: str | None = None
    to_state: Literal["on", "off"] = "on"
    # sun: either an elevation crossing or a sunrise/sunset event, plus an offset
    sun_event: Literal["elevation", "sunrise", "sunset", "dawn", "dusk"] | None = None
    elevation: float | None = None
    direction: Literal["rising", "setting"] = "setting"
    offset_minutes: int = 0
    # motion / asleep / sensor: armed no earlier than `earliest`; if the condition never comes, the hard start is `latest`
    earliest: str | None = None
    latest: str | None = None

    _v_time = field_validator("time", "earliest", "latest")(classmethod(lambda cls, v: _check_hhmm(v)))


class ChapterHold(BaseModel):
    """Keep a chapter active — and the following chapters waiting — while a sensor is in a state."""

    entity_id: str
    while_state: Literal["on", "off"] = "on"
    latest: str | None = None  # hard end (HH:MM); earlier than the chapter's start means the next morning

    _v = field_validator("latest")(classmethod(lambda cls, v: _check_hhmm(v)))


class Chapter(BaseModel):
    id: str
    name: str
    note: str = ""
    color: str | None = None
    enabled: bool = True
    start: ChapterStart = Field(default_factory=ChapterStart)
    hold: ChapterHold | None = None
    fade_minutes: float = 0  # how long the RA2 fade takes; informational for the tablet
    variants: list[Variant] = Field(default_factory=list)
    motion_entity: str | None = None  # override the global motion entity for this chapter
    motion_hold_minutes: float = 5  # how long "motion" stays true after the sensor clears
    reevaluate: bool = True  # switch variant mid-chapter when the sky/motion changes
    music_only_on_entry: bool = True  # don't re-run playlist starts on a variant swap


class Template(BaseModel):
    id: str
    name: str
    description: str = ""
    chapters: list[Chapter] = Field(default_factory=list)


# ----------------------------------------------------------------------------- planning


class TimeWindow(BaseModel):
    start: str  # HH:MM
    end: str  # HH:MM ; end <= start means the window wraps past midnight

    _v = field_validator("start", "end")(classmethod(lambda cls, v: _check_hhmm(v)))


class WeeklySchedule(BaseModel):
    # keys "0".."6", Monday == 0
    windows: dict[str, list[TimeWindow]] = Field(default_factory=dict)


class ChapterOverride(BaseModel):
    chapter_id: str
    start: ChapterStart | None = None
    variant_key: str | None = None  # force this variant for the day
    enabled: bool | None = None


class DayPlan(BaseModel):
    date: str  # YYYY-MM-DD
    template_id: str | None = None
    chapter_overrides: list[ChapterOverride] = Field(default_factory=list)
    extra_chapters: list[Chapter] = Field(default_factory=list)  # chapters that exist on this date only
    auto: Literal["default", "on", "off", "windows"] = "default"
    auto_windows: list[TimeWindow] = Field(default_factory=list)
    occupied: bool | None = None  # manual occupancy flag; None -> inferred from calendar
    notes: str = ""

    @field_validator("date")
    @classmethod
    def _v_date(cls, v: str) -> str:
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            raise ValueError("expected YYYY-MM-DD")
        return v


# ----------------------------------------------------------------------------- settings


class SkyConfig(BaseModel):
    lux_entity: str | None = None
    weather_entity: str | None = None  # informational only, shown on the tablet
    dark_elevation: float = -3.0  # sun below this -> dark, regardless of lux
    dark_lux: float = 30.0  # lux below this -> dark even with the sun up
    sunny_lux: float = 400.0  # lux above this -> sunny; between dark and sunny -> cloudy
    hysteresis_pct: float = 15.0  # % band around each threshold before we flip
    min_dwell_minutes: float = 10.0  # don't flip sunny<->cloudy faster than this
    stale_minutes: float = 30.0  # lux older than this is ignored (sun-only classification)


class SensorGroup(BaseModel):
    """A named set of binary sensors, referenced by chapter starts and holds as ``group:<id>``."""

    id: str
    name: str
    entities: list[str] = Field(default_factory=list)
    mode: Literal["any", "all"] = "any"  # on when any member is on / when all members are on
    description: str = ""


class ZoneGlow(BaseModel):
    """A lit area on the tablet's building photo, driven by a real light/group entity."""

    id: str
    name: str
    entity_id: str | None = None


class Settings(BaseModel):
    default_template_id: str | None = None
    # Auto-mode gating
    auto_source: Literal["either", "schedule", "entity", "always"] = "either"
    auto_schedule: WeeklySchedule = Field(default_factory=WeeklySchedule)
    auto_entity: str | None = None  # external binary_sensor / input_boolean
    # Building senses
    motion_entity: str | None = None
    asleep_entity: str | None = None
    occupied_entity: str | None = None  # e.g. input_boolean.propertyoccupied
    sky: SkyConfig = Field(default_factory=SkyConfig)
    # Calendar overlay
    calendars: list[str] = Field(default_factory=list)
    calendar_keywords: list[str] = Field(default_factory=list)  # empty -> any event counts
    # Sensor groups for chapter starts and holds (edited in Settings, referenced as group:<id>)
    sensor_groups: list[SensorGroup] = Field(default_factory=list)
    # Music
    spotify_entity: str | None = None  # SpotifyPlus media_player used for search and context playback
    # Tablet
    zones: list[ZoneGlow] = Field(default_factory=list)
    site_name: str = "Cadence"
    # Behaviour
    dry_run: bool = False  # UI-side dry run; the add-on option is a second, stronger guard
    override_grace_seconds: int = 120  # LED changes this soon after our own apply are ours
    hold_mode: Literal["next_chapter", "timeout"] = "next_chapter"
    hold_timeout_minutes: float = 60
    tick_seconds: int = 15


# ----------------------------------------------------------------------------- runtime views


class ResolvedChapter(BaseModel):
    chapter_id: str
    name: str
    kind: StartKind
    start: str | None  # ISO datetime when known, None for un-triggered motion/asleep chapters
    nominal: str  # ISO datetime used for ordering (earliest/latest for conditional kinds)
    pending_condition: bool = False  # armed but waiting for motion/asleep
    fade_minutes: float = 0
    color: str | None = None
    variants: list[dict] = Field(default_factory=list)
    forced_variant: str | None = None
    enabled: bool = True
    note: str = ""
    source: Literal["template", "day"] = "template"
    music: list[dict] = Field(default_factory=list)  # representative music actions, for the timeline strip
    hold: dict | None = None  # {entity_id, while_state, latest} when the chapter can hold the following ones
    held_by: str | None = None  # name of the chapter currently holding this one back (today only)
    start_entity: str | None = None  # sensor kind: the entity being watched


class CarryOver(BaseModel):
    """The previous day's last chapter, still running into this day's early hours."""

    chapter_id: str
    name: str
    color: str | None = None
    until: str | None = None  # ISO datetime when this day's first chapter starts (None = still unknown)


class DayView(BaseModel):
    date: str
    template_id: str | None
    template_name: str | None
    plan: DayPlan | None
    chapters: list[ResolvedChapter]
    auto_windows: list[TimeWindow]
    auto_mode: str
    occupied: bool | None
    events: list[dict] = Field(default_factory=list)
    sunrise: str | None = None
    sunset: str | None = None
    carry_over: CarryOver | None = None


class ManualHold(BaseModel):
    active: bool = False
    since: str | None = None
    until: str | None = None
    reason: str = ""


class EngineStatus(BaseModel):
    ha_connected: bool
    dry_run: bool
    now: str
    timezone: str
    auto_active: bool
    auto_reason: str
    auto_override: Literal["none", "on", "off"] = "none"
    date: str
    template_id: str | None
    template_name: str | None
    chapter: dict | None
    variant: dict | None
    scenes: list[dict] = Field(default_factory=list)
    next_chapter: dict | None
    sky: dict
    motion: dict
    asleep: bool | None
    occupied: bool | None
    hold: ManualHold
    sun: dict
    zones: dict[str, float] = Field(default_factory=dict)  # zone id -> 0..100
    fading: list[dict] = Field(default_factory=list)
    timeline: list[ResolvedChapter] = Field(default_factory=list)
    carry_over: CarryOver | None = None
    chapter_hold: dict | None = None  # {chapter, entity_id, while_state, until} while a chapter hold is active
    last_apply: dict | None = None
