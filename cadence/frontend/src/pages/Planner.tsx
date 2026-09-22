import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, api, describeStart, fmtTime, todayISO, type useLive } from "../api";
import { StartEditor, WindowsEditor } from "../components/StartEditor";
import { Track } from "../components/Track";
import { toast } from "../components/ui";
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

  const fetchRange = useCallback(async (start: string, end: string) => {
    return api.get<DayView[]>(`api/days?start=${start}&end=${end}`);
  }, []);

  // initial load: a week back, three weeks ahead
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
    <div className={"planner" + (selected ? " editing" : "")}>
      <div className="days">
        <div className="row between" style={{ marginBottom: 8 }}>
          <div className="help">
            Each row is a day: chapters left to right, <span style={{ color: "var(--live)" }}>■</span> auto windows, <span style={{ color: "var(--lamp-2)" }}>■</span> calendar events. Click a day to plan it.
          </div>
          <button className="btn sm ghost" disabled={loading} onClick={loadEarlier}>
            ↑ earlier days
          </button>
        </div>
        {days.map((d, i) => {
          const month = d.date.slice(0, 7);
          const showMonth = i === 0 || days[i - 1].date.slice(0, 7) !== month;
          const dt = new Date(d.date + "T12:00:00");
          const weekend = dt.getDay() === 0 || dt.getDay() === 6;
          const isToday = d.date === today;
          return (
            <div key={d.date}>
              {showMonth ? <div className="monthhead">{dt.toLocaleDateString([], { month: "long", year: "numeric" })}</div> : null}
              <div className={"dayrow" + (selected === d.date ? " selected" : "") + (isToday ? " today" : "") + (weekend ? " weekend" : "")}>
                <div className="head" onClick={() => setSelected(selected === d.date ? null : d.date)}>
                  <div className="d">
                    {dt.toLocaleDateString([], { weekday: "short" })} {dt.getDate()}
                    {isToday ? <span className="chip live" style={{ marginLeft: 6 }}>today</span> : null}
                  </div>
                  <div className="t">
                    {d.template_name ?? "no template"}
                    {d.plan?.template_id ? " · override" : ""}
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    {d.occupied ? <span className="chip">occupied</span> : null}
                    {d.auto_mode === "off" ? <span className="chip off">auto off</span> : d.auto_mode === "on" ? <span className="chip live">auto on</span> : null}
                    {d.plan && (d.plan.chapter_overrides.length > 0 || d.plan.notes) ? <span className="tag">{d.plan.chapter_overrides.length ? `${d.plan.chapter_overrides.length} tweak${d.plan.chapter_overrides.length > 1 ? "s" : ""}` : "note"}</span> : null}
                  </div>
                  {d.events.length ? (
                    <div className="events">
                      {d.events.slice(0, 3).map((e, j) => (
                        <span key={j} className="ev" title={e.summary ?? ""}>
                          {e.all_day ? "" : fmtTime(e.start) + " "}
                          {e.summary}
                        </span>
                      ))}
                      {d.events.length > 3 ? <span className="ev">+{d.events.length - 3}</span> : null}
                    </div>
                  ) : null}
                </div>
                <div className="trackwrap">
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
          );
        })}
        <div ref={bottomRef} className="sentinel">
          {loading ? "loading…" : "scroll for more"}
        </div>
      </div>
      <aside className="side">
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
          <div className="stack">
            <div className="eyebrow">Day planner</div>
            <div className="help">
              Pick a day on the left. You can give it a different template, move chapter start times, force a variant, switch auto mode on or off, and leave a note for the team.
            </div>
            <div className="help">Days with a calendar event matching your keywords are marked occupied (Settings → Calendar).</div>
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
    <div className="stack">
      <div className="row between">
        <div>
          <div className="eyebrow">Plan for</div>
          <div className="serif" style={{ fontStyle: "italic", fontSize: 24 }}>
            {new Date(view.date + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </div>
        </div>
        <button className="btn sm ghost" onClick={props.onClose}>
          Close
        </button>
      </div>
      {view.events.length ? (
        <div className="card" style={{ padding: "8px 12px" }}>
          <div className="eyebrow">Calendar</div>
          {view.events.map((e, i) => (
            <div key={i} className="small">
              <span className="mono text-2">{e.all_day ? "all day" : fmtTime(e.start) + "–" + fmtTime(e.end)}</span> {e.summary}
            </div>
          ))}
        </div>
      ) : null}
      <div className="field">
        <label>Template</label>
        <select value={plan.template_id ?? ""} onChange={(e) => setPlan({ ...plan, template_id: e.target.value || null })}>
          <option value="">Default ({props.templates.find((t) => t.id === view.template_id && !view.plan?.template_id)?.name ?? view.template_name ?? "none"})</option>
          {props.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Auto mode</label>
        <div className="row">
          {(["default", "on", "off", "windows"] as const).map((m) => (
            <button key={m} className={"vbtn" + (plan.auto === m ? " active" : "")} onClick={() => setPlan({ ...plan, auto: m })}>
              {m === "default" ? "Weekly schedule" : m === "windows" ? "Custom hours" : m === "on" ? "On all day" : "Off all day"}
            </button>
          ))}
        </div>
        {plan.auto === "windows" ? <WindowsEditor value={plan.auto_windows} onChange={(w) => setPlan({ ...plan, auto_windows: w })} /> : null}
      </div>
      <div className="field">
        <label>Occupied</label>
        <div className="row">
          {([null, true, false] as const).map((v) => (
            <button key={String(v)} className={"vbtn" + (plan.occupied === v ? " active" : "") + (v === null ? " auto" : "")} onClick={() => setPlan({ ...plan, occupied: v })}>
              {v === null ? `From calendar (${view.occupied == null ? "unknown" : view.occupied ? "yes" : "no"})` : v ? "Yes" : "No"}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Notes for the team</label>
        <textarea value={plan.notes} onChange={(e) => setPlan({ ...plan, notes: e.target.value })} placeholder="Retreat group arriving at 4, keep the lounge bright…" />
      </div>

      <div className="eyebrow" style={{ marginTop: 6 }}>
        Chapters {tmpl ? `· ${tmpl.name}` : ""}
      </div>
      {!tmpl ? <div className="help">No template resolved for this day.</div> : null}
      {tmpl?.chapters.map((c) => {
        const ov = ovFor(c.id);
        const res = resolved(c.id);
        const enabled = ov?.enabled ?? c.enabled;
        const isFocus = props.focusChapter === c.id;
        return (
          <div key={c.id} ref={isFocus ? focusRef : undefined} className={"override" + (ov ? " changed" : "")} style={isFocus ? { boxShadow: "0 0 0 1px var(--lamp) inset" } : undefined}>
            <div className="row between">
              <div className="row">
                <span className="swatch" style={{ background: c.color ?? "#556" }} />
                <b className="serif" style={{ fontStyle: "italic", fontSize: 16, opacity: enabled ? 1 : 0.5 }}>
                  {c.name}
                </b>
                <span className="mono small text-2">{res?.start ? fmtTime(res.start) : describeStart(ov?.start ?? c.start)}</span>
              </div>
              <label className="row small" style={{ gap: 4 }}>
                <input type="checkbox" checked={enabled} onChange={(e) => setOv(c.id, { enabled: e.target.checked === c.enabled ? null : e.target.checked })} /> on
              </label>
            </div>
            <div className="row">
              <span className="small text-2">Start</span>
              {ov?.start ? (
                <>
                  <StartEditor value={ov.start} onChange={(s) => setOv(c.id, { start: s })} />
                  <button className="btn sm ghost" onClick={() => setOv(c.id, { start: null })}>
                    reset
                  </button>
                </>
              ) : (
                <>
                  <span className="small">{describeStart(c.start)}</span>
                  <button className="btn sm ghost" onClick={() => setOv(c.id, { start: { ...c.start } })}>
                    change
                  </button>
                </>
              )}
            </div>
            {c.variants.length > 1 ? (
              <div className="row">
                <span className="small text-2">Variant</span>
                <button className={"vbtn auto" + (!ov?.variant_key ? " active" : "")} onClick={() => setOv(c.id, { variant_key: null })}>
                  Auto
                </button>
                {c.variants.map((v) => (
                  <button key={v.key} className={"vbtn" + (ov?.variant_key === v.key ? " active" : "")} onClick={() => setOv(c.id, { variant_key: v.key })}>
                    {v.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="row" style={{ position: "sticky", bottom: 0, background: "var(--surface)", padding: "10px 0" }}>
        <button className="btn primary" disabled={saving || !dirty} onClick={save}>
          Save day
        </button>
        {view.plan ? (
          <button className="btn danger" disabled={saving} onClick={clear}>
            Remove overrides
          </button>
        ) : null}
      </div>
    </div>
  );
}
