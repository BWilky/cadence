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
  return <div className={"toast" + (t.err ? " err" : "")}>{t.text}</div>;
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
  return (
    <div className="picker" ref={ref}>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input
          type="search"
          style={{ flex: 1 }}
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
          <button className="btn sm ghost" title="Clear" onClick={() => props.onChange(null)}>
            ×
          </button>
        ) : null}
      </div>
      {props.value && !open ? <div className="help mono">{props.value}</div> : null}
      {open ? (
        <div className="results">
          {results.length === 0 ? <div className="help" style={{ padding: 8 }}>No matches{all.length === 0 ? " (is Home Assistant connected?)" : ""}</div> : null}
          {results.map((e, i) => (
            <button key={e.entity_id} className={i === hl ? "hl" : ""} onMouseDown={() => pick(e)}>
              <span className="row" style={{ width: "100%", flexWrap: "nowrap" }}>
                <span>{e.name}</span>
                <span className="st">{e.state}</span>
              </span>
              <span className="eid">
                {e.entity_id}
                {e.keypad ? ` · ${e.keypad}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ small inputs
export function NumberInput(props: { value: number | null | undefined; onChange: (v: number | null) => void; step?: number; min?: number; max?: number; width?: number; placeholder?: string }) {
  return (
    <input
      type="number"
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

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string }) {
  return (
    <label className="row" style={{ cursor: "pointer", alignItems: "flex-start" }}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} style={{ marginTop: 2 }} />
      <span>
        <div>{props.label}</div>
        {props.help ? <div className="help">{props.help}</div> : null}
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
      className={props.className ?? "btn sm danger"}
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

export const SKY_LABEL: Record<string, string> = { sunny: "Sunny", cloudy: "Cloudy", dark: "Dark" };

export function chapterColor(c: string | null | undefined): { fill: string; line: string } {
  const hex = c && /^#[0-9a-f]{6}$/i.test(c) ? c : "#7fb1d6";
  const r = parseInt(hex.slice(1, 3), 16),
    g = parseInt(hex.slice(3, 5), 16),
    b = parseInt(hex.slice(5, 7), 16);
  return { fill: `rgba(${r},${g},${b},0.28)`, line: `rgba(${r},${g},${b},0.75)` };
}
