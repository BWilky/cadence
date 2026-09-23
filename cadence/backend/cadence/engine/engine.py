"""The Cadence engine: decides which chapter and variant the building should be in, applies it,
and watches for people changing things by hand."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from ..config import Options
from ..ha.client import HAClient
from ..models import (
    CadenceScene,
    CarryOver,
    Chapter,
    DayPlan,
    DayView,
    EngineStatus,
    ManualHold,
    ResolvedChapter,
    Settings,
    Template,
    Variant,
    VariantCondition,
)
from ..store import Store
from .actions import Executor
from .schedule import (
    add_days,
    at,
    auto_windows_for,
    hold_end,
    latest_before,
    next_after,
    resolve_day,
    window_active,
)
from .sky import SkyClassifier, SkyReading
from .suntimes import Sun

log = logging.getLogger(__name__)

KIND_SETTINGS = "settings"
KIND_SCENE = "scene"
KIND_TEMPLATE = "template"
KIND_PLAN = "plan"
KIND_RUNTIME = "runtime"


class Engine:
    def __init__(self, ha: HAClient, store: Store, opts: Options, emit: Callable[[dict], Any]) -> None:
        self.ha = ha
        self.store = store
        self.opts = opts
        self.emit = emit
        self.exec = Executor(ha, store, self.is_dry_run, emit)
        self.tz = ZoneInfo("UTC")
        self.sun: Sun | None = None
        self.sky = SkyClassifier(Settings().sky)
        self.sky_reading: SkyReading | None = None
        self._wake = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._stop = False
        self._lock = asyncio.Lock()

        # Runtime state (persisted lightly so a restart doesn't re-fire the current chapter)
        rt = store.get(KIND_RUNTIME, "state") or {}
        self.applied: dict | None = rt.get("applied")  # {date, chapter_id, variant_key, at}
        self.hold = ManualHold(**rt.get("hold", {})) if rt.get("hold") else ManualHold()
        self.auto_override: str = rt.get("auto_override", "none")
        self.auto_override_date: str | None = rt.get("auto_override_date")
        self.triggered: dict[str, str] = rt.get("triggered", {})  # "date|chapter_id" -> ISO start
        self.released: dict[str, str] = rt.get("released", {})  # "date|chapter_id" -> ISO time a chapter hold let go
        self.active_hold: dict | None = None
        self.motion_last_on: dict[str, float] = {}
        self.expected_leds: dict[str, tuple[str, float]] = {}  # led -> (state, grace_until_ts)
        self.active_leds: set[str] = set()
        self.last_status: EngineStatus | None = None
        self.calendar_cache: dict[str, tuple[float, list[dict]]] = {}
        self.ha.on_state(self._on_state)
        self.ha.on_connection(self._on_connection)

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        self._task = asyncio.create_task(self.run(), name="cadence-engine")

    async def stop(self) -> None:
        self._stop = True
        self._wake.set()
        self.exec.cancel_all_fades()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    def wake(self) -> None:
        self._wake.set()

    def _persist_runtime(self) -> None:
        self.store.put(
            KIND_RUNTIME,
            "state",
            {
                "applied": self.applied,
                "hold": self.hold.model_dump(),
                "auto_override": self.auto_override,
                "auto_override_date": self.auto_override_date,
                "triggered": self.triggered,
                "released": self.released,
            },
        )

    def _log(self, level: str, kind: str, message: str, detail: dict | None = None) -> None:
        entry = self.store.log(level, kind, message, detail)
        self.emit({"type": "log", "entry": entry})
        getattr(log, level if level != "warn" else "warning", log.info)("%s: %s", kind, message)

    # ------------------------------------------------------------------ config access
    def settings(self) -> Settings:
        raw = self.store.get(KIND_SETTINGS, "main")
        return Settings(**raw) if raw else Settings()

    def save_settings(self, s: Settings) -> None:
        self.store.put(KIND_SETTINGS, "main", s.model_dump())
        self.sky.cfg = s.sky
        self.wake()

    def scenes(self) -> dict[str, CadenceScene]:
        return {d["id"]: CadenceScene(**d) for d in self.store.list(KIND_SCENE)}

    def templates(self) -> dict[str, Template]:
        return {d["id"]: Template(**d) for d in self.store.list(KIND_TEMPLATE)}

    def plan(self, day: date) -> DayPlan | None:
        raw = self.store.get(KIND_PLAN, day.isoformat())
        return DayPlan(**raw) if raw else None

    def is_dry_run(self) -> bool:
        return bool(self.opts.dry_run or self.settings().dry_run)

    def now(self) -> datetime:
        return datetime.now(self.tz)

    # ------------------------------------------------------------------ HA events
    def _on_connection(self, up: bool) -> None:
        if up:
            cfg = self.ha.config or {}
            tzname = cfg.get("time_zone") or "UTC"
            try:
                self.tz = ZoneInfo(tzname)
            except Exception:  # noqa: BLE001
                self.tz = ZoneInfo("UTC")
            lat, lon = cfg.get("latitude"), cfg.get("longitude")
            if lat is not None and lon is not None:
                self.sun = Sun(float(lat), float(lon), tzname, float(cfg.get("elevation") or 0))
            self._log("info", "system", f"Connected to Home Assistant ({tzname}, {lat}, {lon})")
        else:
            self._log("warning", "system", "Lost connection to Home Assistant")
        self.wake()

    async def _on_state(self, entity_id: str, old: dict | None, new: dict | None) -> None:
        s = self.settings()
        watched = {s.sky.lux_entity, s.motion_entity, s.asleep_entity, s.auto_entity, s.occupied_entity, "sun.sun"}
        for ch in self._current_template_chapters() + self._chapters_for(add_days(self.now().date(), -1)):
            if ch.motion_entity:
                watched.add(ch.motion_entity)
            if ch.start.kind == "sensor" and ch.start.entity_id:
                watched.add(ch.start.entity_id)
            if ch.hold:
                watched.add(ch.hold.entity_id)
        if entity_id in self.expected_leds or entity_id in self._all_led_entities():
            self._check_led(entity_id, old, new)
            self.wake()
            return
        if entity_id in watched:
            if new and new.get("state") == "on" and (entity_id == s.motion_entity or self._is_chapter_motion(entity_id)):
                self.motion_last_on[entity_id] = time.time()
            self.wake()
            return
        if any(z.entity_id == entity_id for z in s.zones):
            self._emit_zones(s)

    def _current_template_chapters(self) -> list[Chapter]:
        return self._chapters_for(self.now().date())

    def _chapters_for(self, day: date) -> list[Chapter]:
        """Template chapters plus any chapters that exist on this date only."""
        t = self._template_for(day)
        p = self.plan(day)
        return list(t.chapters if t else []) + list(p.extra_chapters if p else [])

    @staticmethod
    def _representative_variant(ch: Chapter, forced: str | None) -> Variant | None:
        if not ch.variants:
            return None
        if forced:
            for v in ch.variants:
                if v.key == forced:
                    return v
        for v in ch.variants:
            if v.when.is_empty():
                return v
        return ch.variants[0]

    def _enrich_music(self, chapters: list[ResolvedChapter], by_id: dict[str, Chapter], scenes: dict[str, CadenceScene]) -> None:
        """Attach the music actions of each chapter's likely variant, for the planner's music strip."""
        for r in chapters:
            ch = by_id.get(r.chapter_id)
            if not ch:
                continue
            v = self._representative_variant(ch, r.forced_variant)
            out: list[dict] = []
            for sid in v.scene_ids if v else []:
                sc = scenes.get(sid)
                if not sc:
                    continue
                for m in sc.music:
                    d = m.model_dump(exclude_none=True)
                    d["scene"] = sc.name
                    out.append(d)
            r.music = out

    def _is_chapter_motion(self, entity_id: str) -> bool:
        return any(ch.motion_entity == entity_id for ch in self._current_template_chapters())

    def _all_led_entities(self) -> set[str]:
        out = set()
        for sc in self.scenes().values():
            for link in sc.ha_scenes:
                if link.led_entity:
                    out.add(link.led_entity)
        return out

    # ------------------------------------------------------------------ override detection
    def _check_led(self, entity_id: str, old: dict | None, new: dict | None) -> None:
        if not new or not old:
            return
        ns, os_ = new.get("state"), old.get("state")
        if ns == os_ or ns in ("unknown", "unavailable") or os_ in ("unknown", "unavailable"):
            return
        now_ts = time.time()
        exp = self.expected_leds.get(entity_id)
        if exp:
            want, until = exp
            if ns == want:
                # Our scene landed (fade finished or immediate).
                self.expected_leds.pop(entity_id, None)
                if want == "on":
                    self.active_leds.add(entity_id)
                self._log("info", "scene", f"{entity_id} now {ns} as expected")
                self._emit_status_soon()
                return
            if now_ts < until:
                return  # transitional flicker inside the grace window
        if self.applied is None or not (self.last_status and self.last_status.auto_active):
            return
        if entity_id in self.active_leds and ns == "off":
            self._begin_hold(f"{entity_id} turned off by hand")
        elif entity_id not in self.active_leds and ns == "on":
            self._begin_hold(f"{entity_id} activated by hand")

    def _begin_hold(self, reason: str) -> None:
        if self.hold.active:
            return
        s = self.settings()
        now = self.now()
        until = None
        if s.hold_mode == "timeout":
            until = (now + timedelta(minutes=s.hold_timeout_minutes)).isoformat()
        else:
            nxt = self.last_status.next_chapter if self.last_status else None
            until = nxt.get("at") if nxt else None
        self.hold = ManualHold(active=True, since=now.isoformat(), until=until, reason=reason)
        self.exec.cancel_all_fades()
        self._persist_runtime()
        self._log("warning", "override", f"Manual change detected: {reason}. Holding until {until or 'next chapter'}.")
        self._emit_status_soon()

    def release_hold(self, reason: str = "released") -> None:
        if self.hold.active:
            self._log("info", "override", f"Manual hold {reason}")
        self.hold = ManualHold()
        self._persist_runtime()
        self.wake()

    # ------------------------------------------------------------------ helpers
    def _template_for(self, day: date) -> Template | None:
        s = self.settings()
        p = self.plan(day)
        tid = (p.template_id if p and p.template_id else None) or s.default_template_id
        if not tid:
            return None
        raw = self.store.get(KIND_TEMPLATE, tid)
        return Template(**raw) if raw else None

    def _lux(self, s: Settings) -> tuple[float | None, float | None]:
        eid = s.sky.lux_entity
        if not eid:
            return None, None
        val = self.ha.numeric(eid)
        st = self.ha.states.get(eid) or {}
        age = None
        lu = st.get("last_updated") or st.get("last_changed")
        if lu:
            try:
                age = max(0.0, (datetime.now(ZoneInfo("UTC")) - datetime.fromisoformat(lu)).total_seconds())
            except ValueError:
                age = None
        return val, age

    def _elevation(self) -> float | None:
        el = self.ha.attr("sun.sun", "elevation")
        if el is not None:
            try:
                return float(el)
            except (TypeError, ValueError):
                pass
        if self.sun:
            return self.sun.elevation_now(self.now())
        return None

    def _motion(self, s: Settings, chapter: Chapter | None) -> tuple[bool | None, str | None]:
        eid = (chapter.motion_entity if chapter and chapter.motion_entity else None) or s.motion_entity
        if not eid:
            return None, None
        on = self.ha.is_on(eid)
        if on:
            self.motion_last_on[eid] = time.time()
            return True, eid
        hold = (chapter.motion_hold_minutes if chapter else 5) * 60
        last = self.motion_last_on.get(eid)
        if last is None:
            st = self.ha.states.get(eid) or {}
            lc = st.get("last_changed")
            if lc:
                with contextlib.suppress(ValueError):
                    last = datetime.fromisoformat(lc).timestamp()
        if last is not None and time.time() - last < hold:
            return True, eid
        return (False if on is not None else None), eid

    def _occupied(self, day: date, s: Settings, plan: DayPlan | None) -> bool | None:
        if plan and plan.occupied is not None:
            return plan.occupied
        ev = self._cached_events(day)
        if ev is not None:
            kws = [k.lower() for k in s.calendar_keywords if k.strip()]
            if kws:
                return any(any(k in (e.get("summary") or "").lower() for k in kws) for e in ev)
            if ev:
                return True
        if s.occupied_entity and day == self.now().date():
            return self.ha.is_on(s.occupied_entity)
        return False if ev is not None else None

    def _cached_events(self, day: date) -> list[dict] | None:
        c = self.calendar_cache.get(day.isoformat())
        if c and time.time() - c[0] < 900:
            return c[1]
        return None

    async def fetch_events(self, start: date, end: date) -> dict[str, list[dict]]:
        """Pull events for [start, end] from every configured HA calendar; cache per day."""
        s = self.settings()
        out: dict[str, list[dict]] = {}
        d = start
        while d <= end:
            out[d.isoformat()] = []
            d = add_days(d, 1)
        if not s.calendars or not self.ha.connected.is_set():
            for k in out:
                self.calendar_cache[k] = (time.time(), [])
            return out
        start_dt = at(start, "00:00", self.tz)
        end_dt = at(add_days(end, 1), "00:00", self.tz)
        try:
            res = await self.ha.call_service(
                "calendar",
                "get_events",
                target={"entity_id": s.calendars},
                data={"start_date_time": start_dt.isoformat(), "end_date_time": end_dt.isoformat()},
                return_response=True,
            )
        except Exception as exc:  # noqa: BLE001
            self._log("warning", "calendar", f"calendar.get_events failed: {exc}")
            return out
        resp = (res or {}).get("response") or {}
        for cal_id, body in resp.items():
            for ev in body.get("events") or []:
                st = ev.get("start") or ""
                en = ev.get("end") or ""
                all_day = len(st) == 10
                try:
                    sd = date.fromisoformat(st[:10])
                    ed = date.fromisoformat(en[:10]) if en else sd
                except ValueError:
                    continue
                if all_day and ed > sd:
                    ed = add_days(ed, -1)  # all-day end is exclusive
                d = sd
                while d <= ed:
                    k = d.isoformat()
                    if k in out:
                        out[k].append(
                            {
                                "calendar": cal_id,
                                "summary": ev.get("summary"),
                                "start": st,
                                "end": en,
                                "all_day": all_day,
                                "location": ev.get("location"),
                            }
                        )
                    d = add_days(d, 1)
        for k, v in out.items():
            self.calendar_cache[k] = (time.time(), v)
        return out

    # ------------------------------------------------------------------ variant selection
    def choose_variant(self, chapter: Chapter, forced: str | None, ctx: dict) -> Variant | None:
        if not chapter.variants:
            return None
        if forced:
            for v in chapter.variants:
                if v.key == forced:
                    return v
        for v in chapter.variants:
            if self._cond_matches(v.when, ctx):
                return v
        # fall back to an explicit default (empty condition) or the first
        for v in chapter.variants:
            if v.when.is_empty():
                return v
        return chapter.variants[0]

    @staticmethod
    def _cond_matches(c: VariantCondition, ctx: dict) -> bool:
        if c.sky is not None and ctx.get("sky") not in c.sky:
            return False
        if c.light is not None:
            is_light = ctx.get("sky") in ("sunny", "cloudy")
            if (c.light == "light") != is_light:
                return False
        if c.motion is not None and bool(ctx.get("motion")) != c.motion:
            return False
        if c.asleep is not None and bool(ctx.get("asleep")) != c.asleep:
            return False
        if c.occupied is not None and bool(ctx.get("occupied")) != c.occupied:
            return False
        return True

    # ------------------------------------------------------------------ main loop
    async def run(self) -> None:
        self._log("info", "system", f"Cadence engine starting (dry run: {self.is_dry_run()})")
        while not self._stop:
            try:
                async with self._lock:
                    await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("engine tick failed")
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=max(5, self.settings().tick_seconds))
            except TimeoutError:
                pass

    def _resolve(self, day: date, s: Settings, *, with_music: bool = False) -> tuple[Template | None, DayPlan | None, list[ResolvedChapter]]:
        t = self._template_for(day)
        p = self.plan(day)
        chapters = resolve_day(day, t, p, s, self.tz, self.sun)
        if with_music:
            by_id = {c.id: c for c in (list(t.chapters) if t else []) + (list(p.extra_chapters) if p else [])}
            self._enrich_music(chapters, by_id, self.scenes())
        # Apply previously triggered conditional starts.
        for r in chapters:
            key = f"{day.isoformat()}|{r.chapter_id}"
            if r.pending_condition and key in self.triggered:
                r.start = self.triggered[key]
                r.pending_condition = False
        return t, p, chapters

    def _arm_conditional(
        self, day: date, chapters: list[ResolvedChapter], t: Template | None, s: Settings, now: datetime, ctx_asleep: bool | None
    ) -> bool:
        """Start motion/asleep chapters whose condition has come true. Returns True if any fired."""
        fired = False
        by_id = {c.id: c for c in self._chapters_for(day)}
        for r in chapters:
            if not r.pending_condition or not r.enabled:
                continue
            ch = by_id.get(r.chapter_id)
            if not ch:
                continue
            nominal = datetime.fromisoformat(r.nominal)
            if now < nominal:
                continue
            latest = at(day, ch.start.latest, self.tz) if ch.start.latest else None
            if latest is not None and latest <= nominal:
                latest += timedelta(days=1)  # "latest 01:00" after "earliest 21:00" means the next morning
            cond = False
            if ch.start.kind == "asleep":
                cond = bool(ctx_asleep)
            elif ch.start.kind == "motion":
                m, _ = self._motion(s, ch)
                cond = bool(m)
            elif ch.start.kind == "sensor":
                st = self.ha.state(ch.start.entity_id) if ch.start.entity_id else None
                cond = st is not None and st == ch.start.to_state
            start_at: datetime | None = None
            if cond:
                start_at = now
            elif latest and now >= latest:
                start_at = latest
            if start_at:
                key = f"{day.isoformat()}|{r.chapter_id}"
                self.triggered[key] = start_at.isoformat()
                r.start = start_at.isoformat()
                r.pending_condition = False
                fired = True
                what = ch.start.kind if ch.start.kind != "sensor" else f"{ch.start.entity_id} → {ch.start.to_state}"
                self._log("info", "chapter", f"'{r.name}' triggered by {what}" + ("" if cond else " (hard start reached)"))
        if fired:
            self._prune_runtime(day)
            self._persist_runtime()
        return fired

    def _prune_runtime(self, day: date) -> None:
        keep = {day.isoformat(), add_days(day, -1).isoformat()}
        self.triggered = {k: v for k, v in self.triggered.items() if k.split("|")[0] in keep}
        self.released = {k: v for k, v in self.released.items() if k.split("|")[0] in keep}

    # ------------------------------------------------------------------ chapter holds
    def _hold_release(
        self, day: date, r: ResolvedChapter, ch: Chapter, now: datetime, next_start: datetime | None
    ) -> tuple[bool, datetime | None, datetime | None]:
        """Evaluate a chapter's hold. Returns (active_now, release_time, hard_end)."""
        if not ch.hold or not r.start:
            return False, None, None
        start = datetime.fromisoformat(r.start)
        end = hold_end(day, start, ch.hold.latest, self.tz)
        key = f"{day.isoformat()}|{ch.id}"
        rel = self.released.get(key)
        if rel:
            return False, datetime.fromisoformat(rel), end
        if next_start is None or now < next_start:
            # The following chapter isn't due yet — the hold has nothing to hold back.
            return False, None, end
        st = self.ha.state(ch.hold.entity_id)
        cond = st is not None and st == ch.hold.while_state
        if cond and (end is None or now < end):
            return True, None, end
        # Released: either the sensor cleared or the hard end passed. Remember when.
        release = now if (end is None or now < end) else end
        release = max(release, next_start)
        self.released[key] = release.isoformat()
        self._persist_runtime()
        self._log(
            "info",
            "chapter",
            f"'{ch.name}' hold released" + ("" if cond else f" ({ch.hold.entity_id} {st})")
            if (end is None or now < end)
            else f"'{ch.name}' hold reached its hard end",
        )
        return False, release, end

    def _apply_holds(
        self,
        day: date,
        chapters: list[ResolvedChapter],
        by_id: dict[str, Chapter],
        now: datetime,
        carried: tuple[ResolvedChapter, Chapter, date] | None,
    ) -> dict | None:
        """Defer chapters that are held back by an earlier chapter's hold. Returns the active hold, if any."""
        active: dict | None = None
        release: datetime | None = None
        holder_name = ""
        started = [r for r in chapters if r.enabled and r.start]

        def first_due(after: datetime) -> datetime | None:
            for r in chapters:
                if r.enabled and r.start and datetime.fromisoformat(r.start) > after:
                    return datetime.fromisoformat(r.start)
            return None

        # Yesterday's last chapter may still be holding into this morning.
        if carried:
            cr, cch, cday = carried
            if cch.hold and cr.start:
                nxt = min((datetime.fromisoformat(r.start) for r in started), default=None)
                act, rel, end = self._hold_release(cday, cr, cch, now, nxt)
                if act:
                    active = {
                        "chapter": cch.name,
                        "chapter_id": cch.id,
                        "entity_id": cch.hold.entity_id,
                        "while_state": cch.hold.while_state,
                        "until": end.isoformat() if end else None,
                    }
                    holder_name = cch.name
                release = rel

        for r in chapters:
            if not r.enabled or not r.start:
                continue
            start = datetime.fromisoformat(r.start)
            if active and start <= now:
                r.start = None
                r.pending_condition = True
                r.held_by = holder_name
                continue
            if release and start < release:
                if release.date() != day:
                    # Released only after this day ended: the next day's chapters take over instead.
                    r.start = None
                    r.pending_condition = True
                    r.held_by = holder_name or "hold"
                    continue
                r.start = release.isoformat()
                start = release
            ch = by_id.get(r.chapter_id)
            if ch and ch.hold and start <= now:
                act, rel, end = self._hold_release(day, r, ch, now, first_due(start))
                if act:
                    active = {
                        "chapter": ch.name,
                        "chapter_id": ch.id,
                        "entity_id": ch.hold.entity_id,
                        "while_state": ch.hold.while_state,
                        "until": end.isoformat() if end else None,
                    }
                    holder_name = ch.name
                    release = None
                else:
                    active = None
                    release = rel
        return active

    def _auto_state(self, day: date, s: Settings, plan: DayPlan | None, now: datetime) -> tuple[bool, str]:
        if self.auto_override != "none" and self.auto_override_date == day.isoformat():
            return self.auto_override == "on", f"manual override: {self.auto_override} for today"
        if self.auto_override != "none" and self.auto_override_date != day.isoformat():
            self.auto_override = "none"
            self._persist_runtime()
        mode, wins = auto_windows_for(day, s, plan)
        if mode == "on":
            return True, "day plan: auto on"
        if mode == "off":
            return False, "day plan: auto off"
        sched = window_active(wins, now)
        ent = self.ha.is_on(s.auto_entity) if s.auto_entity else None
        if s.auto_source == "always":
            return True, "always on"
        if s.auto_source == "schedule":
            return sched, "schedule window" if sched else "outside schedule"
        if s.auto_source == "entity":
            return bool(ent), f"{s.auto_entity} is {'on' if ent else 'off'}"
        if sched:
            return True, "schedule window"
        if ent:
            return True, f"{s.auto_entity} is on"
        if not wins and not s.auto_entity:
            return False, "no schedule or entity configured"
        return False, "outside schedule" + (f", {s.auto_entity} off" if s.auto_entity else "")

    async def tick(self) -> None:
        s = self.settings()
        self.sky.cfg = s.sky
        now = self.now()
        day = now.date()
        tmpl, plan, chapters = self._resolve(day, s, with_music=True)

        # Senses
        lux, lux_age = self._lux(s)
        el = self._elevation()
        self.sky_reading = self.sky.classify(now, lux, lux_age, el)
        asleep = self.ha.is_on(s.asleep_entity) if s.asleep_entity else None
        occupied = self._occupied(day, s, plan)

        # Conditional chapters may start right now
        self._arm_conditional(day, chapters, tmpl, s, now, asleep)

        # Yesterday's last chapter (it may still be running, or holding this morning back)
        yday = add_days(day, -1)
        _, _, ych = self._resolve(yday, s)
        self._apply_holds(yday, ych, {c.id: c for c in self._chapters_for(yday)}, now, None)
        ystarted = [r for r in ych if r.enabled and r.start]
        ylast = ystarted[-1] if ystarted else None
        ych_obj = next((c for c in self._chapters_for(yday) if ylast and c.id == ylast.chapter_id), None)
        by_id = {c.id: c for c in self._chapters_for(day)}
        self.active_hold = self._apply_holds(day, chapters, by_id, now, (ylast, ych_obj, yday) if ylast and ych_obj else None)

        # Current chapter: latest started today, else carry over yesterday's last
        current = latest_before(chapters, now)
        carried = False
        if current is None and ylast is not None:
            current = ylast
            carried = True
        carry_over = None
        if ylast is not None:
            first_today = min((datetime.fromisoformat(r.start) for r in chapters if r.enabled and r.start), default=None)
            if first_today is None or first_today > at(day, "00:00", self.tz):
                carry_over = CarryOver(
                    chapter_id=ylast.chapter_id, name=ylast.name, color=ylast.color, until=first_today.isoformat() if first_today else None
                )
        nxt = next_after(chapters, now)
        if nxt is None:
            _, _, tch = self._resolve(add_days(day, 1), s)
            for r in tch:
                if r.enabled:
                    nxt = r
                    break

        chapter_obj: Chapter | None = None
        if current:
            src_day = add_days(day, -1) if carried else day
            chapter_obj = next((c for c in self._chapters_for(src_day) if c.id == current.chapter_id), None)

        motion, motion_entity = self._motion(s, chapter_obj)
        ctx = {"sky": self.sky_reading.state, "motion": motion, "asleep": asleep, "occupied": occupied}
        variant = self.choose_variant(chapter_obj, current.forced_variant if current else None, ctx) if chapter_obj else None

        auto_active, auto_reason = self._auto_state(day, s, plan, now)

        # Chapter boundary => release a hold
        applied_key = (self.applied or {}).get("chapter_id")
        applied_date = (self.applied or {}).get("date")
        chapter_changed = current is not None and (
            applied_key != current.chapter_id or applied_date != (add_days(day, -1) if carried else day).isoformat()
        )
        if self.hold.active and (
            chapter_changed or (self.hold.until and now >= datetime.fromisoformat(self.hold.until) and s.hold_mode == "timeout")
        ):
            self.release_hold("released at chapter change" if chapter_changed else "timeout elapsed")

        if auto_active and current and chapter_obj and not self.hold.active and self.ha.connected.is_set():
            vkey = variant.key if variant else None
            want = {"date": (add_days(day, -1) if carried else day).isoformat(), "chapter_id": current.chapter_id, "variant_key": vkey}
            have = {k: (self.applied or {}).get(k) for k in want}
            if have != want:
                if chapter_changed or chapter_obj.reevaluate or self.applied is None:
                    await self.apply(chapter_obj, variant, current, entering_chapter=chapter_changed, ctx=ctx)

        self.last_status = self._build_status(
            now, s, day, tmpl, current, chapter_obj, variant, nxt, chapters, motion, motion_entity, asleep, occupied, auto_active, auto_reason
        )
        self.last_status.carry_over = carry_over
        self.last_status.chapter_hold = self.active_hold
        self.emit({"type": "status", "status": self.last_status.model_dump()})

    async def apply(
        self, chapter: Chapter, variant: Variant | None, resolved: ResolvedChapter, *, entering_chapter: bool, ctx: dict, manual: bool = False
    ) -> None:
        scenes = self.scenes()
        chosen = [scenes[sid] for sid in (variant.scene_ids if variant else []) if sid in scenes]
        label = f"'{chapter.name}'" + (f" · {variant.label}" if variant else "")
        self._log(
            "info",
            "chapter",
            ("Manual apply " if manual else "Entering " if entering_chapter else "Variant change → ") + label,
            {
                "chapter_id": chapter.id,
                "variant": variant.key if variant else None,
                "scenes": [c.name for c in chosen],
                "ctx": ctx,
                "dry_run": self.is_dry_run(),
            },
        )
        s = self.settings()
        grace = max(s.override_grace_seconds, int(chapter.fade_minutes * 60) + 60)
        until = time.time() + grace
        new_leds: set[str] = set()
        for sc in chosen:
            leds = await self.exec.apply_scene(sc, entering_chapter=entering_chapter, music_only_on_entry=chapter.music_only_on_entry)
            new_leds.update(leds)
        # Expectations: our LEDs should light; LEDs of scenes we're leaving should go dark.
        for led in new_leds:
            if self.ha.is_on(led):
                self.active_leds.add(led)
            else:
                self.expected_leds[led] = ("on", until)
        for led in list(self.active_leds):
            if led not in new_leds:
                self.active_leds.discard(led)
                self.expected_leds[led] = ("off", until)
        self.applied = {
            "date": resolved.start[:10] if resolved.start else self.now().date().isoformat(),
            "chapter_id": chapter.id,
            "variant_key": variant.key if variant else None,
            "at": self.now().isoformat(),
            "scenes": [c.id for c in chosen],
        }
        self._persist_runtime()

    # ------------------------------------------------------------------ manual controls
    async def manual_apply(self, chapter_id: str | None, variant_key: str | None) -> bool:
        async with self._lock:
            s = self.settings()
            day = self.now().date()
            tmpl, plan, chapters = self._resolve(day, s)
            if not chapters:
                return False
            target_res = None
            if chapter_id:
                target_res = next((r for r in chapters if r.chapter_id == chapter_id), None)
            else:
                target_res = latest_before(chapters, self.now())
            if not target_res:
                return False
            ch = next((c for c in self._chapters_for(day) if c.id == target_res.chapter_id), None)
            if not ch:
                return False
            self.release_hold("released by manual apply")
            ctx = {"sky": self.sky.state, "motion": None, "asleep": None, "occupied": None}
            variant = self.choose_variant(ch, variant_key or target_res.forced_variant, ctx)
            if chapter_id and target_res.pending_condition:
                # Manually starting a waiting chapter counts as its trigger and releases any hold on it.
                if target_res.held_by and self.active_hold:
                    hday = day if self.active_hold["chapter_id"] in {c.id for c in tmpl.chapters} else add_days(day, -1)
                    self.released[f"{hday.isoformat()}|{self.active_hold['chapter_id']}"] = self.now().isoformat()
                else:
                    self.triggered[f"{day.isoformat()}|{ch.id}"] = self.now().isoformat()
                target_res.start = self.now().isoformat()
            await self.apply(ch, variant, target_res, entering_chapter=True, ctx=ctx, manual=True)
            self.wake()
            return True

    async def test_scene(self, scene: CadenceScene) -> None:
        """Fire one Cadence Scene right now, outside the schedule (respects dry run)."""
        self._log("info", "scene", f"Test: firing '{scene.name}'", {"scene_id": scene.id, "dry_run": self.is_dry_run()})
        leds = await self.exec.apply_scene(scene, entering_chapter=True, music_only_on_entry=False)
        until = time.time() + self.settings().override_grace_seconds
        for led in leds:
            if not self.ha.is_on(led):
                self.expected_leds[led] = ("on", until)
        self.wake()

    def set_auto_override(self, mode: str) -> None:
        self.auto_override = mode
        self.auto_override_date = self.now().date().isoformat()
        self._persist_runtime()
        self._log("info", "auto", f"Auto mode override set to {mode} for today")
        self.wake()

    # ------------------------------------------------------------------ spotify
    def spotify_entity(self, s: Settings | None = None) -> str | None:
        s = s or self.settings()
        if s.spotify_entity:
            return s.spotify_entity
        for eid, st in self.ha.states.items():
            if eid.startswith("media_player.") and "sp_user_id" in (st.get("attributes") or {}):
                return eid
        return None

    async def spotify_search(self, query: str, kind: str, limit: int = 12) -> list[dict]:
        """Search playlists / albums / artists through the SpotifyPlus integration (read-only)."""
        eid = self.spotify_entity()
        if not eid:
            raise RuntimeError("no SpotifyPlus media_player configured (Settings → Music)")
        service = {"playlist": "search_playlists", "album": "search_albums", "artist": "search_artists"}.get(kind)
        if not service:
            raise ValueError("type must be playlist, album or artist")
        res = await self.ha.call_service(
            "spotifyplus", service, data={"entity_id": eid, "criteria": query, "limit_total": max(1, min(limit, 50))}, return_response=True
        )
        body = (res or {}).get("response") or {}
        items = ((body.get("result") or {}).get("items")) or []
        out: list[dict] = []
        for it in items:
            if not it:
                continue
            images = it.get("images") or []
            if kind == "playlist":
                sub = (it.get("owner") or {}).get("display_name") or ""
                extra = f"{it.get('tracks', {}).get('total', '')} tracks" if isinstance(it.get("tracks"), dict) else ""
            elif kind == "album":
                sub = ", ".join(a.get("name", "") for a in it.get("artists") or [])
                extra = str(it.get("release_date") or "")[:4]
            else:
                sub = ", ".join((it.get("genres") or [])[:3])
                extra = f"{(it.get('followers') or {}).get('total', '')} followers" if it.get("followers") else ""
            out.append(
                {
                    "uri": it.get("uri"),
                    "name": it.get("name"),
                    "type": kind,
                    "subtitle": sub,
                    "extra": extra,
                    "image": images[-1].get("url") if images else None,  # smallest image last
                    "image_large": images[0].get("url") if images else None,
                }
            )
        return [o for o in out if o["uri"]]

    # ------------------------------------------------------------------ status
    def _zones(self, s: Settings) -> dict[str, float]:
        out: dict[str, float] = {}
        for z in s.zones:
            if not z.entity_id:
                continue
            st = self.ha.state(z.entity_id)
            if st == "on":
                b = self.ha.attr(z.entity_id, "brightness")
                out[z.id] = round(float(b) / 255 * 100, 1) if b is not None else 100.0
            elif st == "off":
                out[z.id] = 0.0
        return out

    def _emit_zones(self, s: Settings) -> None:
        self.emit({"type": "zones", "zones": self._zones(s)})

    def _emit_status_soon(self) -> None:
        self.wake()

    def _build_status(
        self, now, s, day, tmpl, current, chapter_obj, variant, nxt, chapters, motion, motion_entity, asleep, occupied, auto_active, auto_reason
    ) -> EngineStatus:
        scenes = self.scenes()
        chosen = [scenes[sid] for sid in (variant.scene_ids if variant else []) if sid in scenes]
        sun_attrs = (self.ha.states.get("sun.sun") or {}).get("attributes") or {}
        sunrise = sunset = None
        if self.sun:
            sr = self.sun.event(day, "sunrise")
            ss = self.sun.event(day, "sunset")
            sunrise = sr.isoformat() if sr else None
            sunset = ss.isoformat() if ss else None
        fading = [
            {"led": led, "want": want, "until": datetime.fromtimestamp(until, self.tz).isoformat()}
            for led, (want, until) in self.expected_leds.items()
            if want == "on"
        ]
        sky = self.sky_reading
        return EngineStatus(
            ha_connected=self.ha.connected.is_set(),
            dry_run=self.is_dry_run(),
            now=now.isoformat(),
            timezone=str(self.tz),
            auto_active=auto_active,
            auto_reason=auto_reason,
            auto_override=self.auto_override if self.auto_override_date == day.isoformat() else "none",  # type: ignore[arg-type]
            date=day.isoformat(),
            template_id=tmpl.id if tmpl else None,
            template_name=tmpl.name if tmpl else None,
            chapter=(
                {
                    "id": current.chapter_id,
                    "name": current.name,
                    "start": current.start,
                    "fade_minutes": current.fade_minutes,
                    "color": current.color,
                    "note": current.note,
                    "kind": current.kind,
                }
                if current
                else None
            ),
            variant=({"key": variant.key, "label": variant.label} if variant else None),
            scenes=[{"id": c.id, "name": c.name, "color": c.color} for c in chosen],
            next_chapter=(
                {"id": nxt.chapter_id, "name": nxt.name, "at": nxt.start or nxt.nominal, "pending_condition": nxt.pending_condition, "kind": nxt.kind}
                if nxt
                else None
            ),
            sky={
                "state": sky.state if sky else None,
                "lux": sky.lux if sky else None,
                "elevation": sky.elevation if sky else None,
                "reason": sky.reason if sky else "",
                "weather": self.ha.state(s.sky.weather_entity) if s.sky.weather_entity else None,
                "lux_entity": s.sky.lux_entity,
            },
            motion={
                "active": motion,
                "entity": motion_entity,
                "last_on": (
                    datetime.fromtimestamp(self.motion_last_on[motion_entity], self.tz).isoformat()
                    if motion_entity and motion_entity in self.motion_last_on
                    else None
                ),
            },
            asleep=asleep,
            occupied=occupied,
            hold=self.hold,
            sun={
                "sunrise": sunrise,
                "sunset": sunset,
                "elevation": sun_attrs.get("elevation"),
                "next_setting": sun_attrs.get("next_setting"),
                "next_rising": sun_attrs.get("next_rising"),
            },
            zones=self._zones(s),
            fading=fading,
            timeline=chapters,
            last_apply=self.applied,
        )

    # ------------------------------------------------------------------ planner support
    async def day_views(self, start: date, end: date) -> list[DayView]:
        s = self.settings()
        events = await self.fetch_events(start, end)
        out: list[DayView] = []
        d = start
        today = self.now().date()
        while d <= end:
            tmpl, plan, chapters = self._resolve(d, s, with_music=True)
            if d == today and self.last_status is not None:
                chapters = list(self.last_status.timeline)  # today reflects live holds/triggers
            mode, wins = auto_windows_for(d, s, plan)
            sr = self.sun.event(d, "sunrise") if self.sun else None
            ss = self.sun.event(d, "sunset") if self.sun else None
            carry = None
            _, _, ych = self._resolve(add_days(d, -1), s)
            ystarted = [r for r in ych if r.enabled and (r.start or r.nominal)]
            if ystarted:
                yl = ystarted[-1]
                first = min((datetime.fromisoformat(r.start or r.nominal) for r in chapters if r.enabled), default=None)
                if first is None or first > at(d, "00:00", self.tz):
                    carry = CarryOver(chapter_id=yl.chapter_id, name=yl.name, color=yl.color, until=first.isoformat() if first else None)
            out.append(
                DayView(
                    date=d.isoformat(),
                    template_id=tmpl.id if tmpl else None,
                    template_name=tmpl.name if tmpl else None,
                    plan=plan,
                    chapters=chapters,
                    auto_windows=wins,
                    auto_mode=mode,
                    occupied=self._occupied(d, s, plan),
                    events=events.get(d.isoformat(), []),
                    sunrise=sr.isoformat() if sr else None,
                    sunset=ss.isoformat() if ss else None,
                    carry_over=carry,
                )
            )
            d = add_days(d, 1)
        return out
