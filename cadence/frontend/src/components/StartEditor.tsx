import type { ChapterStart, StartKind, TimeWindow } from "../types";
import { NumberInput } from "./ui";

export function defaultStart(kind: StartKind): ChapterStart {
  if (kind === "clock") return { kind, time: "08:00", direction: "setting", offset_minutes: 0 };
  if (kind === "sun") return { kind, sun_event: "sunset", elevation: -5, direction: "setting", offset_minutes: 0, latest: "21:30" };
  return { kind, direction: "setting", offset_minutes: 0, earliest: "21:00", latest: "01:00" };
}

export function StartEditor({ value, onChange }: { value: ChapterStart; onChange: (s: ChapterStart) => void }) {
  const set = (patch: Partial<ChapterStart>) => onChange({ ...value, ...patch });
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <select value={value.kind} onChange={(e) => onChange(defaultStart(e.target.value as StartKind))}>
          <option value="clock">At a clock time</option>
          <option value="sun">Relative to the sun</option>
          <option value="motion">When motion is seen</option>
          <option value="asleep">When the building falls asleep</option>
        </select>
        {value.kind === "clock" ? <input type="time" value={value.time ?? ""} onChange={(e) => set({ time: e.target.value })} /> : null}
      </div>
      {value.kind === "sun" ? (
        <div className="row">
          <select value={value.sun_event ?? "sunset"} onChange={(e) => set({ sun_event: e.target.value as ChapterStart["sun_event"] })}>
            <option value="sunrise">Sunrise</option>
            <option value="sunset">Sunset</option>
            <option value="dawn">Civil dawn</option>
            <option value="dusk">Civil dusk</option>
            <option value="elevation">Sun elevation…</option>
          </select>
          {value.sun_event === "elevation" ? (
            <>
              <NumberInput value={value.elevation} onChange={(v) => set({ elevation: v })} step={0.5} min={-90} max={90} width={70} />
              <span className="small text-2">°</span>
              <select value={value.direction} onChange={(e) => set({ direction: e.target.value as "rising" | "setting" })}>
                <option value="setting">while setting</option>
                <option value="rising">while rising</option>
              </select>
            </>
          ) : null}
          <span className="small text-2">offset</span>
          <NumberInput value={value.offset_minutes} onChange={(v) => set({ offset_minutes: v ?? 0 })} step={5} width={70} />
          <span className="small text-2">min · fallback</span>
          <input type="time" value={value.latest ?? ""} onChange={(e) => set({ latest: e.target.value || null })} title="If the sun never reaches that point today, start at this time" />
        </div>
      ) : null}
      {value.kind === "motion" || value.kind === "asleep" ? (
        <div className="row">
          <span className="small text-2">no earlier than</span>
          <input type="time" value={value.earliest ?? ""} onChange={(e) => set({ earliest: e.target.value || null })} />
          <span className="small text-2">no later than</span>
          <input type="time" value={value.latest ?? ""} onChange={(e) => set({ latest: e.target.value || null })} />
        </div>
      ) : null}
    </div>
  );
}

export function WindowsEditor({ value, onChange }: { value: TimeWindow[]; onChange: (w: TimeWindow[]) => void }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {value.map((w, i) => (
        <div className="row" key={i}>
          <input type="time" value={w.start} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
          <span className="small text-2">to</span>
          <input type="time" value={w.end} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
          <button className="btn sm ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <div>
        <button className="btn sm" onClick={() => onChange([...value, { start: "06:30", end: "23:30" }])}>
          + window
        </button>
        <span className="help" style={{ marginLeft: 8 }}>
          An end before the start wraps past midnight.
        </span>
      </div>
    </div>
  );
}
