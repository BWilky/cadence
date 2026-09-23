import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { HAEntity } from "../types";

// ------------------------------------------------------------------ toast
let toastListener: ((t: { text: string; err?: boolean } | null) => void) | null = null;
export function toast(text: string, err = false): void {
  toastListener?.({ text, err });
}
export function Toaster() {
  const [t, setT] = useState<{ text: string; err?: boolean } | null>(null);
  useEffect(() => {
    toastListener = setT;
    return () => {
      toastListener = null;
    };
  }, []);
  useEffect(() => {
    if (!t) return;
    const id = window.setTimeout(() => setT(null), t.err ? 6000 : 2800);
    return () => window.clearTimeout(id);
  }, [t]);
  if (!t) return null;
  return (
    <div className="toast toast-center toast-bottom z-[100]">
      <div className={"alert alert-soft " + (t.err ? "alert-error" : "alert-success")}>
        <span>{t.text}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ entity cache + picker
const entityCache = new Map<string, Promise<HAEntity[]>>();
export function loadEntities(domain?: string): Promise<HAEntity[]> {
  const key = domain ?? "*";
  if (!entityCache.has(key)) {
    const p = api.get<HAEntity[]>("api/ha/entities" + (domain ? `?domain=${encodeURIComponent(domain)}` : "")).catch(() => [] as HAEntity[]);
    entityCache.set(key, p);
    window.setTimeout(() => entityCache.delete(key), 60_000);
  }
  return entityCache.get(key)!;
}

export function useEntities(domain?: string): HAEntity[] {
  const [list, setList] = useState<HAEntity[]>([]);
  useEffect(() => {
    let alive = true;
    loadEntities(domain).then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, [domain]);
  return list;
}

export function EntityPicker(props: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  domain?: string;
  placeholder?: string;
  filter?: (e: HAEntity) => boolean;
  allowClear?: boolean;
  size?: "sm" | "md";
}) {
  const all = useEntities(props.domain);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const current = all.find((e) => e.entity_id === props.value);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = props.filter ? all.filter(props.filter) : all;
    if (s) list = list.filter((e) => e.entity_id.toLowerCase().includes(s) || e.name.toLowerCase().includes(s) || (e.keypad ?? "").toLowerCase().includes(s));
    return list.slice(0, 60);
  }, [all, q, props.filter]);
  useEffect(() => {
    const on = (ev: MouseEvent) => {
      if (!ref.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, []);
  const pick = (e: HAEntity) => {
    props.onChange(e.entity_id);
    setQ("");
    setOpen(false);
  };
  const sz = props.size === "md" ? "" : " input-sm";
  return (
    <div className="relative w-full" ref={ref}>
      <label className={"input w-full" + sz}>
        <svg className="h-[1em] opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <g strokeLinejoin="round" strokeLinecap="round" strokeWidth="2.5" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.3-4.3"></path>
          </g>
        </svg>
        <input
          type="search"
          className="grow"
          placeholder={props.placeholder ?? (props.domain ? `Search ${props.domain}.* …` : "Search entities…")}
          value={open ? q : current ? `${current.name}` : props.value ?? ""}
          onFocus={() => {
            setOpen(true);
            setQ("");
          }}
          onChange={(e) => {
            setQ(e.target.value);
            setHl(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setHl((h) => Math.min(h + 1, results.length - 1));
            else if (e.key === "ArrowUp") setHl((h) => Math.max(h - 1, 0));
            else if (e.key === "Enter" && results[hl]) pick(results[hl]);
            else if (e.key === "Escape") setOpen(false);
          }}
        />
        {props.allowClear !== false && props.value ? (
          <button type="button" className="btn btn-ghost btn-xs btn-circle" title="Clear" onMouseDown={(e) => e.preventDefault()} onClick={() => props.onChange(null)}>
            ✕
          </button>
        ) : null}
      </label>
      {props.value && !open ? <div className="mt-0.5 font-mono text-[11px] opacity-60 truncate">{props.value}</div> : null}
      {open ? (
        <ul className="menu menu-sm absolute left-0 right-0 top-full z-50 mt-1 max-h-64 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 shadow-xl">
          {results.length === 0 ? <li className="menu-title">No matches{all.length === 0 ? " (is Home Assistant connected?)" : ""}</li> : null}
          {results.map((e, i) => (
            <li key={e.entity_id}>
              <button type="button" className={"flex flex-col items-start gap-0 " + (i === hl ? "menu-active" : "")} onMouseDown={() => pick(e)}>
                <span className="flex w-full items-center gap-2">
                  <span className="truncate">{e.name}</span>
                  <span className="ml-auto font-mono text-[11px] text-accent">{e.state}</span>
                </span>
                <span className="font-mono text-[11px] opacity-60">
                  {e.entity_id}
                  {e.keypad ? ` · ${e.keypad}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ small inputs
export function NumberInput(props: { value: number | null | undefined; onChange: (v: number | null) => void; step?: number; min?: number; max?: number; width?: number; placeholder?: string; className?: string }) {
  return (
    <input
      type="number"
      className={"input input-sm " + (props.className ?? "")}
      style={{ width: props.width ?? 90 }}
      step={props.step ?? 1}
      min={props.min}
      max={props.max}
      placeholder={props.placeholder}
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value === "" ? null : Number(e.target.value))}
    />
  );
}

export function Field(props: { label: string; help?: string; children: React.ReactNode; className?: string }) {
  return (
    <fieldset className={"fieldset min-w-0 p-0 " + (props.className ?? "")}>
      <legend className="fieldset-legend pb-1 pt-0 text-xs opacity-70">{props.label}</legend>
      {props.children}
      {props.help ? <p className="label text-xs whitespace-normal">{props.help}</p> : null}
    </fieldset>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string; color?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className={"toggle toggle-sm mt-0.5 " + (props.color ?? "toggle-primary")} checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>
        <div className="text-sm">{props.label}</div>
        {props.help ? <div className="text-xs opacity-60">{props.help}</div> : null}
      </span>
    </label>
  );
}

export function Confirm(props: { text: string; onYes: () => void; children: React.ReactNode; className?: string }) {
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const id = window.setTimeout(() => setArm(false), 3500);
    return () => window.clearTimeout(id);
  }, [arm]);
  return (
    <button
      type="button"
      className={(props.className ?? "btn btn-sm btn-outline btn-error") + (arm ? " btn-active" : "")}
      onClick={() => {
        if (arm) {
          setArm(false);
          props.onYes();
        } else setArm(true);
      }}
    >
      {arm ? props.text : props.children}
    </button>
  );
}

/** Pill-style toggle used for variants, conditions and scene membership. */
export function Pill(props: { active?: boolean; auto?: boolean; onClick?: () => void; children: React.ReactNode; title?: string; disabled?: boolean; color?: string }) {
  const tone = props.color ?? (props.auto ? "btn-accent" : "btn-primary");
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      className={"btn btn-xs rounded-full " + (props.active ? tone : "btn-outline border-base-300 text-base-content/70 hover:border-base-content/40") + (props.auto && !props.active ? " border-dashed" : "")}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export const SKY_LABEL: Record<string, string> = { sunny: "Sunny", cloudy: "Cloudy", dark: "Dark" };

export function chapterColor(c: string | null | undefined): { fill: string; line: string } {
  const hex = c && /^#[0-9a-f]{6}$/i.test(c) ? c : "#7fb1d6";
  const r = parseInt(hex.slice(1, 3), 16),
    g = parseInt(hex.slice(3, 5), 16),
    b = parseInt(hex.slice(5, 7), 16);
  return { fill: `rgba(${r},${g},${b},0.28)`, line: `rgba(${r},${g},${b},0.75)` };
}

export const COLORS = ["#3a4a7a", "#e8b45a", "#f0c86a", "#7fb1d6", "#9cc9a0", "#e89a5a", "#c4706e", "#9a6ab8", "#6ed3c6", "#8a9bb0", "#2a3350"];

export function ColorDots({ value, onChange }: { value: string | null | undefined; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {COLORS.map((col) => (
        <button
          key={col}
          type="button"
          className="h-5 w-5 rounded-full border border-white/20 transition-transform hover:scale-110"
          style={{ background: col, outline: value === col ? "2px solid var(--color-primary)" : undefined, outlineOffset: 1 }}
          onClick={() => onChange(col)}
          aria-label={col}
        />
      ))}
    </div>
  );
}
