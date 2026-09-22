import { useEffect, useState } from "react";
import { api, describeStart, slug } from "../api";
import { StartEditor, defaultStart } from "../components/StartEditor";
import { Confirm, EntityPicker, NumberInput, Toggle, toast } from "../components/ui";
import type { CadenceScene, Chapter, Settings, SkyState, Template, Variant } from "../types";

const COLORS = ["#3a4a7a", "#e8b45a", "#f0c86a", "#7fb1d6", "#9cc9a0", "#e89a5a", "#c4706e", "#9a6ab8", "#6ed3c6", "#8a9bb0"];

export function Templates() {
  const [list, setList] = useState<Template[]>([]);
  const [scenes, setScenes] = useState<CadenceScene[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  const reload = async () => {
    const [t, s, st] = await Promise.all([api.get<Template[]>("api/templates"), api.get<CadenceScene[]>("api/scenes"), api.get<Settings>("api/settings")]);
    setList(t);
    setScenes(s);
    setSettings(st);
    if (!sel && t.length) setSel(st.default_template_id ?? t[0].id);
  };
  useEffect(() => {
    reload().catch((e) => toast(e.message, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    const name = window.prompt("Template name", "New day");
    if (!name) return;
    let id = slug(name);
    if (list.some((t) => t.id === id)) id += "_" + Date.now().toString(36);
    const t: Template = { id, name, description: "", chapters: [] };
    await api.put(`api/templates/${id}`, t);
    await reload();
    setSel(id);
  };
  const duplicate = async (t: Template) => {
    const id = slug(t.name + " copy") + "_" + Date.now().toString(36);
    await api.put(`api/templates/${id}`, { ...t, id, name: t.name + " (copy)" });
    await reload();
    setSel(id);
  };
  const current = list.find((t) => t.id === sel) ?? null;

  return (
    <div className="split">
      <div className="stack">
        <div className="row between">
          <h2 className="serif" style={{ fontStyle: "italic", margin: 0, fontWeight: 400 }}>
            Templates
          </h2>
          <button className="btn sm" onClick={() => create().catch((e) => toast(e.message, true))}>
            + New
          </button>
        </div>
        <div className="help">A template is one whole day: its chapters in order, and for each chapter the variants that react to sky, motion and occupancy.</div>
        <div className="list">
          {list.map((t) => (
            <div key={t.id} className={"item" + (t.id === sel ? " active" : "")} onClick={() => setSel(t.id)}>
              <div style={{ flex: 1 }}>
                <div>
                  {t.name} {settings?.default_template_id === t.id ? <span className="chip live">default</span> : null}
                </div>
                <div className="help">
                  {t.chapters.length} chapter{t.chapters.length === 1 ? "" : "s"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {current && settings ? (
        <TemplateEditor
          key={current.id}
          template={current}
          scenes={scenes}
          settings={settings}
          isDefault={settings.default_template_id === current.id}
          onSaved={reload}
          onDuplicate={() => duplicate(current).catch((e) => toast(e.message, true))}
          onDeleted={() => {
            setSel(null);
            reload();
          }}
        />
      ) : (
        <div className="empty">Select or create a template.</div>
      )}
    </div>
  );
}

function TemplateEditor(props: { template: Template; scenes: CadenceScene[]; settings: Settings; isDefault: boolean; onSaved: () => Promise<void>; onDuplicate: () => void; onDeleted: () => void }) {
  const [t, setT] = useState<Template>(props.template);
  const [open, setOpen] = useState<string | null>(props.template.chapters[0]?.id ?? null);
  const dirty = JSON.stringify(t) !== JSON.stringify(props.template);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`api/templates/${t.id}`, t);
      await props.onSaved();
      toast("Template saved");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };
  const makeDefault = async () => {
    try {
      await api.put("api/settings", { ...props.settings, default_template_id: t.id });
      await props.onSaved();
      toast(`${t.name} is now the default day`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const remove = async () => {
    try {
      await api.del(`api/templates/${t.id}`);
      props.onDeleted();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const setChapter = (id: string, patch: Partial<Chapter>) => setT({ ...t, chapters: t.chapters.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const addChapter = () => {
    const id = "ch_" + Date.now().toString(36);
    const c: Chapter = {
      id,
      name: "New chapter",
      note: "",
      color: COLORS[t.chapters.length % COLORS.length],
      enabled: true,
      start: defaultStart("clock"),
      fade_minutes: 20,
      variants: [{ key: "default", label: "Default", when: {}, scene_ids: [], note: "" }],
      motion_entity: null,
      motion_hold_minutes: 5,
      reevaluate: true,
      music_only_on_entry: true,
    };
    setT({ ...t, chapters: [...t.chapters, c] });
    setOpen(id);
  };
  const move = (i: number, dir: -1 | 1) => {
    const arr = [...t.chapters];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setT({ ...t, chapters: arr });
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="row between">
          <input type="text" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 22, flex: 1 }} />
          <div className="row">
            {!props.isDefault ? (
              <button className="btn sm" onClick={makeDefault}>
                Make default
              </button>
            ) : (
              <span className="chip live">default day</span>
            )}
            <button className="btn sm ghost" onClick={props.onDuplicate}>
              Duplicate
            </button>
            {!props.isDefault ? (
              <Confirm text="Delete this template?" onYes={remove}>
                Delete
              </Confirm>
            ) : null}
          </div>
        </div>
        <textarea value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} placeholder="What kind of day is this?" style={{ marginTop: 8, width: "100%" }} />
      </div>

      <div className="stack">
        {t.chapters.map((c, i) => (
          <div key={c.id} className="card" style={{ borderColor: open === c.id ? "var(--line-2)" : undefined, opacity: c.enabled ? 1 : 0.6 }}>
            <div className="row between" style={{ cursor: "pointer" }} onClick={() => setOpen(open === c.id ? null : c.id)}>
              <div className="row">
                <span className="swatch" style={{ background: c.color ?? "#556" }} />
                <b className="serif" style={{ fontStyle: "italic", fontSize: 18 }}>
                  {c.name}
                </b>
                <span className="mono small text-2">{describeStart(c.start)}</span>
                <span className="small muted">
                  {c.variants.length} variant{c.variants.length === 1 ? "" : "s"}
                  {c.fade_minutes ? ` · ${c.fade_minutes} min fade` : ""}
                </span>
              </div>
              <div className="row" onClick={(e) => e.stopPropagation()}>
                <button className="btn sm ghost icon" title="Move up" onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button className="btn sm ghost icon" title="Move down" onClick={() => move(i, 1)}>
                  ↓
                </button>
                <Confirm text="Remove chapter?" onYes={() => setT({ ...t, chapters: t.chapters.filter((x) => x.id !== c.id) })} className="btn sm ghost danger">
                  ×
                </Confirm>
              </div>
            </div>
            {open === c.id ? <ChapterEditor chapter={c} scenes={props.scenes} onChange={(p) => setChapter(c.id, p)} /> : null}
          </div>
        ))}
        <button className="btn" onClick={addChapter}>
          + Add chapter
        </button>
      </div>
      <div className="row" style={{ position: "sticky", bottom: 0, background: "var(--ground)", padding: "10px 0" }}>
        <button className="btn primary" disabled={!dirty || saving} onClick={save}>
          Save template
        </button>
        {dirty ? (
          <button className="btn ghost" onClick={() => setT(props.template)}>
            Discard
          </button>
        ) : null}
        <span className="help">Chapters are ordered by their start time when the day is resolved; the list order is used for ties.</span>
      </div>
    </div>
  );
}

function ChapterEditor({ chapter: c, scenes, onChange }: { chapter: Chapter; scenes: CadenceScene[]; onChange: (p: Partial<Chapter>) => void }) {
  const setVariant = (i: number, patch: Partial<Variant>) => onChange({ variants: c.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const addVariant = () => onChange({ variants: [...c.variants, { key: "v" + Date.now().toString(36).slice(-4), label: "New variant", when: {}, scene_ids: [], note: "" }] });
  const moveV = (i: number, dir: -1 | 1) => {
    const arr = [...c.variants];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange({ variants: arr });
  };
  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <div className="row">
        <div className="field" style={{ flex: 2 }}>
          <label>Name</label>
          <input type="text" value={c.name} onChange={(e) => onChange({ name: e.target.value })} />
        </div>
        <div className="field">
          <label>Colour</label>
          <div className="row" style={{ gap: 4 }}>
            {COLORS.map((col) => (
              <button key={col} className="swatch" style={{ background: col, width: 18, height: 18, outline: c.color === col ? "2px solid var(--lamp)" : undefined, border: 0, cursor: "pointer" }} onClick={() => onChange({ color: col })} />
            ))}
          </div>
        </div>
        <div className="field">
          <label>Fade (min)</label>
          <NumberInput value={c.fade_minutes} onChange={(v) => onChange({ fade_minutes: v ?? 0 })} step={1} min={0} width={70} />
        </div>
      </div>
      <div className="field">
        <label>Starts</label>
        <StartEditor value={c.start} onChange={(s) => onChange({ start: s })} />
      </div>
      <div className="field">
        <label>Note (shown on the tablet)</label>
        <textarea value={c.note} onChange={(e) => onChange({ note: e.target.value })} />
      </div>
      <details className="adv">
        <summary>Motion & behaviour</summary>
        <div className="stack" style={{ paddingTop: 8 }}>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Motion sensor for this chapter (blank = global)</label>
              <EntityPicker value={c.motion_entity} onChange={(v) => onChange({ motion_entity: v })} domain="binary_sensor" />
            </div>
            <div className="field">
              <label>Motion hold (min)</label>
              <NumberInput value={c.motion_hold_minutes} onChange={(v) => onChange({ motion_hold_minutes: v ?? 5 })} step={1} min={0} width={70} />
            </div>
          </div>
          <Toggle checked={c.reevaluate} onChange={(v) => onChange({ reevaluate: v })} label="Switch variant mid-chapter" help="When the sky or motion changes during this chapter, move to the matching variant. Off = only evaluate on entry." />
          <Toggle checked={c.music_only_on_entry} onChange={(v) => onChange({ music_only_on_entry: v })} label="Start/stop music only when entering the chapter" help="Variant swaps still run volume, mute and source changes, but won't restart a playlist." />
          <Toggle checked={c.enabled} onChange={(v) => onChange({ enabled: v })} label="Chapter enabled" />
        </div>
      </details>

      <div className="eyebrow">Variants — first match wins, top to bottom</div>
      {c.variants.map((v, i) => (
        <div key={i} className="card" style={{ background: "var(--surface-2)" }}>
          <div className="row between">
            <div className="row">
              <input type="text" value={v.label} onChange={(e) => setVariant(i, { label: e.target.value, key: v.key || slug(e.target.value) })} style={{ width: 160 }} />
              <span className="tag">{v.key}</span>
            </div>
            <div className="row">
              <button className="btn sm ghost icon" onClick={() => moveV(i, -1)}>
                ↑
              </button>
              <button className="btn sm ghost icon" onClick={() => moveV(i, 1)}>
                ↓
              </button>
              <button className="btn sm ghost danger icon" onClick={() => onChange({ variants: c.variants.filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <span className="small text-2">When</span>
            <span className="small text-2">sky is</span>
            {(["sunny", "cloudy", "dark"] as SkyState[]).map((s) => {
              const on = v.when.sky?.includes(s) ?? false;
              return (
                <button
                  key={s}
                  className={"vbtn" + (on ? " active" : "")}
                  onClick={() => {
                    const cur = new Set(v.when.sky ?? []);
                    if (on) cur.delete(s);
                    else cur.add(s);
                    setVariant(i, { when: { ...v.when, sky: cur.size ? [...cur] : null } });
                  }}
                >
                  {s}
                </button>
              );
            })}
            <span className="small text-2">·</span>
            <select value={v.when.light ?? ""} onChange={(e) => setVariant(i, { when: { ...v.when, light: (e.target.value || null) as "light" | "dark" | null } })}>
              <option value="">any light</option>
              <option value="light">light outside</option>
              <option value="dark">dark outside</option>
            </select>
            <select value={v.when.motion == null ? "" : String(v.when.motion)} onChange={(e) => setVariant(i, { when: { ...v.when, motion: e.target.value === "" ? null : e.target.value === "true" } })}>
              <option value="">any motion</option>
              <option value="true">motion</option>
              <option value="false">quiet</option>
            </select>
            <select value={v.when.occupied == null ? "" : String(v.when.occupied)} onChange={(e) => setVariant(i, { when: { ...v.when, occupied: e.target.value === "" ? null : e.target.value === "true" } })}>
              <option value="">any occupancy</option>
              <option value="true">occupied</option>
              <option value="false">vacant</option>
            </select>
            <select value={v.when.asleep == null ? "" : String(v.when.asleep)} onChange={(e) => setVariant(i, { when: { ...v.when, asleep: e.target.value === "" ? null : e.target.value === "true" } })}>
              <option value="">asleep or not</option>
              <option value="true">asleep</option>
              <option value="false">awake</option>
            </select>
          </div>
          {Object.values(v.when).every((x) => x == null) ? <div className="help">No conditions — this variant is the fallback.</div> : null}
          <div className="row" style={{ marginTop: 8 }}>
            <span className="small text-2">Activate</span>
            {scenes.map((s) => {
              const on = v.scene_ids.includes(s.id);
              return (
                <button key={s.id} className={"vbtn" + (on ? " active" : "")} onClick={() => setVariant(i, { scene_ids: on ? v.scene_ids.filter((x) => x !== s.id) : [...v.scene_ids, s.id] })}>
                  <span className="swatch" style={{ background: s.color ?? "#556", display: "inline-block", marginRight: 6, verticalAlign: -1 }} />
                  {s.name}
                </button>
              );
            })}
            {scenes.length === 0 ? <span className="help">No Cadence scenes yet — create some under Scenes.</span> : null}
          </div>
        </div>
      ))}
      <button className="btn sm" onClick={addVariant}>
        + Add variant
      </button>
    </div>
  );
}
