import { mdiArrowDown, mdiArrowUp, mdiClose, mdiFormatListNumbered, mdiMotionSensor, mdiMusicNote, mdiPlus, mdiPower, mdiSwapHorizontal } from "@mdi/js";
import { useState } from "react";
import { slug } from "../api";
import type { CadenceScene, Chapter, SkyState, Variant } from "../types";
import { SensorRef } from "./SensorRef";
import { StartEditor } from "./StartEditor";
import { Chip, ColorDots, Confirm, EntityPicker, Field, Fold, Icon, IconBtn, NumberInput, Toggle } from "./ui";

export function ChapterEditor({ chapter: c, scenes, onChange }: { chapter: Chapter; scenes: CadenceScene[]; onChange: (p: Partial<Chapter>) => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
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
    <div className="flex flex-col gap-4 pt-1">
      <div className="fields">
        <Field label="Name" className="min-w-48 flex-1">
          <input type="text" className="input sm w-full" value={c.name} onChange={(e) => onChange({ name: e.target.value })} />
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
      <Field label="Hold" help="While the sensor is in this state the chapter stays active and the following chapters wait. The hard end is a time of day; one earlier than the chapter's start means the next morning.">
        <div className="flex flex-col gap-2">
          <Toggle checked={!!c.hold} onChange={(v) => onChange({ hold: v ? { entity_id: "", while_state: "on", latest: "01:00" } : null })} label="Keep this chapter going while a sensor says so" />
          {c.hold ? (
            <div className="inline-text">
              <SensorRef value={c.hold.entity_id} onChange={(v) => onChange({ hold: { ...c.hold!, entity_id: v ?? "" } })} />
              <span>is</span>
              <select className="select sm" value={c.hold.while_state} onChange={(e) => onChange({ hold: { ...c.hold!, while_state: e.target.value as "on" | "off" } })}>
                <option value="on">on</option>
                <option value="off">off</option>
              </select>
              <span>· hard end at</span>
              <input type="time" className="input sm w-[7.5rem]" value={c.hold.latest ?? ""} onChange={(e) => onChange({ hold: { ...c.hold!, latest: e.target.value || null } })} />
            </div>
          ) : null}
        </div>
      </Field>
      <Field label="Note (shown on the tablet)">
        <textarea className="textarea w-full" value={c.note} onChange={(e) => onChange({ note: e.target.value })} />
      </Field>

      <Fold
        open={moreOpen}
        onToggle={() => setMoreOpen(!moreOpen)}
        head={
          <>
            <Icon path={mdiMotionSensor} size="sm" className="muted" />
            <span className="ft">Motion &amp; behaviour</span>
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Field label="Motion sensor for this chapter (blank = global)">
            <EntityPicker value={c.motion_entity} onChange={(v) => onChange({ motion_entity: v })} domain="binary_sensor" />
          </Field>
          <Field label="Motion hold (min)">
            <NumberInput value={c.motion_hold_minutes} onChange={(v) => onChange({ motion_hold_minutes: v ?? 5 })} step={1} min={0} width={80} />
          </Field>
        </div>
        <Toggle icon={mdiSwapHorizontal} checked={c.reevaluate} onChange={(v) => onChange({ reevaluate: v })} label="Switch variant mid-chapter" help="When the sky or motion changes during this chapter, move to the matching variant. Off = only evaluate on entry." />
        <Toggle icon={mdiMusicNote} checked={c.music_only_on_entry} onChange={(v) => onChange({ music_only_on_entry: v })} label="Start/stop music only when entering the chapter" help="Variant swaps still run volume, mute and source changes, but won't restart a playlist." />
        <Toggle icon={mdiPower} tone={c.enabled ? "ok" : undefined} color="ok" checked={c.enabled} onChange={(v) => onChange({ enabled: v })} label="Chapter enabled" />
      </Fold>

      <div className="sec-head">
        <Icon path={mdiFormatListNumbered} />
        <span className="t">Variants — first match wins, top to bottom</span>
      </div>
      {c.variants.map((v, i) => (
        <div key={i} className="sub">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <input type="text" className="input sm w-44" value={v.label} onChange={(e) => setVariant(i, { label: e.target.value, key: v.key || slug(e.target.value) })} />
              <Chip sm className="mono">
                {v.key}
              </Chip>
            </div>
            <div className="flex items-center gap-1">
              <IconBtn icon={mdiArrowUp} size="xs" label="Move up" onClick={() => moveV(i, -1)} disabled={i === 0} />
              <IconBtn icon={mdiArrowDown} size="xs" label="Move down" onClick={() => moveV(i, 1)} disabled={i >= c.variants.length - 1} />
              <Confirm text="Remove?" icon={mdiClose} iconOnly sm onYes={() => onChange({ variants: c.variants.filter((_, j) => j !== i) })}>
                Remove variant
              </Confirm>
            </div>
          </div>
          <div className="inline-text">
            <span>When sky is</span>
            {(["sunny", "cloudy", "dark"] as SkyState[]).map((s) => {
              const on = v.when.sky?.includes(s) ?? false;
              return (
                <Chip
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
                </Chip>
              );
            })}
            <select className="select sm" value={sel(v.when.light)} onChange={(e) => setVariant(i, { when: { ...v.when, light: (e.target.value || null) as "light" | "dark" | null } })}>
              <option value="">any light</option>
              <option value="light">light outside</option>
              <option value="dark">dark outside</option>
            </select>
            <select className="select sm" value={sel(v.when.motion)} onChange={(e) => setVariant(i, { when: { ...v.when, motion: e.target.value === "" ? null : e.target.value === "true" } })}>
              <option value="">any motion</option>
              <option value="true">motion</option>
              <option value="false">quiet</option>
            </select>
            <select className="select sm" value={sel(v.when.occupied)} onChange={(e) => setVariant(i, { when: { ...v.when, occupied: e.target.value === "" ? null : e.target.value === "true" } })}>
              <option value="">any occupancy</option>
              <option value="true">occupied</option>
              <option value="false">vacant</option>
            </select>
            <select className="select sm" value={sel(v.when.asleep)} onChange={(e) => setVariant(i, { when: { ...v.when, asleep: e.target.value === "" ? null : e.target.value === "true" } })}>
              <option value="">asleep or not</option>
              <option value="true">asleep</option>
              <option value="false">awake</option>
            </select>
          </div>
          {Object.values(v.when).every((x) => x == null) ? <p className="help">No conditions — this variant is the fallback.</p> : null}
          <div className="inline-text">
            <span>Activate</span>
            {scenes.map((s) => {
              const on = v.scene_ids.includes(s.id);
              return (
                <Chip key={s.id} active={on} onClick={() => setVariant(i, { scene_ids: on ? v.scene_ids.filter((x) => x !== s.id) : [...v.scene_ids, s.id] })}>
                  <span className="swatch" style={{ background: s.color ?? "#556" }} />
                  {s.name}
                </Chip>
              );
            })}
            {scenes.length === 0 ? <span className="help">No Cadence scenes yet — create some under Scenes.</span> : null}
          </div>
        </div>
      ))}
      <button type="button" className="add-tile" onClick={addVariant}>
        <Icon path={mdiPlus} />
        Add variant
      </button>
    </div>
  );
}
