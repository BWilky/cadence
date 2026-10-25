import { mdiArrowDown, mdiArrowUp, mdiCalendarRange, mdiClose, mdiEyeOutline, mdiFilterOutline, mdiPlus, mdiTrashCanOutline, mdiTuneVariant } from "@mdi/js";
import { useState } from "react";
import { addDays, api, todayISO } from "../api";
import type { RuleCondition, RuleConditionKind, Template, TemplateRule } from "../types";
import { SensorRef } from "./SensorRef";
import { Btn, Chip, Confirm, EntityPicker, Field, IconBtn, NumberInput, Section, Segmented, Toggle, toast } from "./ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KIND_LABEL: Record<RuleConditionKind, string> = {
  calendar: "Calendar event",
  weekday: "Day of the week",
  date_range: "Date range",
  entity: "Sensor is on / off",
  numeric: "Number above / below",
};

export function emptyCondition(kind: RuleConditionKind = "calendar"): RuleCondition {
  return { kind, negate: false, calendars: [], field: "summary", match: "contains", terms: [], all_day: null, weekdays: [], start: null, end: null, entity_id: null, state: "on", above: null, below: null };
}

export function emptyRule(id: string, name: string, templateId: string | null): TemplateRule {
  return { id, name, enabled: true, template_id: templateId, conditions: [emptyCondition()], valid_from: null, valid_until: null, set_occupied: null, auto: "default", note: "" };
}

/** Short label for a condition, used in lists and tooltips. */
export function describeCondition(c: RuleCondition): string {
  const neg = c.negate ? "not " : "";
  switch (c.kind) {
    case "calendar": {
      const terms = c.terms.filter((t) => t.trim()).join(", ");
      return neg + (terms ? `${c.field} ${c.match} ${terms}` : "any calendar event");
    }
    case "weekday":
      return neg + c.weekdays.slice().sort().map((d) => DAYS[d]).join(", ");
    case "date_range":
      return `${neg}${c.start ?? "…"} – ${c.end ?? "…"}`;
    case "entity":
      return `${neg}${c.entity_id ?? "?"} is ${c.state}`;
    default: {
      const parts = [c.above != null ? `> ${c.above}` : null, c.below != null ? `< ${c.below}` : null].filter(Boolean);
      return `${neg}${c.entity_id ?? "?"} ${parts.join(" and ") || "?"}`;
    }
  }
}

