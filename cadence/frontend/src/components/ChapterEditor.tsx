import { slug } from "../api";
import { StartEditor } from "./StartEditor";
import { ColorDots, EntityPicker, Field, NumberInput, Pill, Toggle } from "./ui";
import type { CadenceScene, Chapter, SkyState, Variant } from "../types";

export function ChapterEditor({ chapter: c, scenes, onChange }: { chapter: Chapter; scenes: CadenceScene[]; onChange: (p: Partial<Chapter>) => void }) {
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
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Name" className="min-w-48 flex-1">
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
      <Field label="Hold" help="While the sensor is in this state the chapter stays active and the following chapters wait. The hard end is a time of day; one earlier than the chapter's start means the next morning.">
        <div className="flex flex-col gap-2">
          <Toggle
            checked={!!c.hold}
            onChange={(v) => onChange({ hold: v ? { entity_id: "", while_state: "on", latest: "01:00" } : null })}
            label="Keep this chapter going while a sensor says so"
            color="toggle-accent"
          />
          {c.hold ? (
            <div className="flex flex-wrap items-center gap-2 text-xs opacity-80">
              <div className="min-w-64 flex-1">
                <EntityPicker value={c.hold.entity_id} allowClear={false} onChange={(v) => v && onChange({ hold: { ...c.hold!, entity_id: v } })} filter={(e) => /^(binary_sensor|input_boolean|group|switch)\./.test(e.entity_id)} placeholder="Occupancy group, input_boolean…" />
              </div>
              <span>is</span>
              <select className="select select-sm w-auto" value={c.hold.while_state} onChange={(e) => onChange({ hold: { ...c.hold!, while_state: e.target.value as "on" | "off" } })}>
                <option value="on">on</option>
                <option value="off">off</option>
              </select>
              <span>· hard end at</span>
              <input type="time" className="input input-sm w-[7.5rem]" value={c.hold.latest ?? ""} onChange={(e) => onChange({ hold: { ...c.hold!, latest: e.target.value || null } })} />
            </div>
          ) : null}
        </div>
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
