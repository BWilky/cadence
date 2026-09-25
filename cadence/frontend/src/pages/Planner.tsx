import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, api, describeStart, fmtTime, hhmm, todayISO, type useLive } from "../api";
import { ChapterEditor } from "../components/ChapterEditor";
import { ContextMenu, type MenuItem, type MenuState } from "../components/ContextMenu";
import { DayColumn } from "../components/DayColumn";
import { useSensorGroups } from "../components/SensorRef";
import { WindowsEditor, defaultStart } from "../components/StartEditor";
import type { TrackContext } from "../components/Track";
import { COLORS, Confirm, Field, Pill, toast } from "../components/ui";
import type { CadenceScene, Chapter, DayPlan, DayView, ResolvedChapter, Template } from "../types";

const HOUR_H = 44; // px per hour
const GUTTER = 48; // px, hour labels

/** Monday of the week containing `iso`. */
function weekStart(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const dow = (d.getDay() + 6) % 7; // Mon = 0
  return addDays(iso, -dow);
}
function monthStart(iso: string): string {
  return iso.slice(0, 8) + "01";
}
const OCC_LABEL: Record<string, string> = { forced: "forced on", forced_off: "forced off", calendar: "calendar", sensor: "sensor", always: "occupied", none: "vacant" };

export function Planner({ live }: { live: ReturnType<typeof useLive> }) {
  const today = todayISO();
  const [start, setStart] = useState<string>(() => weekStart(today));
  const [cache, setCache] = useState<Record<string, DayView>>({});
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [scenes, setScenes] = useState<CadenceScene[]>([]);
  const [open, setOpen] = useState<string | null>(null); // day pane
  const [focusChapter, setFocusChapter] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [clipboard, setClipboard] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [calOpen, setCalOpen] = useState(false);
  const [calMonth, setCalMonth] = useState<string>(() => monthStart(today));
  const gridRef = useRef<HTMLDivElement>(null);
  const st = live.status;

  useEffect(() => {
    api.get<Template[]>("api/templates").then(setTemplates).catch(() => undefined);
    api.get<CadenceScene[]>("api/scenes").then(setScenes).catch(() => undefined);
  }, []);

  const fetchRange = useCallback(async (s: string, e: string) => {
    const rows = await api.get<DayView[]>(`api/days?start=${s}&end=${e}`);
    setCache((cur) => {
      const next = { ...cur };
      for (const r of rows) next[r.date] = r;
      return next;
    });
    return rows;
  }, []);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);

  useEffect(() => {
    setLoading(true);
    fetchRange(addDays(start, -1), addDays(start, 7))
      .catch((e) => toast((e as Error).message, true))
      .finally(() => setLoading(false));
  }, [start, fetchRange]);

  // Month grid data for the popover.
  useEffect(() => {
    if (!calOpen) return;
    const s = weekStart(calMonth);
    fetchRange(s, addDays(s, 41)).catch(() => undefined);
  }, [calOpen, calMonth, fetchRange]);

  // Scroll the grid to ~07:00 on first paint.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !gridRef.current) return;
    scrolled.current = true;
    gridRef.current.scrollTop = 6.5 * HOUR_H;
  }, [loading]);

  const refreshDay = useCallback(async (date: string) => fetchRange(date, date), [fetchRange]);
  const refreshDays = useCallback(async (dates: string[]) => {
    const sorted = [...dates].sort();
    await fetchRange(sorted[0], sorted[sorted.length - 1]);
  }, [fetchRange]);

  /** Any chapter edit takes the day off its template first, then applies `fn` to the day's own chapters. */
  const editOwn = useCallback(
    async (d: DayView, fn: (p: DayPlan) => DayPlan, ok: string) => {
      try {
        const base = d.detached && d.plan ? d.plan : await api.post<DayPlan>(`api/plans/${d.date}/detach`);
        await api.put(`api/plans/${d.date}`, fn(base));
        await refreshDay(d.date);
        toast(ok);
      } catch (e) {
        toast((e as Error).message, true);
      }
    },
    [refreshDay],
  );
  const setOccupied = useCallback(
    async (d: DayView, value: boolean | null) => {
      try {
        await api.post(`api/plans/${d.date}/occupied`, { occupied: value });
        await refreshDay(d.date);
        toast(value ? `${fmtDay(d.date)} forced occupied` : `${fmtDay(d.date)} back to automatic`);
      } catch (e) {
        toast((e as Error).message, true);
      }
    },
    [refreshDay],
  );
  const pasteOnto = useCallback(
    async (targets: string[]) => {
      if (!clipboard || targets.length === 0) return;
      try {
        await api.post("api/plans/copy", { source: clipboard, targets });
        await refreshDays(targets);
        toast(`Pasted ${fmtDay(clipboard)} onto ${targets.length} day${targets.length > 1 ? "s" : ""}`);
        setPicked(new Set());
      } catch (e) {
        toast((e as Error).message, true);
      }
    },
    [clipboard, refreshDays],
  );

  const setChapterStart = (d: DayView, c: ResolvedChapter, at: string) =>
    editOwn(d, (p) => ({ ...p, chapters: (p.chapters ?? []).map((x) => (x.id === c.chapter_id ? { ...x, start: { ...defaultStart("clock"), time: at } } : x)) }), `${c.name} starts ${at}`);

  const openMenu = (d: DayView, ctx: TrackContext) => {
    const at = hhmm(ctx.minute);
    const isToday = d.date === today;
    const c = ctx.chapter;
    const items: MenuItem[] = [];
    if (c) {
      const ov = d.plan?.chapter_overrides.find((o) => o.chapter_id === c.chapter_id);
      items.push({ label: c.name, title: true });
      items.push({
        label: "Edit chapter…",
        onClick: () => {
          setFocusChapter(c.chapter_id);
          setOpen(d.date);
        },
      });
      if (c.variants.length > 1)
        items.push({
          label: "Variant for this day",
          children: [
            { label: "Auto", disabled: !ov?.variant_key, onClick: () => editOwn(d, (p) => setVariant(p, c.chapter_id, null), "Variant back to auto") },
            ...c.variants.map((v) => ({ label: v.label, disabled: ov?.variant_key === v.key, onClick: () => editOwn(d, (p) => setVariant(p, c.chapter_id, v.key), `${c.name} → ${v.label}`) })),
          ],
        });
      items.push({ label: `Move start to ${at}`, hint: at, onClick: () => setChapterStart(d, c, at) });
      items.push({ label: "Duplicate here", hint: at, onClick: () => editOwn(d, (p) => ({ ...p, chapters: [...(p.chapters ?? []), dupChapter(p, c, at)] }), `Copied ${c.name} to ${at}`) });
      items.push({ label: "Add new chapter here", hint: at, onClick: () => editOwn(d, (p) => ({ ...p, chapters: [...(p.chapters ?? []), newChapter(at, p)] }), `Added a chapter at ${at}`) });
      if (isToday) items.push({ label: "Apply now", onClick: () => api.post("api/engine/apply", { chapter_id: c.chapter_id }).then(() => toast(`Applied ${c.name}`), (e) => toast(e.message, true)) });
      items.push({ divider: true, label: "" });
      items.push({ label: "Remove from this day", danger: true, onClick: () => editOwn(d, (p) => ({ ...p, chapters: (p.chapters ?? []).filter((x) => x.id !== c.chapter_id), chapter_overrides: p.chapter_overrides.filter((o) => o.chapter_id !== c.chapter_id) }), `Removed ${c.name}`) });
    } else {
      items.push({ label: `${fmtDay(d.date)} · ${at}`, title: true });
      if (d.occupied === false) items.push({ label: "Force occupied", hint: "+", onClick: () => setOccupied(d, true) });
      items.push({ label: "Add chapter here", hint: at, onClick: () => editOwn(d, (p) => ({ ...p, chapters: [...(p.chapters ?? []), newChapter(at, p)] }), `Added a chapter at ${at}`) });
      items.push({ label: "Open day…", onClick: () => setOpen(d.date) });
      items.push({ divider: true, label: "" });
      items.push({ label: "Copy day", onClick: () => { setClipboard(d.date); setPicked(new Set()); toast(`Copied ${fmtDay(d.date)} — pick days, then paste`); } });
      if (clipboard && clipboard !== d.date) items.push({ label: `Paste ${fmtDay(clipboard)} here`, onClick: () => pasteOnto([d.date]) });
      if (clipboard && picked.size) items.push({ label: `Paste onto ${picked.size} selected day${picked.size > 1 ? "s" : ""}`, onClick: () => pasteOnto([...picked]) });
      if (d.detached) items.push({ label: "Reset to template", danger: true, onClick: () => api.post(`api/plans/${d.date}/reset`).then(() => refreshDay(d.date)).then(() => toast(`${fmtDay(d.date)} back on its template`), (e) => toast(e.message, true)) });
      if (isToday) items.push({ label: "Recompute now", onClick: () => api.post("api/engine/recompute").then(() => toast("Recomputed")) });
    }
    setMenu({ x: ctx.x, y: ctx.y, items });
  };

  const togglePick = (date: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  const weekLabel = (() => {
    const a = new Date(start + "T12:00:00");
    const b = new Date(addDays(start, 6) + "T12:00:00");
    const sameMonth = a.getMonth() === b.getMonth();
    return `${a.toLocaleDateString([], { month: "short", day: "numeric" })} – ${b.toLocaleDateString([], sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}, ${b.getFullYear()}`;
  })();
  const openView = open ? cache[open] ?? null : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-100 px-4 py-2">
        <div className="join">
          <button className="btn btn-sm btn-ghost join-item" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">‹</button>
          <button className="btn btn-sm btn-ghost join-item" onClick={() => setStart(weekStart(today))}>Today</button>
          <button className="btn btn-sm btn-ghost join-item" onClick={() => setStart(addDays(start, 7))} aria-label="Next week">›</button>
        </div>
        <span className="display text-lg">{weekLabel}</span>
        <div className="relative">
          <button className={"btn btn-sm btn-ghost btn-circle " + (calOpen ? "bg-base-200" : "")} title="Jump to a date" onClick={() => { setCalMonth(monthStart(start)); setCalOpen((v) => !v); }} aria-label="Calendar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
          </button>
          {calOpen ? <MonthPopover month={calMonth} today={today} cache={cache} onMonth={setCalMonth} onPick={(d) => { setStart(weekStart(d)); setCalOpen(false); }} onClose={() => setCalOpen(false)} /> : null}
        </div>
        {loading ? <span className="loading loading-dots loading-xs opacity-60" /> : null}
        <div className="ml-auto flex items-center gap-3 text-[11px] opacity-60">
          <span><span className="occ-dot bg-primary" /> calendar</span>
          <span><span className="occ-dot bg-accent" /> sensor</span>
          <span><span className="occ-dot bg-secondary" /> forced</span>
          <span><span className="occ-dot bg-base-content/40" /> own chapters</span>
        </div>
      </div>

      {/* day headers */}
      <div className="grid border-b border-base-300 bg-base-100" style={{ gridTemplateColumns: `${GUTTER}px repeat(7, minmax(0, 1fr))` }}>
        <div />
        {weekDays.map((date) => {
          const d = cache[date];
          const dt = new Date(date + "T12:00:00");
          const isToday = date === today;
          const vacant = d?.occupied === false;
          const inPick = picked.has(date);
          return (
            <div key={date} className={"group relative border-l border-base-300/60 px-2 py-2 " + (isToday ? "bg-accent/5" : "") + (inPick ? " bg-secondary/10" : "")}>
              <button type="button" className="flex w-full items-baseline gap-1.5 text-left" onClick={() => (clipboard ? togglePick(date) : setOpen(date))} title={clipboard ? "Select for paste" : "Open this day"}>
                <span className={"text-[11px] uppercase tracking-wide " + (isToday ? "text-accent" : "opacity-50")}>{dt.toLocaleDateString([], { weekday: "short" })}</span>
                <span className={"display text-xl leading-none " + (isToday ? "text-accent" : vacant ? "opacity-40" : "")}>{dt.getDate()}</span>
                {d ? <OccDots d={d} /> : null}
                {clipboard ? <input type="checkbox" className="checkbox checkbox-xs checkbox-secondary ml-auto" checked={inPick} readOnly /> : null}
              </button>
              <div className={"mt-0.5 truncate text-[11px] " + (vacant ? "opacity-40" : "opacity-60")} title={d ? `${OCC_LABEL[d.occupied_reason] ?? ""}${d.template_name ? " · " + d.template_name : ""}` : ""}>
                {!d ? "" : d.detached ? "Own chapters" : d.template_kind === "none" ? (vacant ? "Vacant · nothing runs" : "No template") : d.template_kind === "vacant" ? `Vacant · ${d.template_name}` : d.template_name}
              </div>
              {d && d.events.length ? (
                <div className="truncate text-[11px] text-primary" title={d.events.map((e) => e.summary ?? "").join("\n")}>
                  {d.events[0].summary}{d.events.length > 1 ? ` +${d.events.length - 1}` : ""}
                </div>
              ) : null}
              {d && vacant && !clipboard ? (
                <button type="button" className="btn btn-xs btn-circle btn-outline absolute top-1.5 right-1.5 border-base-300 opacity-60 group-hover:opacity-100" title="Force occupied: run the guest template on this day" onClick={() => setOccupied(d, true)}>
                  +
                </button>
              ) : null}
              {d && d.occupied_reason === "forced" && !clipboard ? (
                <button type="button" className="btn btn-xs btn-circle btn-ghost absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100" title="Back to automatic occupancy" onClick={() => setOccupied(d, null)}>
                  ↺
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* week grid */}
      <div ref={gridRef} className="relative min-h-0 flex-1 overflow-auto bg-base-100">
        <div className="grid" style={{ gridTemplateColumns: `${GUTTER}px repeat(7, minmax(0, 1fr))`, height: HOUR_H * 24 }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 font-mono text-[10px] opacity-50" style={{ top: h * HOUR_H }}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          {weekDays.map((date) => {
            const d = cache[date];
            if (!d) return <div key={date} className="col" />;
            const isToday = date === today;
            return (
              <DayColumn
                key={date}
                view={d}
                now={st?.now}
                currentId={isToday ? st?.chapter?.id : null}
                variantOf={(c) => (isToday && st?.chapter?.id === c.chapter_id ? st?.variant?.label : c.forced_variant ? c.forced_variant : null)}
                onChapter={(c) => {
                  setFocusChapter(c.chapter_id);
                  setOpen(date);
                }}
                onContext={(ctx) => openMenu(d, ctx)}
                onMoveStart={(c, minute) => setChapterStart(d, c, hhmm(minute))}
                emptyText={d.occupied === false ? "vacant" : undefined}
                className={picked.has(date) ? "bg-secondary/5" : ""}
              />
            );
          })}
        </div>
      </div>

      {/* paste bar */}
      {clipboard ? (
        <div className="flex items-center gap-3 border-t border-base-300 bg-base-100 px-4 py-2 text-sm">
          <span>
            Copied <b>{fmtDay(clipboard)}</b>. Click day headers to select.
          </span>
          <button className="btn btn-sm btn-secondary" disabled={picked.size === 0} onClick={() => pasteOnto([...picked])}>
            Paste onto {picked.size || ""} day{picked.size === 1 ? "" : "s"}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => { setClipboard(null); setPicked(new Set()); }}>
            Done
          </button>
        </div>
      ) : null}

      {openView ? (
        <DayPane
          key={openView.date}
          view={openView}
          templates={templates}
          scenes={scenes}
          focusChapter={focusChapter}
          onClose={() => {
            setOpen(null);
            setFocusChapter(null);
          }}
          onSaved={() => refreshDay(openView.date)}
          onCopy={() => {
            setClipboard(openView.date);
            setPicked(new Set());
            setOpen(null);
            toast(`Copied ${fmtDay(openView.date)} — pick days, then paste`);
          }}
        />
      ) : null}
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  );
}

function fmtDay(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** Small occupancy / customisation marks next to the day number. */
function OccDots({ d }: { d: DayView }) {
  const r = d.occupied_reason;
  const occ = r === "calendar" ? "bg-primary" : r === "sensor" ? "bg-accent" : r === "forced" ? "bg-secondary" : r === "always" ? "bg-base-content/30" : null;
  return (
    <span className="flex items-center gap-0.5" title={`${OCC_LABEL[r] ?? r}${d.detached ? " · own chapters" : ""}`}>
      {occ ? <span className={"occ-dot " + occ} /> : null}
      {d.detached ? <span className="occ-dot bg-base-content/40" /> : null}
    </span>
  );
}

function MonthPopover(props: { month: string; today: string; cache: Record<string, DayView>; onMonth: (m: string) => void; onPick: (d: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest("button[aria-label=Calendar]")) props.onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [props]);
  const first = props.month;
  const gridStart = weekStart(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const m = new Date(first + "T12:00:00");
  const prev = addDays(first, -1).slice(0, 8) + "01";
  const nextM = addDays(first, 32).slice(0, 8) + "01";
  return (
    <div ref={ref} className="absolute top-full left-0 z-[120] mt-1 w-72 rounded-box border border-base-300 bg-base-100 p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <button className="btn btn-xs btn-ghost" onClick={() => props.onMonth(prev)} aria-label="Previous month">‹</button>
        <span className="display text-base">{m.toLocaleDateString([], { month: "long", year: "numeric" })}</span>
        <button className="btn btn-xs btn-ghost" onClick={() => props.onMonth(nextM)} aria-label="Next month">›</button>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[10px] uppercase opacity-50">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((date) => {
          const d = props.cache[date];
          const inMonth = date.slice(0, 7) === first.slice(0, 7);
          const isToday = date === props.today;
          const r = d?.occupied_reason;
          const occ = r === "calendar" ? "bg-primary" : r === "sensor" ? "bg-accent" : r === "forced" ? "bg-secondary" : r === "always" ? "bg-base-content/30" : null;
          return (
            <button key={date} type="button" className={"flex h-8 flex-col items-center justify-center rounded-field text-xs hover:bg-base-200 " + (inMonth ? "" : "opacity-30 ") + (isToday ? "font-bold text-accent" : "")} onClick={() => props.onPick(date)}>
              <span>{Number(date.slice(8, 10))}</span>
              <span className="flex h-1.5 items-center gap-0.5">
                {occ ? <span className={"occ-dot " + occ} /> : null}
                {d?.detached ? <span className="occ-dot bg-base-content/40" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between">
        <button className="btn btn-xs btn-ghost" onClick={() => props.onMonth(monthStart(props.today))}>This month</button>
        <button className="btn btn-xs btn-ghost" onClick={() => props.onPick(props.today)}>Today</button>
      </div>
    </div>
  );
}

function emptyPlan(date: string): DayPlan {
  return { date, template_id: null, chapter_overrides: [], extra_chapters: [], chapters: null, auto: "default", auto_windows: [], occupied: null, notes: "" };
}

function setVariant(p: DayPlan, cid: string, key: string | null): DayPlan {
  const rest = p.chapter_overrides.filter((o) => o.chapter_id !== cid);
  return { ...p, chapter_overrides: key ? [...rest, { chapter_id: cid, variant_key: key }] : rest };
}

function newChapter(at: string, p: DayPlan): Chapter {
  const n = p.chapters?.length ?? 0;
  return {
    id: "own_" + Date.now().toString(36),
    name: "New chapter",
    note: "",
    color: COLORS[n % COLORS.length],
    enabled: true,
    start: { ...defaultStart("clock"), time: at },
    fade_minutes: 20,
    variants: [{ key: "default", label: "Default", when: {}, scene_ids: [], note: "" }],
    motion_entity: null,
    motion_hold_minutes: 5,
    reevaluate: true,
    music_only_on_entry: true,
  };
}

function dupChapter(p: DayPlan, c: ResolvedChapter, at: string): Chapter {
  const src = (p.chapters ?? []).find((x) => x.id === c.chapter_id);
  const base: Chapter = src ? { ...src, variants: src.variants.map((v) => ({ ...v })) } : { ...newChapter(at, p), name: c.name, color: c.color ?? null, variants: c.variants.map((v) => ({ ...v })), fade_minutes: c.fade_minutes, note: c.note };
  return { ...base, id: "own_" + Date.now().toString(36), name: base.name + " (copy)", start: { ...defaultStart("clock"), time: at } };
}

/** Slide-over pane for one day. */
function DayPane(props: { view: DayView; templates: Template[]; scenes: CadenceScene[]; focusChapter: string | null; onClose: () => void; onSaved: () => void; onCopy: () => void }) {
  const { view } = props;
  const groups = useSensorGroups();
  const [plan, setPlan] = useState<DayPlan>(view.plan ?? emptyPlan(view.date));
  const [openCh, setOpenCh] = useState<string | null>(props.focusChapter);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(plan) !== JSON.stringify(view.plan ?? emptyPlan(view.date));
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "center" });
  }, [props.focusChapter]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [props]);
  useEffect(() => setPlan(view.plan ?? emptyPlan(view.date)), [view]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setSaving(true);
    try {
      await fn();
      toast(ok);
      props.onSaved();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };
  const save = () => run(() => api.put(`api/plans/${view.date}`, plan), `Saved ${fmtDay(view.date)}`);
  const detach = () => run(() => api.post(`api/plans/${view.date}/detach`), "This day now has its own chapters");
  const reset = () => run(() => api.post(`api/plans/${view.date}/reset`), "Back on the template");
  const occ = (v: boolean | null) => run(() => api.post(`api/plans/${view.date}/occupied`, { occupied: v }), v ? "Forced occupied" : "Automatic occupancy");

  const vk = (cid: string) => plan.chapter_overrides.find((o) => o.chapter_id === cid)?.variant_key ?? null;
  const resolved = (cid: string) => view.chapters.find((c) => c.chapter_id === cid);
  const own = plan.chapters;
  const tmpl = props.templates.find((t) => t.id === view.template_id);
  const vacant = view.occupied === false;
  const dt = new Date(view.date + "T12:00:00");

  return (
    <>
      <div className="pane-backdrop" onMouseDown={props.onClose} />
      <div className="pane flex flex-col gap-4 p-4" role="dialog" aria-label={`Plan for ${fmtDay(view.date)}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="eyebrow">{dt.toLocaleDateString([], { weekday: "long" })}</div>
            <div className="display text-2xl leading-tight">{dt.toLocaleDateString([], { month: "long", day: "numeric" })}</div>
          </div>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={props.onClose} aria-label="Close">✕</button>
        </div>

        {/* occupancy */}
        <div className="rounded-box border border-base-300 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">{vacant ? "Vacant" : "Occupied"}</div>
              <div className="text-xs opacity-60">
                {view.occupied_reason === "forced" ? "Forced on with the + button." : view.occupied_reason === "calendar" ? "A calendar event matches your keywords." : view.occupied_reason === "sensor" ? "The occupied sensor was on." : view.occupied_reason === "always" ? "No calendar or sensor configured, so every day counts as occupied." : view.occupied_reason === "forced_off" ? "Forced vacant." : "No calendar event and the sensor has not been on."}
              </div>
            </div>
            {view.occupied_reason === "forced" || view.occupied_reason === "forced_off" ? (
              <button className="btn btn-sm btn-ghost" disabled={saving} onClick={() => occ(null)}>Automatic</button>
            ) : vacant ? (
              <button className="btn btn-sm btn-primary" disabled={saving} onClick={() => occ(true)}>+ Force occupied</button>
            ) : null}
          </div>
          {view.events.length ? (
            <div className="mt-2 border-t border-base-300 pt-2 text-xs">
              {view.events.map((e, i) => (
                <div key={i} className="truncate">
                  <span className="font-mono opacity-60">{e.all_day ? "all day" : fmtTime(e.start) + "–" + fmtTime(e.end)}</span> {e.summary}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* what runs */}
        <div className="rounded-box border border-base-300 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">{own ? "Own chapters" : view.template_kind === "none" ? "Nothing runs" : view.template_name}</div>
              <div className="text-xs opacity-60">
                {own ? "This day's chapters live on this date only. They are not a template; copy the day to reuse them." : view.template_kind === "vacant" ? "Vacant-day template." : view.template_kind === "custom" ? "Template chosen for this day." : view.template_kind === "default" ? "Guest-day template. Editing any chapter gives this day its own copy." : "No template applies. Force the day occupied or pick a template."}
              </div>
            </div>
            {own ? (
              <Confirm text="Back to template?" onYes={reset} className="btn btn-sm btn-ghost text-error">
                Reset
              </Confirm>
            ) : view.template_kind !== "none" ? (
              <button className="btn btn-sm btn-outline" disabled={saving} onClick={detach}>Customise</button>
            ) : null}
          </div>
          {!own ? (
            <Field label="Template for this day" className="mt-2">
              <select className="select select-sm w-full" value={plan.template_id ?? ""} onChange={(e) => setPlan({ ...plan, template_id: e.target.value || null })}>
                <option value="">Automatic (guest / vacant)</option>
                {props.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>

        <Field label="Auto mode">
          <div className="flex flex-wrap gap-1.5">
            {(["default", "on", "off", "windows"] as const).map((m) => (
              <Pill key={m} active={plan.auto === m} onClick={() => setPlan({ ...plan, auto: m })}>
                {m === "default" ? "Weekly schedule" : m === "windows" ? "Custom hours" : m === "on" ? "On all day" : "Off all day"}
              </Pill>
            ))}
          </div>
          {plan.auto === "windows" ? (
            <div className="mt-2">
              <WindowsEditor value={plan.auto_windows} onChange={(w) => setPlan({ ...plan, auto_windows: w })} />
            </div>
          ) : null}
        </Field>
        <Field label="Notes for the team">
          <textarea className="textarea textarea-sm w-full" value={plan.notes} onChange={(e) => setPlan({ ...plan, notes: e.target.value })} placeholder="Retreat group arriving at 4, keep the lounge bright…" />
        </Field>

        <div className="eyebrow">Chapters</div>
        {own
          ? own.map((c) => {
              const res = resolved(c.id);
              const isOpen = openCh === c.id;
              return (
                <div key={c.id} ref={props.focusChapter === c.id ? focusRef : undefined} className={"collapse rounded-box border bg-base-100 " + (isOpen ? "collapse-open border-primary/50" : "collapse-close border-base-300")}>
                  <div className="collapse-title flex min-h-0 cursor-pointer items-center gap-2 py-2 pr-2" onClick={() => setOpenCh(isOpen ? null : c.id)}>
                    <span className="swatch" style={{ background: c.color ?? "#556" }} />
                    <b className={"text-sm " + (c.enabled ? "" : "opacity-50")}>{c.name}</b>
                    <span className="font-mono text-xs opacity-60">{res?.start ? fmtTime(res.start) : describeStart(c.start, groups)}</span>
                    <span onClick={(e) => e.stopPropagation()} className="ml-auto">
                      <Confirm text="Remove?" onYes={() => setPlan({ ...plan, chapters: own.filter((x) => x.id !== c.id), chapter_overrides: plan.chapter_overrides.filter((o) => o.chapter_id !== c.id) })} className="btn btn-ghost btn-xs text-error">
                        ✕
                      </Confirm>
                    </span>
                  </div>
                  <div className="collapse-content">
                    {isOpen ? (
                      <>
                        {c.variants.length > 1 ? (
                          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="opacity-60">Force variant</span>
                            <Pill auto active={!vk(c.id)} onClick={() => setPlan(setVariant(plan, c.id, null))}>Auto</Pill>
                            {c.variants.map((v) => (
                              <Pill key={v.key} active={vk(c.id) === v.key} onClick={() => setPlan(setVariant(plan, c.id, v.key))}>
                                {v.label}
                              </Pill>
                            ))}
                          </div>
                        ) : null}
                        <ChapterEditor chapter={c} scenes={props.scenes} onChange={(patch) => setPlan({ ...plan, chapters: own.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) })} />
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })
          : (tmpl?.chapters ?? []).map((c) => {
              const res = resolved(c.id);
              return (
                <div key={c.id} ref={props.focusChapter === c.id ? focusRef : undefined} className={"flex items-center gap-2 rounded-box border border-base-300 px-3 py-2 " + (c.enabled ? "" : "opacity-50")}>
                  <span className="swatch" style={{ background: c.color ?? "#556" }} />
                  <b className="text-sm">{c.name}</b>
                  <span className="font-mono text-xs opacity-60">{res?.start ? fmtTime(res.start) : describeStart(c.start, groups)}</span>
                </div>
              );
            })}
        {own ? (
          <button className="btn btn-sm btn-outline border-dashed self-start" onClick={() => { const ch = newChapter("12:00", plan); setPlan({ ...plan, chapters: [...own, ch] }); setOpenCh(ch.id); }}>
            + Chapter
          </button>
        ) : tmpl ? (
          <p className="text-xs opacity-60">Following the template. Drag a chapter on the grid, right-click it, or press Customise to refine this day.</p>
        ) : null}

        <div className="sticky bottom-0 -mx-4 -mb-4 mt-auto flex gap-2 border-t border-base-300 bg-base-100 px-4 py-3">
          <button className="btn btn-primary btn-sm" disabled={saving || !dirty} onClick={save}>
            Save day
          </button>
          <button className="btn btn-sm btn-ghost" onClick={props.onCopy} title="Copy this day's chapters to paste onto other days">
            Copy day
          </button>
        </div>
      </div>
    </>
  );
}
