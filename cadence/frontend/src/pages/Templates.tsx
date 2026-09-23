import { useEffect, useState } from "react";
import { api, describeStart, slug } from "../api";
import { defaultStart } from "../components/StartEditor";
import { ChapterEditor } from "../components/ChapterEditor";
import { COLORS, Confirm, toast } from "../components/ui";
import type { CadenceScene, Chapter, Settings, Template } from "../types";

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