export function RuleEditor(props: {
  rule: TemplateRule;
  templates: Template[];
  calendars: string[];
  index: number;
  total: number;
  onSave: (r: TemplateRule) => Promise<void>;
  onDelete: () => Promise<void>;
  onMove: (dir: -1 | 1) => Promise<void>;
}) {
  const [r, setR] = useState<TemplateRule>(props.rule);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ matches: { date: string; why: string; day_of: boolean }[]; live: boolean } | null>(null);
  const dirty = JSON.stringify(r) !== JSON.stringify(props.rule);
  const live = r.conditions.some((c) => c.kind === "entity" || c.kind === "numeric");

  const save = async () => {
    setSaving(true);
    try {
      await props.onSave(r);
      toast("Rule saved");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };
  const runPreview = async () => {
    try {
      const start = todayISO();
      const res = await api.post<typeof preview>("api/rules/preview", { rule: r, start, end: addDays(start, 90) });
      setPreview(res);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const setCond = (i: number, patch: Partial<RuleCondition>) => setR({ ...r, conditions: r.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <div className="flex flex-col gap-3.5">
      <Section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <input type="text" className="input title" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="help tnum">
              Priority {props.index + 1} of {props.total}
            </span>
            <IconBtn icon={mdiArrowUp} size="xs" label="Check earlier (higher priority)" disabled={props.index === 0} onClick={() => props.onMove(-1).catch((e) => toast(e.message, true))} />
            <IconBtn icon={mdiArrowDown} size="xs" label="Check later (lower priority)" disabled={props.index >= props.total - 1} onClick={() => props.onMove(1).catch((e) => toast(e.message, true))} />
            <Confirm text="Delete this rule?" icon={mdiTrashCanOutline} sm onYes={() => props.onDelete().catch((e) => toast(e.message, true))}>
              Delete
            </Confirm>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Days this rule takes run" help="Choose 'Nothing' to keep Cadence quiet on matching days (closed days, for example).">
            <select className="select sm w-full" value={r.template_id ?? ""} onChange={(e) => setR({ ...r, template_id: e.target.value || null })}>
              <option value="">Nothing — Cadence leaves the building alone</option>
              {props.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Enabled">
            <Toggle checked={r.enabled} onChange={(v) => setR({ ...r, enabled: v })} label={r.enabled ? "Active" : "Paused"} help={r.enabled ? "Checked on matching days" : "Skipped until switched back on"} />
          </Field>
        </div>
      </Section>

      <Section
        icon={mdiFilterOutline}
        title="When every one of these holds"
        intro="Calendar and date conditions are known in advance, so the planner shows these days ahead of time. Sensor conditions are checked on the day itself, every few seconds until the cut-off in Settings, and the first rule to match takes the day."
      >
        {r.conditions.map((c, i) => (
          <ConditionRow key={i} c={c} calendars={props.calendars} onChange={(patch) => setCond(i, patch)} onRemove={() => setR({ ...r, conditions: r.conditions.filter((_, j) => j !== i) })} />
        ))}
        <div className="chips">
          {(Object.keys(KIND_LABEL) as RuleConditionKind[]).map((k) => (
            <Btn key={k} sm icon={mdiPlus} onClick={() => setR({ ...r, conditions: [...r.conditions, emptyCondition(k)] })}>
              {KIND_LABEL[k]}
            </Btn>
          ))}
        </div>
        {r.conditions.length === 0 ? (
          <p className="help" style={{ color: "var(--warn)" }}>
            No conditions: this rule takes every day in its validity window.
          </p>
        ) : null}
      </Section>

      <Section icon={mdiCalendarRange} title="Only between">
        <div className="fields">
          <Field label="From" help="YYYY-MM-DD, or MM-DD to repeat every year">
            <input type="text" className="input sm mono w-36" placeholder="06-01" value={r.valid_from ?? ""} onChange={(e) => setR({ ...r, valid_from: e.target.value || null })} />
          </Field>
          <Field label="Until">
            <input type="text" className="input sm mono w-36" placeholder="08-31" value={r.valid_until ?? ""} onChange={(e) => setR({ ...r, valid_until: e.target.value || null })} />
          </Field>
          <span className="help pb-2">Leave both empty for always.</span>
        </div>
      </Section>

      <Section icon={mdiTuneVariant} title="Also set on the day">
        <div className="form-grid">
          <Field label="Occupied (for variants)">
            <select className="select sm w-full" value={r.set_occupied == null ? "" : r.set_occupied ? "yes" : "no"} onChange={(e) => setR({ ...r, set_occupied: e.target.value === "" ? null : e.target.value === "yes" })}>
              <option value="">Leave as is</option>
              <option value="yes">Occupied</option>
              <option value="no">Vacant</option>
            </select>
          </Field>
          <Field label="Auto mode">
            <select className="select sm w-full" value={r.auto} onChange={(e) => setR({ ...r, auto: e.target.value as TemplateRule["auto"] })}>
              <option value="default">Leave as is</option>
              <option value="on">On all day</option>
              <option value="off">Off all day</option>
            </select>
          </Field>
          <Field label="Note for the team">
            <input type="text" className="input sm w-full" value={r.note} onChange={(e) => setR({ ...r, note: e.target.value })} placeholder="Camp week: lounge stays bright" />
          </Field>
        </div>
      </Section>

      <Section
        icon={mdiEyeOutline}
        title="Preview"
        actions={
          <Btn sm onClick={runPreview}>
            Check the next 90 days
          </Btn>
        }
      >
        {preview ? (
          preview.matches.length === 0 ? (
            <p className="help">No day in the next 90 days matches{live ? " on its calendar and date conditions" : ""}.</p>
          ) : (
            <>
              <p className="help">
                {preview.matches.length} day{preview.matches.length === 1 ? "" : "s"}
                {live ? " pass the calendar and date conditions; the sensor conditions are checked on the day itself." : "."} Other rules are ignored here: a rule above this one may still win.
              </p>
              <div className="grid max-h-64 gap-1 overflow-auto text-xs sm:grid-cols-2">
                {preview.matches.map((m) => (
                  <div key={m.date} className="flex items-center gap-2">
                    <span className="tnum">{m.date}</span>
                    <span className="truncate muted">{m.why}</span>
                    {m.day_of ? <Chip sm>day-of</Chip> : null}
                  </div>
                ))}
              </div>
            </>
          )
        ) : (
          <p className="help">Lists the days this rule would take, judged on calendar and date conditions.</p>
        )}
      </Section>

      <div className="savebar">
        <Btn variant="primary" disabled={!dirty || saving} onClick={save}>
          Save rule
        </Btn>
        {dirty ? (
          <Btn variant="ghost" onClick={() => setR(props.rule)}>
            Discard
          </Btn>
        ) : null}
        <span className="help">Rules are checked top to bottom; the first that matches wins. Days with a template chosen by hand, or their own chapters, are never touched.</span>
      </div>
    </div>
  );
}

function ConditionRow({ c, calendars, onChange, onRemove }: { c: RuleCondition; calendars: string[]; onChange: (p: Partial<RuleCondition>) => void; onRemove: () => void }) {
  return (
    <div className="sub">
      <div className="flex flex-wrap items-center gap-2">
        <select className="select sm w-48" value={c.kind} onChange={(e) => onChange({ ...emptyCondition(e.target.value as RuleConditionKind), negate: c.negate })}>
          {(Object.keys(KIND_LABEL) as RuleConditionKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <Segmented
          sm
          fit
          value={c.negate ? "not" : "must"}
          options={[
            { value: "must", label: "must" },
            { value: "not", label: "must not" },
          ]}
          onChange={(v) => onChange({ negate: v === "not" })}
        />
        <span className="ml-auto">
          <Confirm text="Remove?" icon={mdiClose} iconOnly sm onYes={onRemove}>
            Remove condition
          </Confirm>
        </span>
      </div>
      {c.kind === "calendar" ? (
        <div className="grid gap-2 md:grid-cols-[auto_auto_1fr_auto]">
          <Field label="Where">
            <select className="select sm" value={c.field} onChange={(e) => onChange({ field: e.target.value as RuleCondition["field"] })}>
              <option value="summary">Title</option>
              <option value="location">Location</option>
              <option value="description">Description</option>
            </select>
          </Field>
          <Field label="Match">
            <select className="select sm" value={c.match} onChange={(e) => onChange({ match: e.target.value as RuleCondition["match"] })}>
              <option value="contains">contains any of</option>
              <option value="exact">is exactly one of</option>
              <option value="regex">matches regex</option>
            </select>
          </Field>
          <Field label={c.match === "regex" ? "Pattern" : "Words (comma separated; empty = any event)"}>
            <input type="text" className="input sm w-full" value={c.terms.join(", ")} onChange={(e) => onChange({ terms: c.match === "regex" ? [e.target.value] : e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder={c.match === "regex" ? "^arrow\\s+camp" : "camp, retreat"} />
          </Field>
          <Field label="Event type">
            <select className="select sm" value={c.all_day == null ? "" : c.all_day ? "all" : "timed"} onChange={(e) => onChange({ all_day: e.target.value === "" ? null : e.target.value === "all" })}>
              <option value="">Any</option>
              <option value="all">All-day</option>
              <option value="timed">Timed</option>
            </select>
          </Field>
          {calendars.length > 1 ? (
            <div className="inline-text md:col-span-4">
              <span>Calendars</span>
              <Chip active={c.calendars.length === 0} onClick={() => onChange({ calendars: [] })}>
                Any
              </Chip>
              {calendars.map((id) => (
                <Chip key={id} active={c.calendars.includes(id)} onClick={() => onChange({ calendars: c.calendars.includes(id) ? c.calendars.filter((x) => x !== id) : [...c.calendars, id] })}>
                  {id.replace(/^calendar\./, "")}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
      ) : c.kind === "weekday" ? (
        <div className="chips">
          {DAYS.map((d, i) => (
            <Chip key={d} active={c.weekdays.includes(i)} onClick={() => onChange({ weekdays: c.weekdays.includes(i) ? c.weekdays.filter((x) => x !== i) : [...c.weekdays, i] })}>
              {d}
            </Chip>
          ))}
        </div>
      ) : c.kind === "date_range" ? (
        <div className="fields">
          <Field label="From" help="YYYY-MM-DD, or MM-DD to repeat every year">
            <input type="text" className="input sm mono w-36" placeholder="2026-06-10" value={c.start ?? ""} onChange={(e) => onChange({ start: e.target.value || null })} />
          </Field>
          <Field label="To (inclusive)">
            <input type="text" className="input sm mono w-36" placeholder="2026-06-14" value={c.end ?? ""} onChange={(e) => onChange({ end: e.target.value || null })} />
          </Field>
        </div>
      ) : c.kind === "entity" ? (
        <div className="fields">
          <Field label="Sensor or group" className="min-w-64 flex-1">
            <SensorRef value={c.entity_id} onChange={(v) => onChange({ entity_id: v })} placeholder="input_boolean.propertyoccupied, group:…" />
          </Field>
          <Field label="Is">
            <select className="select sm" value={c.state} onChange={(e) => onChange({ state: e.target.value })}>
              <option value="on">on</option>
              <option value="off">off</option>
            </select>
          </Field>
        </div>
      ) : (
        <div className="fields">
          <Field label="Sensor" className="min-w-64 flex-1">
            <EntityPicker value={c.entity_id} onChange={(v) => onChange({ entity_id: v })} domain="sensor" placeholder="sensor.unifi_wlan_clients" />
          </Field>
          <Field label="Above">
            <NumberInput value={c.above} onChange={(v) => onChange({ above: v })} step={1} />
          </Field>
          <Field label="Below">
            <NumberInput value={c.below} onChange={(v) => onChange({ below: v })} step={1} />
          </Field>
        </div>
      )}
    </div>
  );
}
