import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, api, describeStart, fmtTime, todayISO, type useLive } from "../api";
import { StartEditor, WindowsEditor } from "../components/StartEditor";
import { Track } from "../components/Track";
import { Field, Pill, toast } from "../components/ui";
import type { ChapterOverride, DayPlan, DayView, ResolvedChapter, Template } from "../types";

const CHUNK = 21;

const HEAD_W = 168; // px, pinned day-header column
const ZOOMS: { label: string; pph: number }[] = [
  { label: "6 h", pph: 220 },
  { label: "12 h", pph: 110 },
  { label: "18 h", pph: 72 },
  { label: "24 h", pph: 54 },
];

export function Planner({ live }: { live: ReturnType<typeof useLive> }) {
  const [days, setDays] = useState<DayView[]>([]);
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [focusChapter, setFocusChapter] = useState<string | null>(null);
  const [pph, setPph] = useState<number>(() => {
    const saved = Number(localStorage.getItem("cadence.planner.pph"));
    return ZOOMS.some((z) => z.pph === saved) ? saved : 110;
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const centered = useRef(false);
  const today = todayISO();
  const trackW = pph * 24;

  useEffect(() => {
    api.get<Template[]>("api/templates").then(setTemplates).catch(() => undefined);
  }, []);

  const fetchRange = useCallback(async (start: string, end: string) => api.get<DayView[]>(`api/days?start=${start}&end=${end}`), []);

  useEffect(() => {
    const start = addDays(today, -7);
    const end = addDays(today, CHUNK - 1);
    setLoading(true);
    fetchRange(start, end)
      .then((d) => {
        setDays(d);
        setRange({ start, end });
      })
      .catch((e) => toast(e.message, true))
      .finally(() => setLoading(false));
  }, [fetchRange, today]);

  /** Scroll the shared horizontal axis so `hour` sits in the middle of the visible track area. */
  const centerOn = useCallback(
    (hour: number, px = pph) => {
      const el = listRef.current;
      if (!el) return;
      const visible = el.clientWidth - HEAD_W;
      el.scrollLeft = Math.max(0, hour * px - visible / 2);
    },
    [pph],
  );

  // First paint: centre the day on noon.
  useEffect(() => {
    if (centered.current || days.length === 0) return;
    centered.current = true;
    centerOn(12);
  }, [days.length, centerOn]);

  const zoomTo = (next: number) => {
    const el = listRef.current;
    const visible = el ? el.clientWidth - HEAD_W : 0;
    const centerHour = el ? (el.scrollLeft + visible / 2) / pph : 12;
    setPph(next);
    localStorage.setItem("cadence.planner.pph", String(next));
    requestAnimationFrame(() => centerOn(centerHour, next));
  };

  const loadMore = useCallback(async () => {
    if (!range || loading) return;
    const start = addDays(range.end, 1);
    const end = addDays(range.end, CHUNK);
    setLoading(true);
    try {
      const d = await fetchRange(start, end);
      setDays((cur) => [...cur, ...d]);
      setRange({ start: range.start, end });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  }, [range, loading, fetchRange]);

  const loadEarlier = useCallback(async () => {
    if (!range || loading) return;
    const end = addDays(range.start, -1);
    const start = addDays(range.start, -CHUNK);
    setLoading(true);
    try {
      const d = await fetchRange(start, end);
      const el = listRef.current;
      const before = el?.scrollHeight ?? 0;
      setDays((cur) => [...d, ...cur]);
      setRange({ start, end: range.end });
      // keep the rows the user was looking at in place
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - before;
      });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  }, [range, loading, fetchRange]);

  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root: listRef.current },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const refreshDay = useCallback(
    async (date: string) => {
      const [d] = await fetchRange(date, date);
      setDays((cur) => cur.map((x) => (x.date === date ? d : x)));
    },
    [fetchRange],
  );

  const selectedView = useMemo(() => days.find((d) => d.date === selected) ?? null, [days, selected]);
  const st = live.status;
  const nowHour = st ? (() => { const d = new Date(st.now); return d.getHours() + d.getMinutes() / 60; })() : 12;

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className={"flex min-h-0 min-w-0 flex-col " + (selected ? "hidden lg:flex" : "")}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 bg-base-100 px-4 py-2">
          <div className="text-xs opacity-60">
            Each row is a day. Scroll sideways through the hours; <span className="text-accent">■</span> auto windows, <span className="text-primary">■</span> calendar events. Click a day to plan it.
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-xs btn-ghost" onClick={() => centerOn(12)} title="Centre on noon">
              Noon
            </button>
            <button className="btn btn-xs btn-ghost" onClick={() => centerOn(nowHour)} title="Centre on the current time">
              Now
            </button>
            <div className="join">
              {ZOOMS.map((z) => (
                <button key={z.pph} className={"btn btn-xs join-item " + (pph === z.pph ? "btn-neutral" : "btn-outline border-base-300")} onClick={() => zoomTo(z.pph)} title={`${z.label} across the view`}>
                  {z.label}
                </button>
              ))}
            </div>
            <button className="btn btn-xs btn-ghost" disabled={loading} onClick={loadEarlier}>
              ↑ earlier
            </button>
          </div>
        </div>

        <div ref={listRef} className="relative min-h-0 flex-1 overflow-auto bg-base-100">
          <div style={{ width: HEAD_W + trackW + 16 }}>
            {/* Shared hour ruler, pinned to the top */}
            <div className="sticky top-0 z-20 flex bg-base-100/95 shadow-sm backdrop-blur">
              <div className="sticky left-0 z-10 shrink-0 bg-base-100" style={{ width: HEAD_W }} />
              <div className="relative h-7 border-b border-base-300" style={{ width: trackW }}>
                {Array.from({ length: 25 }, (_, h) => (
                  <div key={h} className="absolute bottom-0 h-2 border-l border-base-content/25" style={{ left: h * pph }}>
                    {h < 24 ? <span className="absolute -top-4 left-1 font-mono text-[10px] opacity-60">{String(h).padStart(2, "0")}:00</span> : null}
                  </div>
                ))}
              </div>
            </div>

            {days.map((d, i) => {
              const month = d.date.slice(0, 7);
              const showMonth = i === 0 || days[i - 1].date.slice(0, 7) !== month;
              const dt = new Date(d.date + "T12:00:00");
              const weekend = dt.getDay() === 0 || dt.getDay() === 6;
              const isToday = d.date === today;
              const tweaks = d.plan?.chapter_overrides.length ?? 0;
              return (
                <div key={d.date}>
                  {showMonth ? (
                    <div className="sticky left-0 z-10 w-max bg-base-100 px-4 pt-3 pb-1">
                      <span className="display text-xl opacity-80">{dt.toLocaleDateString([], { month: "long", year: "numeric" })}</span>
                    </div>
                  ) : null}
                  <div className={"flex items-stretch border-b border-base-300 " + (isToday ? "bg-accent/10" : "")}>
                    <div className="sticky left-0 z-10 shrink-0 border-r border-base-300 bg-base-100 px-2 py-2" style={{ width: HEAD_W }}>
                      <button
                        type="button"
                        className={"flex w-full flex-col items-start gap-1 rounded-box px-2 py-1.5 text-left hover:bg-base-200/70 " + (selected === d.date ? "bg-primary/10 ring-1 ring-primary/60" : "")}
                        onClick={() => setSelected(selected === d.date ? null : d.date)}
                      >
                        <div className={"display text-lg leading-none " + (isToday ? "text-accent" : weekend ? "opacity-70" : "")}>
                          {dt.toLocaleDateString([], { weekday: "short" })} {dt.getDate()}
                          {isToday ? <span className="badge badge-xs badge-accent ml-2 align-middle">today</span> : null}
                        </div>
                        <div className="text-[11px] opacity-60">
                          {d.template_name ?? "no template"}
                          {d.plan?.template_id ? " · override" : ""}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {d.occupied ? <span className="badge badge-xs badge-primary badge-soft">occupied</span> : null}
                          {d.auto_mode === "off" ? <span className="badge badge-xs badge-ghost">auto off</span> : d.auto_mode === "on" ? <span className="badge badge-xs badge-accent badge-soft">auto on</span> : null}
                          {tweaks || d.plan?.notes ? <span className="badge badge-xs badge-outline">{tweaks ? `${tweaks} tweak${tweaks > 1 ? "s" : ""}` : "note"}</span> : null}
                        </div>
                        {d.events.length ? (
                          <div className="flex flex-wrap gap-1">
                            {d.events.slice(0, 2).map((e, j) => (
                              <span key={j} className="badge badge-xs badge-primary badge-soft max-w-[130px] truncate" title={e.summary ?? ""}>
                                {e.all_day ? "" : fmtTime(e.start) + " "}
                                {e.summary}
                              </span>
                            ))}
                            {d.events.length > 2 ? <span className="badge badge-xs badge-ghost">+{d.events.length - 2}</span> : null}
                          </div>
                        ) : null}
                      </button>
                    </div>
                    <div className="py-2 pl-2" style={{ width: trackW + 8 }}>
                      <Track
                        chapters={d.chapters}
                        date={d.date}
                        now={st?.now}
                        sunrise={d.sunrise}
                        sunset={d.sunset}
                        autoWindows={d.auto_windows}
                        autoMode={d.auto_mode}
                        events={d.events}
                        currentId={isToday ? st?.chapter?.id : null}
                        hourLabels={false}
                        className="h-16"
                        variantOf={(c) => (isToday && st?.chapter?.id === c.chapter_id ? st?.variant?.label : c.forced_variant ? c.forced_variant : null)}
                        onChapter={(c) => {
                          setSelected(d.date);
                          setFocusChapter(c.chapter_id);
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} className="sticky left-0 flex h-12 w-max items-center gap-2 px-4 text-xs opacity-60">
              {loading ? <span className="loading loading-dots loading-sm" /> : "scroll for more days"}
            </div>
          </div>
        </div>
      </div>
      <aside className={"overflow-auto border-l border-base-300 bg-base-100 px-4 py-3 " + (selected ? "" : "hidden lg:block")}>
        {selectedView ? (
          <DayEditor
            key={selectedView.date}
            view={selectedView}
            templates={templates}
            focusChapter={focusChapter}
            onClose={() => {
              setSelected(null);
              setFocusChapter(null);
            }}
            onSaved={() => refreshDay(selectedView.date)}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="eyebrow">Day planner</div>
            <p className="text-sm opacity-70">Pick a day on the left. You can give it a different template, move chapter start times, force a variant, switch auto mode on or off, and leave a note for the team.</p>
            <p className="text-xs opacity-60">Days with a calendar event matching your keywords are marked occupied (Settings → Calendar).</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function emptyPlan(date: string): DayPlan {
  return { date, template_id: null, chapter_overrides: [], auto: "default", auto_windows: [], occupied: null, notes: "" };
}

function DayEditor(props: { view: DayView; templates: Template[]; focusChapter: string | null; onClose: () => void; onSaved: () => void }) {
  const { view } = props;
  const [plan, setPlan] = useState<DayPlan>(view.plan ?? emptyPlan(view.date));
  const [saving, setSaving] = useState(false);
  const tmplId = plan.template_id ?? view.template_id;
  const tmpl = props.templates.find((t) => t.id === tmplId);
  const dirty = JSON.stringify(plan) !== JSON.stringify(view.plan ?? emptyPlan(view.date));
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "center" });
  }, [props.focusChapter]);

  const ovFor = (cid: string): ChapterOverride | undefined => plan.chapter_overrides.find((o) => o.chapter_id === cid);
  const setOv = (cid: string, patch: Partial<ChapterOverride> | null) => {
    setPlan((p) => {
      const rest = p.chapter_overrides.filter((o) => o.chapter_id !== cid);
      if (patch === null) return { ...p, chapter_overrides: rest };
      const cur = p.chapter_overrides.find((o) => o.chapter_id === cid) ?? { chapter_id: cid };
      const next = { ...cur, ...patch };
      const empty = next.start == null && next.variant_key == null && next.enabled == null;
      return { ...p, chapter_overrides: empty ? rest : [...rest, next] };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const isEmpty = !plan.template_id && plan.chapter_overrides.length === 0 && plan.auto === "default" && plan.occupied == null && !plan.notes;
      if (isEmpty) await api.del(`api/plans/${view.date}`);
      else await api.put(`api/plans/${view.date}`, plan);
      toast(`Saved ${view.date}`);
      props.onSaved();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };
  const clear = async () => {
    setSaving(true);
    try {
      await api.del(`api/plans/${view.date}`);
      setPlan(emptyPlan(view.date));
      toast("Back to the default day");
      props.onSaved();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };
  const resolved = (cid: string): ResolvedChapter | undefined => view.chapters.find((c) => c.chapter_id === cid);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="eyebrow">Plan for</div>
          <div className="display text-2xl leading-tight">{new Date(view.date + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</div>
        </div>
        <button className="btn btn-ghost btn-sm btn-circle" onClick={props.onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {view.events.length ? (
        <div className="rounded-box border border-base-300 bg-base-200/60 p-3 text-sm">
          <div className="eyebrow mb-1">Calendar</div>
          {view.events.map((e, i) => (
            <div key={i} className="truncate">
              <span className="font-mono text-xs opacity-60">{e.all_day ? "all day" : fmtTime(e.start) + "–" + fmtTime(e.end)}</span> {e.summary}
            </div>
          ))}
        </div>
      ) : null}
      <Field label="Template">
        <select className="select select-sm w-full" value={plan.template_id ?? ""} onChange={(e) => setPlan({ ...plan, template_id: e.target.value || null })}>
          <option value="">Default ({props.templates.find((t) => t.id === view.template_id && !view.plan?.template_id)?.name ?? view.template_name ?? "none"})</option>
          {props.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
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
      <Field label="Occupied">
        <div className="flex flex-wrap gap-1.5">
          {([null, true, false] as const).map((v) => (
            <Pill key={String(v)} active={plan.occupied === v} auto={v === null} onClick={() => setPlan({ ...plan, occupied: v })}>
              {v === null ? `From calendar (${view.occupied == null ? "unknown" : view.occupied ? "yes" : "no"})` : v ? "Yes" : "No"}
            </Pill>
          ))}
        </div>
      </Field>
      <Field label="Notes for the team">
        <textarea className="textarea textarea-sm w-full" value={plan.notes} onChange={(e) => setPlan({ ...plan, notes: e.target.value })} placeholder="Retreat group arriving at 4, keep the lounge bright…" />
      </Field>

      <div className="eyebrow">Chapters {tmpl ? `· ${tmpl.name}` : ""}</div>
      {!tmpl ? <p className="text-xs opacity-60">No template resolved for this day.</p> : null}
      {tmpl?.chapters.map((c) => {
        const ov = ovFor(c.id);
        const res = resolved(c.id);
        const enabled = ov?.enabled ?? c.enabled;
        const isFocus = props.focusChapter === c.id;
        return (
          <div key={c.id} ref={isFocus ? focusRef : undefined} className={"flex flex-col gap-2 rounded-box border p-3 " + (ov ? "border-primary/50" : "border-base-300") + (isFocus ? " ring-1 ring-primary" : "")}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="swatch" style={{ background: c.color ?? "#556" }} />
                <b className={"display text-base " + (enabled ? "" : "opacity-50")}>{c.name}</b>
                <span className="font-mono text-xs opacity-60">{res?.start ? fmtTime(res.start) : describeStart(ov?.start ?? c.start)}</span>
              </div>
              <input type="checkbox" className="toggle toggle-xs toggle-accent" checked={enabled} onChange={(e) => setOv(c.id, { enabled: e.target.checked === c.enabled ? null : e.target.checked })} title="Chapter on/off for this day" />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="opacity-60">Start</span>
              {ov?.start ? (
                <>
                  <StartEditor value={ov.start} onChange={(s) => setOv(c.id, { start: s })} />
                  <button className="btn btn-ghost btn-xs" onClick={() => setOv(c.id, { start: null })}>
                    reset
                  </button>
                </>
              ) : (
                <>
                  <span>{describeStart(c.start)}</span>
                  <button className="btn btn-ghost btn-xs" onClick={() => setOv(c.id, { start: { ...c.start } })}>
                    change
                  </button>
                </>
              )}
            </div>
            {c.variants.length > 1 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="opacity-60">Variant</span>
                <Pill auto active={!ov?.variant_key} onClick={() => setOv(c.id, { variant_key: null })}>
                  Auto
                </Pill>
                {c.variants.map((v) => (
                  <Pill key={v.key} active={ov?.variant_key === v.key} onClick={() => setOv(c.id, { variant_key: v.key })}>
                    {v.label}
                  </Pill>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-base-300 bg-base-100 px-4 py-3">
        <button className="btn btn-primary btn-sm" disabled={saving || !dirty} onClick={save}>
          Save day
        </button>
        {view.plan ? (
          <button className="btn btn-outline btn-error btn-sm" disabled={saving} onClick={clear}>
            Remove overrides
          </button>
        ) : null}
      </div>
    </div>
  );
}
