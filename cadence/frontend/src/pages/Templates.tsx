import { useEffect, useState } from "react";
import { api, describeStart, slug } from "../api";
import { defaultStart } from "../components/StartEditor";
import { ChapterEditor } from "../components/ChapterEditor";
import { RuleEditor, describeCondition, emptyRule } from "../components/RuleEditor";
import { COLORS, ColorDots, Confirm, toast } from "../components/ui";
import type { CadenceScene, Chapter, Settings, Template, TemplateRule } from "../types";

export function Templates() {
  const [list, setList] = useState<Template[]>([]);
  const [scenes, setScenes] = useState<CadenceScene[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sel, setSel] = useState<string | null>(null); // "t:<id>" or "r:<id>"

  const reload = async () => {
    const [t, s, st] = await Promise.all([api.get<Template[]>("api/templates"), api.get<CadenceScene[]>("api/scenes"), api.get<Settings>("api/settings")]);
    setList(t);
    setScenes(s);
    setSettings(st);
    setSel((cur) => cur ?? (st.default_template_id ? "t:" + st.default_template_id : t[0] ? "t:" + t[0].id : null));
  };
  useEffect(() => {
    reload().catch((e) => toast(e.message, true));
  }, []);

  const create = async () => {
    const name = window.prompt("Template name", "New day");
    if (!name) return;
    let id = slug(name);
    if (list.some((t) => t.id === id)) id += "_" + Date.now().toString(36);
    await api.put(`api/templates/${id}`, { id, name, description: "", color: COLORS[list.length % COLORS.length], chapters: [] });
    await reload();
    setSel("t:" + id);
  };
  const duplicate = async (t: Template) => {
    const id = slug(t.name + " copy") + "_" + Date.now().toString(36);
    await api.put(`api/templates/${id}`, { ...t, id, name: t.name + " (copy)" });
    await reload();
    setSel("t:" + id);
  };
  const saveRules = async (rules: TemplateRule[]) => {
    if (!settings) return;
    const r = await api.put<Settings>("api/settings", { ...settings, rules });
    setSettings(r);
  };
  const createRule = async () => {
    const name = window.prompt("Rule name", "Camp week");
    if (!name || !settings) return;
    let id = slug(name);
    if (settings.rules.some((r) => r.id === id)) id += "_" + Date.now().toString(36);
    await saveRules([...settings.rules, emptyRule(id, name, settings.default_template_id ?? list[0]?.id ?? null)]);
    setSel("r:" + id);
  };
  const current = sel?.startsWith("t:") ? list.find((t) => t.id === sel.slice(2)) ?? null : null;
  const currentRule = sel?.startsWith("r:") ? settings?.rules.find((r) => r.id === sel.slice(2)) ?? null : null;
  const ruleIndex = currentRule && settings ? settings.rules.indexOf(currentRule) : -1;

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
              <button className={"t:" + t.id === sel ? "menu-active" : ""} onClick={() => setSel("t:" + t.id)}>
                <span className="flex w-full min-w-0 flex-col items-start">
                  <span className="flex items-center gap-2">
                    <span className="swatch" style={{ background: t.color ?? "#556" }} />
                    {t.name} {settings?.default_template_id === t.id ? <span className="badge badge-xs badge-accent badge-soft">default</span> : null}
                  </span>
                  <span className="text-[11px] opacity-60">
                    {t.chapters.length} chapter{t.chapters.length === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-2 flex items-center justify-between">
          <h2 className="display text-2xl">Rules</h2>
          <button className="btn btn-sm btn-primary" onClick={() => createRule().catch((e) => toast(e.message, true))}>
            + New
          </button>
        </div>
        <p className="text-xs opacity-60">
          Rules apply a template to days automatically: from the calendar, the date, or a sensor on the day itself. Checked top to bottom, first match wins. Days nothing takes run the default template{settings?.default_template_id ? "" : " — none is set, so they run nothing"}.
        </p>
        <ul className="menu w-full rounded-box border border-base-300 bg-base-100 p-1">
          {(settings?.rules ?? []).map((r, i) => {
            const t = list.find((x) => x.id === r.template_id);
            return (
              <li key={r.id}>
                <button className={("r:" + r.id === sel ? "menu-active" : "") + (r.enabled ? "" : " opacity-50")} onClick={() => setSel("r:" + r.id)}>
                  <span className="flex w-full min-w-0 flex-col items-start">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[10px] opacity-50">{i + 1}</span>
                      <span className="swatch" style={{ background: t?.color ?? "#556" }} />
                      {r.name}
                      {!r.enabled ? <span className="badge badge-xs badge-ghost">paused</span> : null}
                    </span>
                    <span className="w-full truncate text-[11px] opacity-60">
                      → {r.template_id ? t?.name ?? r.template_id : "nothing"} · {r.conditions.length ? r.conditions.map(describeCondition).join(" & ") : "every day"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {settings && settings.rules.length === 0 ? <li className="px-3 py-2 text-xs opacity-50">No rules yet.</li> : null}
        </ul>
      </div>
      {currentRule && settings ? (
        <RuleEditor
          key={currentRule.id}
          rule={currentRule}
          templates={list}
          calendars={settings.calendars}
          index={ruleIndex}
          total={settings.rules.length}
          onSave={(r) => saveRules(settings.rules.map((x) => (x.id === r.id ? r : x)))}
          onDelete={async () => {
            await saveRules(settings.rules.filter((x) => x.id !== currentRule.id));
            setSel(null);
          }}
          onMove={async (dir) => {
            const arr = [...settings.rules];
            const j = ruleIndex + dir;
            if (j < 0 || j >= arr.length) return;
            [arr[ruleIndex], arr[j]] = [arr[j], arr[ruleIndex]];
            await saveRules(arr);
          }}
        />
      ) : current && settings ? (
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
        <div className="flex h-40 items-center justify-center rounded-box border border-dashed border-base-300 opacity-60">Select or create a template or rule.</div>
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
      toast(`${t.name} now runs on every day no rule takes`);
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
                <button className="btn btn-sm btn-outline btn-accent" onClick={makeDefault} title="Run this template on every day no rule or manual choice takes">
                  Make default
                </button>
              ) : (
                <span className="badge badge-accent badge-soft" title="Runs on every day no rule or manual choice takes">default</span>
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
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="opacity-60">Colour in the planner</span>
            <ColorDots value={t.color} onChange={(c) => setT({ ...t, color: c })} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {t.chapters.map((c, i) => (
          <div key={c.id} className={"collapse rounded-box border bg-base-100 shadow-sm " + (open === c.id ? "collapse-open border-base-content/20" : "collapse-close border-base-300") + (c.enabled ? "" : " opacity-60")}>
            <div className="collapse-title flex min-h-0 cursor-pointer items-center gap-3 py-3 pr-3" onClick={() => setOpen(open === c.id ? null : c.id)}>
              <span className="swatch" style={{ background: c.color ?? "#556" }} />
              <b className="display text-lg">{c.name}</b>
              <span className="font-mono text-xs opacity-60">{describeStart(c.start, props.settings.sensor_groups)}</span>
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
