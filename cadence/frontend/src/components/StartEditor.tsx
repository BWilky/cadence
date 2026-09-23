import type { ChapterStart, StartKind, TimeWindow } from "../types";
import { SensorRef } from "./SensorRef";
import { NumberInput } from "./ui";

export function defaultStart(kind: StartKind): ChapterStart {
  if (kind === "clock") return { kind, time: "08:00", direction: "setting", offset_minutes: 0 };
  if (kind === "sun") return { kind, sun_event: "sunset", elevation: -5, direction: "setting", offset_minutes: 0, latest: "21:30" };
  if (kind === "sensor") return { kind, entity_id: null, to_state: "on", direction: "setting", offset_minutes: 0, earliest: "06:00", latest: "06:45" };
  return { kind, direction: "setting", offset_minutes: 0, earliest: "21:00", latest: "01:00" };
}

const TIME = "input input-sm w-[7.5rem]";

export function StartEditor({ value, onChange }: { value: ChapterStart; onChange: (s: ChapterStart) => void }) {
  const set = (patch: Partial<ChapterStart>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select className="select select-sm w-auto" value={value.kind} onChange={(e) => onChange(defaultStart(e.target.value as StartKind))}>
          <option value="clock">At a clock time</option>
          <option value="sun">Relative to the sun</option>
          <option value="motion">When motion is seen</option>
          <option value="asleep">When the building falls asleep</option>
          <option value="sensor">When a sensor changes</option>
        </select>
        {value.kind === "clock" ? <input type="time" className={TIME} value={value.time ?? ""} onChange={(e) => set({ time: e.target.value })} /> : null}
      </div>
      {value.kind === "sun" ? (
        <div className="flex flex-wrap items-center gap-2 text-xs opacity-80">
          <select className="select select-sm w-auto" value={value.sun_event ?? "sunset"} onChange={(e) => set({ sun_event: e.target.value as ChapterStart["sun_event"] })}>
            <option value="sunrise">Sunrise</option>
            <option value="sunset">Sunset</option>
            <option value="dawn">Civil dawn</option>
            <option value="dusk">Civil dusk</option>
            <option value="elevation">Sun elevation…</option>
          </select>
          {value.sun_event === "elevation" ? (
            <>
              <NumberInput value={value.elevation} onChange={(v) => set({ elevation: v })} step={0.5} min={-90} max={90} width={72} />
              <span>°</span>
              <select className="select select-sm w-auto" value={value.direction} onChange={(e) => set({ direction: e.target.value as "rising" | "setting" })}>
                <option value="setting">while setting</option>
                <option value="rising">while rising</option>
              </select>
            </>
          ) : null}
          <span>offset</span>
          <NumberInput value={value.offset_minutes} onChange={(v) => set({ offset_minutes: v ?? 0 })} step={5} width={72} />
          <span>min · fallback</span>
          <input type="time" className={TIME} value={value.latest ?? ""} onChange={(e) => set({ latest: e.target.value || null })} title="If the sun never reaches that point today, start at this time" />
        </div>
      ) : null}
      {value.kind === "sensor" ? (
        <div className="flex flex-wrap items-center gap-2 text-xs opacity-80">
          <SensorRef value={value.entity_id} onChange={(v) => set({ entity_id: v })} />
          <span>turns</span>
          <select className="select select-sm w-auto" value={value.to_state ?? "on"} onChange={(e) => set({ to_state: e.target.value as "on" | "off" })}>
            <option value="on">on</option>
            <option value="off">off</option>
          </select>
        </div>
      ) : null}
      {value.kind === "motion" || value.kind === "asleep" || value.kind === "sensor" ? (
        <div className="flex flex-wrap items-center gap-2 text-xs opacity-80">
          <span>Hard start at</span>
          <input type="time" className={TIME} value={value.latest ?? ""} onChange={(e) => set({ latest: e.target.value || null })} title="Starts at this time regardless" />
          <span>— or earlier, from</span>
          <input type="time" className={TIME} value={value.earliest ?? ""} onChange={(e) => set({ earliest: e.target.value || null })} title="The sensor can only start it after this time" />
          <span>if the {value.kind === "sensor" ? "sensor" : value.kind === "motion" ? "motion" : "asleep sensor"} triggers.</span>
        </div>
      ) : null}
    </div>
  );
}

export function WindowsEditor({ value, onChange }: { value: TimeWindow[]; onChange: (w: TimeWindow[]) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {value.map((w, i) => (
        <div className="join" key={i}>
          <input type="time" className="input input-sm join-item w-[7.5rem]" value={w.start} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
          <span className="join-item flex items-center border border-base-300 bg-base-200 px-2 text-xs opacity-70">to</span>
          <input type="time" className="input input-sm join-item w-[7.5rem]" value={w.end} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
          <button type="button" className="btn btn-sm btn-ghost join-item" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-xs btn-outline" onClick={() => onChange([...value, { start: "06:30", end: "23:30" }])}>
          + window
        </button>
        <span className="text-xs opacity-60">An end before the start wraps past midnight.</span>
      </div>
    </div>
  );
}
