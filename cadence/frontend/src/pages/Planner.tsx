import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, api, describeStart, fmtTime, todayISO, type useLive } from "../api";
import { StartEditor, WindowsEditor } from "../components/StartEditor";
import { Track } from "../components/Track";
import { Field, Pill, toast } from "../components/ui";
import type { ChapterOverride, DayPlan, DayView, ResolvedChapter, Template } from "../types";

const CHUNK = 21;

export function Planner({ live }: { live: ReturnType<typeof useLive> }) {
  const [days, setDays] = useState<DayView[]>([]);
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [focusChapter, setFocusChapter] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const today = todayISO();

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
      setDays((cur) => [...d, ...cur]);
      setRange({ start, end: range.end });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  }, [range, loading, fetchRange]);

  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    });
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

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_380px]">
      <div className={"overflow-auto px-4 py-3 " + (selected ? "hidden lg:block" : "")}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-xs opacity-60">
            Each row is a day: chapters left to right, <span className="text-accent">■</span> auto windows, <span className="text-primary">■</span> calendar events. Click a day to plan it.
          </div>
          <button className="btn btn-xs btn-ghost" disabled={loading} onClick={loadEarlier}>
            ↑ earlier days
          </button>
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
              {showMonth ? <div className="monthhead display text-xl opacity-80">{dt.toLocaleDateString([], { month: "long", year: "numeric" })}</div> : null}
              <div className={"grid grid-cols-[150px_1fr] items-start gap-3 border-b border-base-300 py-2 " + (isToday ? "bg-accent/5" : "")}>
                <button
                  type="button"
                  className={"flex flex-col items-start gap-1 rounded-box px-2 py-1.5 text-left hover:bg-base-200 " + (selected === d.date ? "bg-base-200 ring-1 ring-primary/60" : "")}
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
                      {d.events.slice(0, 3).map((e, j) => (
                        <span key={j} className="badge badge-xs badge-primary badge-soft max-w-[140px] truncate" title={e.summary ?? ""}>
                          {e.all_day ? "" : fmtTime(e.start) + " "}
                          {e.summary}
                        </span>
                      ))}
                      {d.events.length > 3 ? <span className="badge badge-xs badge-ghost">+{d.events.length - 3}</span> : null}
                    </div>
                  ) : null}
                </button>
                <div className="overflow-x-auto pb-0.5">
                  <div className="min-w-[720px]">
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
                      variantOf={(c) => (isToday && st?.chapter?.id === c.chapter_id ? st?.variant?.label : c.forced_variant ? c.forced_variant : null)}
                      onChapter={(c) => {
                        setSelected(d.date);
                        setFocusChapter(c.chapter_id);
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} className="flex h-12 items-center justify-center gap-2 text-xs opacity-60">
          {loading ? <span className="loading loading-dots loading-sm" /> : "scroll for more"}
        </div>
      </div>
      <aside className={"overflow-auto border-l border-base-300 bg-base-200 px-4 py-3 " + (selected ? "" : "hidden lg:block")}>
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
        <div className="rounded-box border border-base-300 bg-base-100/60 p-3 text-sm">
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

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-base-300 bg-base-200 px-4 py-3">
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
