import { mdiAccountGroupOutline, mdiCalendar, mdiCalendarMonthOutline, mdiChevronLeft, mdiChevronRight, mdiClose, mdiLoading, mdiPlus } from "@mdi/js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, api, describeStart, fmtTime, hhmm, minutesOfDay, todayISO, type useLive } from "../api";
import { ChapterEditor } from "../components/ChapterEditor";
import { ContextMenu, type MenuItem, type MenuState } from "../components/ContextMenu";
import { DayColumn } from "../components/DayColumn";
import { musicSummary } from "../components/MusicRow";
import { useSensorGroups } from "../components/SensorRef";
import { WindowsEditor, defaultStart } from "../components/StartEditor";
import type { TrackContext } from "../components/Track";
import { Btn, COLORS, Chip, Confirm, Field, Fold, Icon, IconBtn, Page, Row, Section, Segmented, toast } from "../components/ui";
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
const OCC_LABEL: Record<string, string> = { forced: "forced occupied", forced_off: "forced vacant", rule: "occupancy set by rule", template: "occupied", none: "vacant" };

/** One line on how a day's template was chosen, for headers and tooltips. */
function templateLine(d: DayView): string {
  if (d.detached) return "Own chapters";
  if (d.template_kind === "none") return d.rule_name ? `Nothing · ${d.rule_name}` : "Nothing runs";
  if (d.template_kind === "rule") return d.template_name ? `${d.template_name} · ${d.rule_name}` : `Nothing · ${d.rule_name}`;
  if (d.template_kind === "custom") return `${d.template_name ?? "?"} · chosen`;
  return d.template_name ?? "";
}

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
  const refreshDays = useCallback(
    async (dates: string[]) => {
      const sorted = [...dates].sort();
      await fetchRange(sorted[0], sorted[sorted.length - 1]);
    },
    [fetchRange],
  );

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
      items.push({ label: "Add chapter here", hint: at, onClick: () => editOwn(d, (p) => ({ ...p, chapters: [...(p.chapters ?? []), newChapter(at, p)] }), `Added a chapter at ${at}`) });
      items.push({ label: "Open day…", onClick: () => setOpen(d.date) });
      items.push({ divider: true, label: "" });
      items.push({
        label: "Copy day",
        onClick: () => {
          setClipboard(d.date);
          setPicked(new Set());
          toast(`Copied ${fmtDay(d.date)} — pick days, then paste`);
        },
      });
      if (clipboard && clipboard !== d.date) items.push({ label: `Paste ${fmtDay(clipboard)} here`, onClick: () => pasteOnto([d.date]) });
      if (clipboard && picked.size) items.push({ label: `Paste onto ${picked.size} selected day${picked.size > 1 ? "s" : ""}`, onClick: () => pasteOnto([...picked]) });
      if (d.detached || d.plan?.decision)
        items.push({
          label: d.detached ? "Reset to template" : "Let rules decide again",
          danger: true,
          onClick: () =>
            api
              .post(`api/plans/${d.date}/reset`)
              .then(() => refreshDay(d.date))
              .then(
                () => toast(`${fmtDay(d.date)} back to rules and default`),
                (e) => toast(e.message, true),
              ),
        });
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
  const nowLine = st?.now ? (minutesOfDay(st.now) / 60) * HOUR_H : null;

  const actions = (
    <>
      {loading ? <Icon path={mdiLoading} className="spin muted" size="sm" /> : null}
      <div className="legend hidden md:flex">
        <span>
          <span className="occ-dot rule" /> rule
        </span>
        <span>
          <span className="occ-dot chosen" /> chosen
        </span>
        <span>
          <span className="occ-dot own" /> own chapters
        </span>
        <span>
          <span className="occ-dot clash" /> rules clash
        </span>
      </div>
      <div className="flex items-center gap-1">
        <IconBtn icon={mdiChevronLeft} size="sm" label="Previous week" onClick={() => setStart(addDays(start, -7))} />
        <Btn sm onClick={() => setStart(weekStart(today))}>
          Today
        </Btn>
        <IconBtn icon={mdiChevronRight} size="sm" label="Next week" onClick={() => setStart(addDays(start, 7))} />
      </div>
      <div className="relative">
        <IconBtn
          icon={mdiCalendar}
          size="sm"
          soft
          label="Calendar"
          className={calOpen ? "on" : ""}
          onClick={() => {
            setCalMonth(monthStart(start));
            setCalOpen((v) => !v);
          }}
        />
        {calOpen ? (
          <MonthPopover
            month={calMonth}
            today={today}
            cache={cache}
            onMonth={setCalMonth}
            onPick={(d) => {
              setStart(weekStart(d));
              setCalOpen(false);
            }}
            onClose={() => setCalOpen(false)}
          />
        ) : null}
      </div>
    </>
  );

  return (
    <Page flush title={weekLabel} icon={mdiCalendarMonthOutline} actions={actions} className="min-h-0">
      {/* day headers */}
      <div className="week-head" style={{ gridTemplateColumns: `${GUTTER}px repeat(7, minmax(0, 1fr))` }}>
        <div />
        {weekDays.map((date) => {
          const d = cache[date];
          const dt = new Date(date + "T12:00:00");
          const isToday = date === today;
          const quiet = !!d && !d.detached && d.chapters.length === 0;
          const inPick = picked.has(date);
          const tint = d ? templates.find((t) => t.id === d.template_id)?.color ?? null : null;
          return (
            <div key={date} className={"day-head" + (isToday ? " today" : "") + (inPick ? " picked" : "")} style={tint ? { boxShadow: `inset 0 3px 0 ${tint}` } : undefined}>
              <button type="button" className="flex w-full items-baseline gap-1.5 text-left" onClick={() => (clipboard ? togglePick(date) : setOpen(date))} title={clipboard ? "Select for paste" : "Open this day"}>
                <span className="dow">{dt.toLocaleDateString([], { weekday: "short" })}</span>
                <span className={"num" + (quiet && !isToday ? " opacity-40" : "")}>{dt.getDate()}</span>
                {d ? <OccDots d={d} /> : null}
                {clipboard ? <input type="checkbox" className="ml-auto" checked={inPick} readOnly aria-label="Select for paste" /> : null}
              </button>
              <div
                className={"tl" + (quiet ? " opacity-60" : "") + (d?.predicted && d.template_kind === "rule" ? " italic" : "")}
                title={d ? `${d.template_reason}${d.predicted ? " (expected)" : d.decided ? " (settled)" : ""} · ${OCC_LABEL[d.occupied_reason] ?? ""}${d.pending_rules.length ? "\nMay still become: " + d.pending_rules.map((r) => r.rule_name).join(", ") : ""}` : ""}
              >
                <span className="truncate">{d ? templateLine(d) : ""}</span>
                {d && d.conflicts.length ? (
                  <span style={{ color: "var(--warn)" }} title={"Also matched: " + d.conflicts.map((c) => c.rule_name).join(", ") + ". The first rule wins."}>
                    ⚠
                  </span>
                ) : null}
                {d && d.pending_rules.length && !d.detached && d.template_kind !== "rule" && d.template_kind !== "custom" ? (
                  <span className="opacity-70" title={"May still become: " + d.pending_rules.map((r) => r.rule_name).join(", ")}>
                    ?
                  </span>
                ) : null}
              </div>
              {d && d.events.length ? (
                <div className="ev" title={d.events.map((e) => e.summary ?? "").join("\n")}>
                  {d.events[0].summary}
                  {d.events.length > 1 ? ` +${d.events.length - 1}` : ""}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* week grid */}
      <div ref={gridRef} className="relative min-h-0 flex-1 overflow-auto">
        <div className="grid week-grid" style={{ gridTemplateColumns: `${GUTTER}px repeat(7, minmax(0, 1fr))`, height: HOUR_H * 24 }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="hour-label" style={{ top: h * HOUR_H }}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          {nowLine != null && weekDays.includes(today) ? (
            <div className="now-line" style={{ top: nowLine }}>
              <span className="flag">{hhmm(nowLine / HOUR_H * 60)}</span>
            </div>
          ) : null}
          {weekDays.map((date) => {
            const d = cache[date];
            if (!d) return <div key={date} className="daycol" />;
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
                emptyText={d.template_kind === "none" || (d.template_kind === "rule" && !d.template_id) ? "nothing runs" : undefined}
                className={picked.has(date) ? "picked" : ""}
                playhead={false}
              />
            );
          })}
        </div>
      </div>

      {/* paste bar */}
      {clipboard ? (
        <div className="pastebar">
          <span>
            Copied <b>{fmtDay(clipboard)}</b>. Click day headers to select.
          </span>
          <Btn variant="primary" sm disabled={picked.size === 0} onClick={() => pasteOnto([...picked])}>
            Paste onto {picked.size || ""} day{picked.size === 1 ? "" : "s"}
          </Btn>
          <Btn
            variant="ghost"
            sm
            onClick={() => {
              setClipboard(null);
              setPicked(new Set());
            }}
          >
            Done
          </Btn>
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
    </Page>
  );
}

function fmtDay(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** Small occupancy / customisation marks next to the day number. */
function kindDot(d: DayView): string | null {
  if (d.detached) return null;
  return d.template_kind === "rule" ? "rule" : d.template_kind === "custom" ? "chosen" : null;
}

function OccDots({ d }: { d: DayView }) {
  const dot = kindDot(d);
  return (
    <span className="flex items-center gap-0.5" title={`${d.template_reason}${d.detached ? " · own chapters" : ""}`}>
      {dot ? <span className={"occ-dot " + dot + (d.predicted ? " opacity-50" : "")} /> : null}
      {d.detached ? <span className="occ-dot own" /> : null}
      {d.conflicts.length ? <span className="occ-dot clash" /> : null}
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
    <div ref={ref} className="month-pop">
      <div className="mb-2 flex items-center justify-between">
        <IconBtn icon={mdiChevronLeft} size="xs" label="Previous month" onClick={() => props.onMonth(prev)} />
        <span className="text-sm font-semibold">{m.toLocaleDateString([], { month: "long", year: "numeric" })}</span>
        <IconBtn icon={mdiChevronRight} size="xs" label="Next month" onClick={() => props.onMonth(nextM)} />
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[10px] uppercase muted">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((date) => {
          const d = props.cache[date];
          const inMonth = date.slice(0, 7) === first.slice(0, 7);
          const isToday = date === props.today;
          const occ = d ? kindDot(d) : null;
          return (
            <button key={date} type="button" className={"cell" + (inMonth ? "" : " out") + (isToday ? " today" : "")} onClick={() => props.onPick(date)} title={d ? templateLine(d) : undefined}>
              <span>{Number(date.slice(8, 10))}</span>
              <span className="flex h-1.5 items-center gap-0.5">
                {occ ? <span className={"occ-dot " + occ} /> : null}
                {d?.detached ? <span className="occ-dot own" /> : null}
                {d?.conflicts.length ? <span className="occ-dot clash" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between">
        <Btn variant="ghost" sm onClick={() => props.onMonth(monthStart(props.today))}>
          This month
        </Btn>
        <Btn variant="ghost" sm onClick={() => props.onPick(props.today)}>
          Today
        </Btn>
      </div>
    </div>
  );
}

function emptyPlan(date: string): DayPlan {
  return { date, template_id: null, chapter_overrides: [], extra_chapters: [], chapters: null, auto: "default", auto_windows: [], occupied: null, notes: "", decision: null };
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

/** Music and fade details for one resolved chapter, shown only in the pane (the grid stays clean). */
function ChapterDetail({ res, fade }: { res: ResolvedChapter | undefined; fade: number }) {
  const music = res?.music ?? [];
  if (!music.length && !fade) return null;
  // Group identical actions across zones: "mute · diningroom, foyer, lounge".
  const groups = new Map<string, string[]>();
  for (const m of music) {
    const key = musicSummary(m);
    const zone = (m.entity_id ?? "").replace(/^media_player\./, "").replace(/^bose_csp_/, "");
    groups.set(key, [...(groups.get(key) ?? []), zone].filter(Boolean));
  }
  return (
    <div className="flex flex-col gap-0.5 pl-6 text-[11px] muted">
      {fade ? <div>fade {fade} min</div> : null}
      {[...groups.entries()].map(([text, zones], i) => (
        <div key={i} className="truncate">
          <span className="opacity-70">♫</span> {text}
          {zones.length ? <span className="mono opacity-70"> · {zones.join(", ")}</span> : null}
        </div>
      ))}
    </div>
  );
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
  const reset = () => run(() => api.post(`api/plans/${view.date}/reset`), "Back to rules and the default");
  const occ = (v: boolean | null) => run(() => api.post(`api/plans/${view.date}/occupied`, { occupied: v }), v === null ? "Automatic occupancy" : v ? "Marked occupied" : "Marked vacant");

  const vk = (cid: string) => plan.chapter_overrides.find((o) => o.chapter_id === cid)?.variant_key ?? null;
  const resolved = (cid: string) => view.chapters.find((c) => c.chapter_id === cid);
  const own = plan.chapters;
  const tmpl = props.templates.find((t) => t.id === view.template_id);
  const vacant = view.occupied === false;
  const dt = new Date(view.date + "T12:00:00");

  const runsTitle = own ? "Own chapters" : view.template_name ?? "Nothing runs";
  const runsHelp = own
    ? "This day's chapters live on this date only. They are not a template; copy the day to reuse them."
    : view.template_kind === "custom"
      ? "Template chosen for this day. Rules leave it alone."
      : view.template_kind === "rule"
        ? `Rule "${view.rule_name}" (${view.template_reason.split(" · ").slice(1).join(" · ") || "matched"})${view.decided ? ", settled for the day." : view.predicted ? ", expected from the calendar." : "."}`
        : view.template_kind === "default"
          ? `The default template${view.predicted ? ", unless a rule takes the day" : ""}. Editing any chapter gives this day its own copy.`
          : "No rule took this day and there is no default template.";

  const chapterHead = (c: Chapter, res: ResolvedChapter | undefined) => (
    <>
      <span className="swatch" style={{ background: c.color ?? "#556" }} />
      <span className={"ft" + (c.enabled ? "" : " opacity-50")}>{c.name}</span>
      <span className="fs">{res?.start ? fmtTime(res.start) : describeStart(c.start, groups)}</span>
    </>
  );

  return (
    <>
      <div className="backdrop" onMouseDown={props.onClose} />
      <div className="pane" role="dialog" aria-label={`Plan for ${fmtDay(view.date)}`}>
        <header className="content-head">
          <h2>
            {dt.toLocaleDateString([], { weekday: "long" })}, {dt.toLocaleDateString([], { month: "long", day: "numeric" })}
          </h2>
          <button type="button" className="close" onClick={props.onClose} aria-label="Close">
            <Icon path={mdiClose} />
          </button>
        </header>
        <div className="body">
          {/* what runs */}
          <Section
            tint={own ? "accent" : undefined}
            title={runsTitle}
            style={tmpl?.color && !own ? { boxShadow: `inset 4px 0 0 ${tmpl.color}` } : undefined}
            actions={
              own ? (
                <Confirm text="Back to template?" onYes={reset} className="pill-btn danger" sm>
                  Reset
                </Confirm>
              ) : view.template_id ? (
                <Btn sm disabled={saving} onClick={detach}>
                  Customise
                </Btn>
              ) : null
            }
          >
            <p className="help">{runsHelp}</p>
            {view.conflicts.length ? (
              <p className="help" style={{ color: "var(--warn)" }}>
                Also matched: {view.conflicts.map((c) => c.rule_name).join(", ")}. The first rule in the list wins; reorder them under Templates → Rules.
              </p>
            ) : null}
            {view.pending_rules.length && !own && view.template_kind !== "custom" && view.template_kind !== "rule" ? <p className="help">May still become: {view.pending_rules.map((r) => `${r.rule_name}${r.template_name ? ` (${r.template_name})` : ""}`).join(", ")} — sensor rules are checked on the day.</p> : null}
            {!own ? (
              <Field label="Template for this day">
                <select className="select sm w-full" value={plan.template_id ?? ""} onChange={(e) => setPlan({ ...plan, template_id: e.target.value || null })}>
                  <option value="">Automatic (rules, then the default)</option>
                  {props.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {!own && plan.decision && !plan.template_id ? (
              <div className="flex items-center justify-between gap-2">
                <span className="help">
                  Decided {fmtTime(plan.decision.at)} by "{plan.decision.rule_name}".
                </span>
                <Confirm text="Let rules decide again?" onYes={reset} className="pill-btn ghost" sm>
                  Undo
                </Confirm>
              </div>
            ) : null}
          </Section>

          {/* occupancy & calendar */}
          <Section>
            <Row
              icon={mdiAccountGroupOutline}
              tone={vacant ? undefined : "on"}
              title={vacant ? "Vacant" : "Occupied"}
              sub={
                view.occupied_reason === "forced"
                  ? "Forced occupied. Variants that ask for an occupied day match."
                  : view.occupied_reason === "forced_off"
                    ? "Forced vacant. Variants that ask for an occupied day do not match."
                    : view.occupied_reason === "rule"
                      ? "Set by the rule that took this day."
                      : view.occupied_reason === "template"
                        ? "A template runs, so the day counts as occupied for variant conditions."
                        : "Nothing runs, so the day counts as vacant."
              }
              right={
                view.occupied_reason === "forced" || view.occupied_reason === "forced_off" ? (
                  <Btn sm disabled={saving} onClick={() => occ(null)}>
                    Automatic
                  </Btn>
                ) : (
                  <Btn sm disabled={saving} onClick={() => occ(!vacant ? false : true)}>
                    {vacant ? "Mark occupied" : "Mark vacant"}
                  </Btn>
                )
              }
            />
            {view.events.length ? (
              <>
                <div className="divider" />
                <div className="flex flex-col gap-0.5">
                  {view.events.map((e, i) => (
                    <p key={i} className="help truncate">
                      <span className="tnum">{e.all_day ? "all day" : fmtTime(e.start) + "–" + fmtTime(e.end)}</span> {e.summary}
                    </p>
                  ))}
                </div>
              </>
            ) : null}
          </Section>

          <Field label="Auto mode">
            <Segmented
              sm
              value={plan.auto}
              onChange={(m) => setPlan({ ...plan, auto: m })}
              options={[
                { value: "default", label: "Weekly schedule" },
                { value: "on", label: "On all day" },
                { value: "off", label: "Off all day" },
                { value: "windows", label: "Custom hours" },
              ]}
            />
            {plan.auto === "windows" ? (
              <div className="mt-2">
                <WindowsEditor value={plan.auto_windows} onChange={(w) => setPlan({ ...plan, auto_windows: w })} />
              </div>
            ) : null}
          </Field>
          <Field label="Notes for the team">
            <textarea className="textarea w-full" value={plan.notes} onChange={(e) => setPlan({ ...plan, notes: e.target.value })} placeholder="Retreat group arriving at 4, keep the lounge bright…" />
          </Field>

          <div className="sec-head">
            <span className="t">Chapters</span>
            <span className="count">{own ? `${own.length} own` : tmpl ? `${(tmpl.chapters ?? []).length} from ${tmpl.name}` : ""}</span>
          </div>
          {own
            ? own.map((c) => {
                const res = resolved(c.id);
                const isOpen = openCh === c.id;
                return (
                  <Fold
                    key={c.id}
                    innerRef={props.focusChapter === c.id ? focusRef : undefined}
                    open={isOpen}
                    onToggle={() => setOpenCh(isOpen ? null : c.id)}
                    dim={!c.enabled}
                    head={chapterHead(c, res)}
                    right={
                      <Confirm text="Remove?" icon={mdiClose} iconOnly sm onYes={() => setPlan({ ...plan, chapters: own.filter((x) => x.id !== c.id), chapter_overrides: plan.chapter_overrides.filter((o) => o.chapter_id !== c.id) })}>
                        Remove chapter
                      </Confirm>
                    }
                  >
                    {c.variants.length > 1 ? (
                      <div className="chips">
                        <span className="help">Force variant</span>
                        <Chip auto sm active={!vk(c.id)} onClick={() => setPlan(setVariant(plan, c.id, null))}>
                          Auto
                        </Chip>
                        {c.variants.map((v) => (
                          <Chip key={v.key} sm active={vk(c.id) === v.key} onClick={() => setPlan(setVariant(plan, c.id, v.key))}>
                            {v.label}
                          </Chip>
                        ))}
                      </div>
                    ) : null}
                    <ChapterEditor chapter={c} scenes={props.scenes} onChange={(patch) => setPlan({ ...plan, chapters: own.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) })} />
                  </Fold>
                );
              })
            : (tmpl?.chapters ?? []).map((c) => {
                const res = resolved(c.id);
                return (
                  <div key={c.id} ref={props.focusChapter === c.id ? focusRef : undefined} className={"sub" + (c.enabled ? "" : " opacity-50")}>
                    <div className="flex items-center gap-2 min-w-0">{chapterHead(c, res)}</div>
                    <ChapterDetail res={res} fade={c.fade_minutes} />
                  </div>
                );
              })}
          {own ? (
            <button
              type="button"
              className="add-tile"
              onClick={() => {
                const ch = newChapter("12:00", plan);
                setPlan({ ...plan, chapters: [...own, ch] });
                setOpenCh(ch.id);
              }}
            >
              <Icon path={mdiPlus} />
              Chapter
            </button>
          ) : tmpl ? (
            <p className="help">Following the template. Drag a chapter on the grid, right-click it, or press Customise to refine this day.</p>
          ) : null}
        </div>
        <div className="pane-foot">
          <Btn variant="primary" disabled={saving || !dirty} onClick={save}>
            Save day
          </Btn>
          <Btn variant="ghost" onClick={props.onCopy} title="Copy this day's chapters to paste onto other days">
            Copy day
          </Btn>
        </div>
      </div>
    </>
  );
}
