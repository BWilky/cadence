import { mdiArrowDown, mdiArrowUp, mdiBookOpenPageVariantOutline, mdiClose, mdiContentCopy, mdiFilterOutline, mdiPlus, mdiStarOutline, mdiTrashCanOutline } from "@mdi/js";
import { useEffect, useState } from "react";
import { api, describeStart, slug } from "../api";
import { ChapterEditor } from "../components/ChapterEditor";
import { RuleEditor, describeCondition, emptyRule } from "../components/RuleEditor";
import { defaultStart } from "../components/StartEditor";
import { Btn, COLORS, Chip, ColorDots, Confirm, Fold, Icon, IconBtn, Page, Section, toast } from "../components/ui";
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
  const rules = settings?.rules ?? [];

  return (
    <Page title="Templates" icon={mdiBookOpenPageVariantOutline}>
      <div className="cols split">
        <div className="col">
          <Section icon={mdiBookOpenPageVariantOutline} title="Templates" count={list.length} actions={<IconBtn icon={mdiPlus} size="sm" soft label="New template" onClick={() => create().catch((e) => toast(e.message, true))} />}>
            <p className="help">A template is one whole day: its chapters in order, and for each chapter the variants that react to sky, motion and occupancy.</p>
            <div className="list">
              {list.map((t) => (
                <button key={t.id} type="button" className={"list-item" + ("t:" + t.id === sel ? " on" : "")} onClick={() => setSel("t:" + t.id)}>
                  <span className="swatch" style={{ background: t.color ?? "#556" }} />
                  <span className="lt">
                    <span>
                      {t.name}
                      {settings?.default_template_id === t.id ? (
                        <Chip sm tone="ok">
                          default
                        </Chip>
                      ) : null}
                    </span>
                    <small>
                      {t.chapters.length} chapter{t.chapters.length === 1 ? "" : "s"}
                    </small>
                  </span>
                </button>
              ))}
              {list.length === 0 ? <div className="empty">No templates yet.</div> : null}
            </div>
          </Section>

          <Section icon={mdiFilterOutline} title="Rules" count={rules.length} actions={<IconBtn icon={mdiPlus} size="sm" soft label="New rule" onClick={() => createRule().catch((e) => toast(e.message, true))} />}>
            <p className="help">
              Rules apply a template to days automatically: from the calendar, the date, or a sensor on the day itself. Checked top to bottom, first match wins. Days nothing takes run the default template{settings?.default_template_id ? "" : " — none is set, so they run nothing"}.
            </p>
            <div className="list">
              {rules.map((r, i) => {
                const t = list.find((x) => x.id === r.template_id);
                return (
                  <button key={r.id} type="button" className={"list-item" + ("r:" + r.id === sel ? " on" : "") + (r.enabled ? "" : " dim")} onClick={() => setSel("r:" + r.id)}>
                    <span className="muted tnum text-[11px] w-4 text-right">{i + 1}</span>
                    <span className="swatch" style={{ background: t?.color ?? "#556" }} />
                    <span className="lt">
                      <span>
                        {r.name}
                        {!r.enabled ? <Chip sm>paused</Chip> : null}
                      </span>
                      <small>
                        → {r.template_id ? t?.name ?? r.template_id : "nothing"} · {r.conditions.length ? r.conditions.map(describeCondition).join(" & ") : "every day"}
                      </small>
                    </span>
                  </button>
                );
              })}
              {settings && rules.length === 0 ? <div className="empty">No rules yet.</div> : null}
            </div>
          </Section>
        </div>

        <div className="col">
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
            <Section>
              <div className="empty">Select or create a template or rule.</div>
            </Section>
          )}
        </div>
      </div>
    </Page>
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
    <div className="flex flex-col gap-3.5">
      <Section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <input type="text" className="input title" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            {!props.isDefault ? (
              <Btn sm icon={mdiStarOutline} onClick={makeDefault} title="Run this template on every day no rule or manual choice takes">
                Make default
              </Btn>
            ) : (
              <Chip tone="ok" title="Runs on every day no rule or manual choice takes">
                default
              </Chip>
            )}
            <Btn sm variant="ghost" icon={mdiContentCopy} onClick={props.onDuplicate}>
              Duplicate
            </Btn>
            {!props.isDefault ? (
              <Confirm text="Delete this template?" icon={mdiTrashCanOutline} sm onYes={remove}>
                Delete
              </Confirm>
            ) : null}
          </div>
        </div>
        <textarea className="textarea w-full" value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} placeholder="What kind of day is this?" />
        <div className="inline-text">
          <span>Colour in the planner</span>
          <ColorDots value={t.color} onChange={(c) => setT({ ...t, color: c })} />
        </div>
      </Section>

      <div className="flex flex-col gap-2">
        {t.chapters.map((c, i) => (
          <Fold
            key={c.id}
            open={open === c.id}
            onToggle={() => setOpen(open === c.id ? null : c.id)}
            dim={!c.enabled}
            head={
              <>
                <span className="swatch" style={{ background: c.color ?? "#556" }} />
                <span className="ft">{c.name}</span>
                <span className="fs">{describeStart(c.start, props.settings.sensor_groups)}</span>
                <span className="fs">
                  {c.variants.length} variant{c.variants.length === 1 ? "" : "s"}
                  {c.fade_minutes ? ` · ${c.fade_minutes} min fade` : ""}
                </span>
              </>
            }
            right={
              <>
                <IconBtn icon={mdiArrowUp} size="xs" label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
                <IconBtn icon={mdiArrowDown} size="xs" label="Move down" disabled={i >= t.chapters.length - 1} onClick={() => move(i, 1)} />
                <Confirm text="Remove?" icon={mdiClose} iconOnly sm onYes={() => setT({ ...t, chapters: t.chapters.filter((x) => x.id !== c.id) })}>
                  Remove chapter
                </Confirm>
              </>
            }
          >
            {open === c.id ? <ChapterEditor chapter={c} scenes={props.scenes} onChange={(p) => setChapter(c.id, p)} /> : null}
          </Fold>
        ))}
        <button type="button" className="add-tile" onClick={addChapter}>
          <Icon path={mdiPlus} />
          Add chapter
        </button>
      </div>
      <div className="savebar">
        <Btn variant="primary" disabled={!dirty || saving} onClick={save}>
          Save template
        </Btn>
        {dirty ? (
          <Btn variant="ghost" onClick={() => setT(props.template)}>
            Discard
          </Btn>
        ) : null}
        <span className="help">Chapters are ordered by their start time when the day is resolved; the list order is used for ties.</span>
      </div>
    </div>
  );
}
