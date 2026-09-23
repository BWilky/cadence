import { useEffect, useState } from "react";
import { api, describeStart, slug } from "../api";
import { StartEditor, defaultStart } from "../components/StartEditor";
import { COLORS, ColorDots, Confirm, EntityPicker, Field, NumberInput, Pill, Toggle, toast } from "../components/ui";
import type { CadenceScene, Chapter, Settings, SkyState, Template, Variant } from "../types";

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
    setSel((cur) => cur ?? st.default_template_id ?? t[0]?.id ?? null);
  };
  useEffect(() => {
    reload().catch((e) => toast(e.message, true));
  }, []);

  const create = async () => {
    const name = window.prompt("Template name", "New day");
    if (!name) return;
    let id = slug(name);
    if (list.some((t) => t.id === id)) id += "_" + Date.now().toString(36);
    await api.put(`api/templates/${id}`, { id, name, description: "", chapters: [] });
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
    <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[300px_1fr]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="display text-2xl">Templates</h2>
          <button className="btn btn-sm btn-primary" onClick={() => create().catch((e) => toast(e.message, true))}>
            + New
          </button>
        </div>
        <p className="text-xs opacity-60">A template is one whole day: its chapters in order, and for each chapter the variants that react to sky, motion and occupancy.</p>
        <ul className="menu w-full rounded-box border border-base-300 bg-base-100 p-1">
          {list.map((t) => (
            <li key={t.id}>
              <button className={"flex-col items-start gap-0 " + (t.id === sel ? "menu-active" : "")} onClick={() => setSel(t.id)}>
                <span className="flex items-center gap-2">
                  {t.name} {settings?.default_template_id === t.id ? <span className="badge badge-xs badge-accent badge-soft">default</span> : null}
                </span>
                <span className="text-[11px] opacity-60">
                  {t.chapters.length} chapter{t.chapters.length === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          ))}
        </ul>
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
        <div className="flex h-40 items-center justify-center rounded-box border border-dashed border-base-300 opacity-60">Select or create a template.</div>
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
    <div className="flex flex-col gap-4">
      <div className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <input type="text" className="input display flex-1 text-2xl" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
            <div className="flex items-center gap-2">
              {!props.isDefault ? (
                <button className="btn btn-sm btn-outline btn-accent" onClick={makeDefault}>
                  Make default
                </button>
              ) : (
                <span className="badge badge-accent badge-soft">default day</span>
              )}
              <button className="btn btn-sm btn-ghost" onClick={props.onDuplicate}>
                Duplicate
              </button>
              {!props.isDefault ? (
                <Confirm text="Delete this template?" onYes={remove}>
                  Delete
                </Confirm>
              ) : null}
            </div>
          </div>
          <textarea className="textarea textarea-sm w-full" value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} placeholder="What kind of day is this?" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {t.chapters.map((c, i) => (
          <div key={c.id} className={"collapse rounded-box border bg-base-100 shadow-sm " + (open === c.id ? "collapse-open border-base-content/20" : "collapse-close border-base-300") + (c.enabled ? "" : " opacity-60")}>
            <div className="collapse-title flex min-h-0 cursor-pointer items-center gap-3 py-3 pr-3" onClick={() => setOpen(open === c.id ? null : c.id)}>
              <span className="swatch" style={{ background: c.color ?? "#556" }} />
              <b className="display text-lg">{c.name}</b>
              <span className="font-mono text-xs opacity-60">{describeStart(c.start)}</span>
              <span className="text-xs opacity-50">
                {c.variants.length} variant{c.variants.length === 1 ? "" : "s"}
                {c.fade_minutes ? ` · ${c.fade_minutes} min fade` : ""}
              </span>
              <span className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-ghost btn-xs btn-square" title="Move up" onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button className="btn btn-ghost btn-xs btn-square" title="Move down" onClick={() => move(i, 1)}>
                  ↓
                </button>
                <Confirm text="Remove?" onYes={() => setT({ ...t, chapters: t.chapters.filter((x) => x.id !== c.id) })} className="btn btn-ghost btn-xs text-error">
                  ✕
                </Confirm>
              </span>
            </div>
            <div className="collapse-content">{open === c.id ? <ChapterEditor chapter={c} scenes={props.scenes} onChange={(p) => setChapter(c.id, p)} /> : null}</div>
          </div>
        ))}
        <button className="btn btn-outline btn-block border-dashed" onClick={addChapter}>
          + Add chapter
        </button>
      </div>
      <div className="sticky bottom-0 flex items-center gap-3 border-t border-base-300 bg-base-200 py-3">
        <button className="btn btn-primary btn-sm" disabled={!dirty || saving} onClick={save}>
          Save template
        </button>
        {dirty ? (
          <button className="btn btn-ghost btn-sm" onClick={() => setT(props.template)}>
            Discard
          </button>
        ) : null}
        <span className="text-xs opacity-60">Chapters are ordered by their start time when the day is resolved; the list order is used for ties.</span>
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
  const sel = (v: string | boolean | null | undefined) => (v == null ? "" : String(v));
  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="grid gap-3 md:grid-cols-[2fr_auto_auto]">
        <Field label="Name">
          <input type="text" className="input input-sm w-full" value={c.name} onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <Field label="Colour">
          <ColorDots value={c.color} onChange={(col) => onChange({ color: col })} />
        </Field>
        <Field label="Fade (min)">
          <NumberInput value={c.fade_minutes} onChange={(v) => onChange({ fade_minutes: v ?? 0 })} step={1} min={0} width={80} />
        </Field>
      </div>
      <Field label="Starts">
        <StartEditor value={c.start} onChange={(s) => onChange({ start: s })} />
      </Field>
      <Field label="Note (shown on the tablet)">
        <textarea className="textarea textarea-sm w-full" value={c.note} onChange={(e) => onChange({ note: e.target.value })} />
      </Field>
      <div className="collapse-arrow collapse rounded-box border border-base-300 bg-base-100 shadow-sm/60">
        <input type="checkbox" />
        <div className="collapse-title min-h-0 py-2 text-sm">Motion & behaviour</div>
        <div className="collapse-content flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Field label="Motion sensor for this chapter (blank = global)">
              <EntityPicker value={c.motion_entity} onChange={(v) => onChange({ motion_entity: v })} domain="binary_sensor" />
            </Field>
            <Field label="Motion hold (min)">
              <NumberInput value={c.motion_hold_minutes} onChange={(v) => onChange({ motion_hold_minutes: v ?? 5 })} step={1} min={0} width={80} />
            </Field>
          </div>
          <Toggle checked={c.reevaluate} onChange={(v) => onChange({ reevaluate: v })} label="Switch variant mid-chapter" help="When the sky or motion changes during this chapter, move to the matching variant. Off = only evaluate on entry." />
          <Toggle checked={c.music_only_on_entry} onChange={(v) => onChange({ music_only_on_entry: v })} label="Start/stop music only when entering the chapter" help="Variant swaps still run volume, mute and source changes, but won't restart a playlist." />
          <Toggle checked={c.enabled} onChange={(v) => onChange({ enabled: v })} label="Chapter enabled" color="toggle-accent" />
        </div>
      </div>

      <div className="eyebrow">Variants — first match wins, top to bottom</div>
      {c.variants.map((v, i) => (
        <div key={i} className="rounded-box border border-base-300 bg-base-200/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <input type="text" className="input input-sm w-44" value={v.label} onChange={(e) => setVariant(i, { label: e.target.value, key: v.key || slug(e.target.value) })} />
              <span className="badge badge-ghost badge-sm font-mono">{v.key}</span>
            </div>
            <div className="flex items-center gap-1">
              <button className="btn btn-ghost btn-xs btn-square" onClick={() => moveV(i, -1)}>
                ↑
              </button>
              <button className="btn btn-ghost btn-xs btn-square" onClick={() => moveV(i, 1)}>
                ↓
              </button>
              <button className="btn btn-ghost btn-xs btn-square text-error" onClick={() => onChange({ variants: c.variants.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="opacity-60">When sky is</span>
            {(["sunny", "cloudy", "dark"] as SkyState[]).map((s) => {
              const on = v.when.sky?.includes(s) ?? false;
              return (
                <Pill
                  key={s}
                  active={on}
                  onClick={() => {
                    const cur = new Set(v.when.sky ?? []);
                    if (on) cur.delete(s);
                    else cur.add(s);
                    setVariant(i, { when: { ...v.when, sky: cur.size ? [...cur] : null } });
                  }}
                >
                  {s}
                </Pill>
              );
            })}
            <select className="select select-xs w-auto" value={sel(v.when.light)} onChange={(e) => setVariant(i, { when: { ...v.when, light: (e.target.value || null) as "light" | "dark" | null } })}>
              <option value="">any light</option>
              <option value="light">light outside</option>
              <option value="dark">dark outside</option>
            </select>
            <select className="select select-xs w-auto" value={sel(v.when.motion)} onChange={(e) => setVariant(i, { when: { ...v.when, motion: e.target.value === "" ? null : e.target.value === "true" } })}>
              <option value="">any motion</option>
              <option value="true">motion</option>
              <option value="false">quiet</option>
            </select>
            <select className="select select-xs w-auto" value={sel(v.when.occupied)} onChange={(e) => setVariant(i, { when: { ...v.when, occupied: e.target.value === "" ? null : e.target.value === "true" } })}>
              <option value="">any occupancy</option>
              <option value="true">occupied</option>
              <option value="false">vacant</option>
            </select>
            <select className="select select-xs w-auto" value={sel(v.when.asleep)} onChange={(e) => setVariant(i, { when: { ...v.when, asleep: e.target.value === "" ? null : e.target.value === "true" } })}>
              <option value="">asleep or not</option>
              <option value="true">asleep</option>
              <option value="false">awake</option>
            </select>
          </div>
          {Object.values(v.when).every((x) => x == null) ? <div className="mt-1 text-xs opacity-50">No conditions — this variant is the fallback.</div> : null}
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="opacity-60">Activate</span>
            {scenes.map((s) => {
              const on = v.scene_ids.includes(s.id);
              return (
                <Pill key={s.id} active={on} onClick={() => setVariant(i, { scene_ids: on ? v.scene_ids.filter((x) => x !== s.id) : [...v.scene_ids, s.id] })}>
                  <span className="swatch h-2.5 w-2.5" style={{ background: s.color ?? "#556" }} />
                  {s.name}
                </Pill>
              );
            })}
            {scenes.length === 0 ? <span className="opacity-60">No Cadence scenes yet — create some under Scenes.</span> : null}
          </div>
        </div>
      ))}
      <button className="btn btn-sm btn-outline self-start" onClick={addVariant}>
        + Add variant
      </button>
    </div>
  );
}
