import { useEffect, useState } from "react";
import { api } from "../api";
import type { SensorGroup, Settings } from "../types";
import { EntityPicker } from "./ui";

let cache: { at: number; groups: SensorGroup[] } | null = null;
const listeners = new Set<(g: SensorGroup[]) => void>();

export function invalidateSensorGroups(groups?: SensorGroup[]): void {
  cache = groups ? { at: Date.now(), groups } : null;
  if (groups) listeners.forEach((l) => l(groups));
}

/** Cadence sensor groups from Settings (cached for a minute; Settings saves refresh it). */
export function useSensorGroups(): SensorGroup[] {
  const [groups, setGroups] = useState<SensorGroup[]>(cache?.groups ?? []);
  useEffect(() => {
    listeners.add(setGroups);
    if (!cache || Date.now() - cache.at > 60_000) {
      api
        .get<Settings>("api/settings")
        .then((s) => invalidateSensorGroups(s.sensor_groups ?? []))
        .catch(() => undefined);
    }
    return () => {
      listeners.delete(setGroups);
    };
  }, []);
  return groups;
}

export function sensorLabel(ref: string | null | undefined, groups: SensorGroup[]): string {
  if (!ref) return "sensor";
  if (ref.startsWith("group:")) {
    const g = groups.find((x) => x.id === ref.slice(6));
    return g ? `${g.name} (group)` : ref;
  }
  return ref.replace(/^binary_sensor\./, "");
}

const isSensorish = (e: { entity_id: string }) => /^(binary_sensor|input_boolean|group|switch)\./.test(e.entity_id);

/** Pick a Cadence sensor group or a single Home Assistant entity. Value is an entity id or "group:<id>". */
export function SensorRef({ value, onChange, placeholder }: { value: string | null | undefined; onChange: (v: string | null) => void; placeholder?: string }) {
  const groups = useSensorGroups();
  const isGroup = !!value && value.startsWith("group:");
  const [mode, setMode] = useState<"group" | "entity">(isGroup || (!value && groups.length > 0) ? "group" : "entity");
  useEffect(() => {
    if (isGroup) setMode("group");
  }, [isGroup]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="select select-sm w-auto"
        value={mode === "group" ? (isGroup ? value : "") : "__entity"}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__entity") {
            setMode("entity");
            if (isGroup) onChange(null);
          } else {
            setMode("group");
            onChange(v || null);
          }
        }}
      >
        <option value="">{groups.length ? "Choose a sensor group…" : "No sensor groups yet"}</option>
        {groups.map((g) => (
          <option key={g.id} value={"group:" + g.id}>
            {g.name} ({g.mode} of {g.entities.length})
          </option>
        ))}
        <option value="__entity">Single Home Assistant entity…</option>
      </select>
      {mode === "entity" ? (
        <div className="min-w-64 flex-1">
          <EntityPicker value={isGroup ? null : value} onChange={onChange} filter={isSensorish} placeholder={placeholder ?? "binary_sensor, group, input_boolean…"} />
        </div>
      ) : null}
      {groups.length === 0 && mode === "group" ? <span className="text-xs opacity-60">Create groups under Settings → Sensor groups.</span> : null}
    </div>
  );
}
