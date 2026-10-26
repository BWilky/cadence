import { mdiCheck, mdiChevronDown, mdiClose, mdiLoading, mdiMagnify } from "@mdi/js";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { HAEntity } from "../types";

/* ----------------------------------------------------------------------------
   Sheet-style primitives. Class names mirror the Lamplighter sheets on the
   Home Assistant dashboards (section, act, row, chip, pill-btn, toggle, slider…)
   so the planner reads as the same family. Styles live in styles.css.
   -------------------------------------------------------------------------- */

// ------------------------------------------------------------------ icons
/** A Material Design Icon from @mdi/js, rendered like ha-icon. */
export function Icon({ path, size, className, title }: { path: string; size?: "xs" | "sm" | "md" | "lg"; className?: string; title?: string }) {
  return (
    <svg className={"icon " + (size && size !== "md" ? size + " " : "") + (className ?? "")} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title ? <title>{title}</title> : null}
      <path d={path} />
    </svg>
  );
}

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
    <div className={"toast" + (t.err ? " err" : "")} role="status">
      {t.text}
    </div>
  );
}

// ------------------------------------------------------------------ layout
/** Page frame inside the app shell: title row + scrolling body. */
export function Page(props: { title: React.ReactNode; icon?: string; actions?: React.ReactNode; children: React.ReactNode; flush?: boolean; narrow?: boolean; className?: string }) {
  return (
    <>
      <header className="content-head">
        {props.icon ? <Icon path={props.icon} className="muted" /> : null}
        <h2>{props.title}</h2>
        {props.actions}
      </header>
      <div className={"body" + (props.flush ? " flush" : "") + (props.className ? " " + props.className : "")}>{props.narrow ? <div className="narrow">{props.children}</div> : props.children}</div>
    </>
  );
}

/** Tinted block with an optional icon + title head line, like the sheets' sections. */
export function Section(props: { icon?: string; title?: React.ReactNode; count?: React.ReactNode; intro?: React.ReactNode; actions?: React.ReactNode; tint?: "danger" | "accent" | "warn" | "ok"; className?: string; children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className={"section" + (props.tint ? ` ${props.tint}-tint` : "") + (props.className ? " " + props.className : "")} style={props.style}>
      {props.title || props.icon || props.actions ? (
        <div className="sec-head">
          {props.icon ? <Icon path={props.icon} /> : null}
          <span className="t">{props.title}</span>
          {props.count != null ? <span className="count">{props.count}</span> : null}
          {props.actions}
        </div>
      ) : null}
      {props.intro ? <p className="help">{props.intro}</p> : null}
      {props.children}
    </div>
  );
}

/** Icon + title + subtitle action tile. */
export function Act(props: { icon: string; title: React.ReactNode; sub?: React.ReactNode; onClick?: () => void; disabled?: boolean; on?: boolean; danger?: boolean; busy?: boolean; inline?: boolean; className?: string; title_attr?: string }) {
  return (
    <button
      type="button"
      className={"act" + (props.on ? " on" : "") + (props.danger ? " danger" : "") + (props.busy ? " busy" : "") + (props.inline ? " inline" : "") + (props.className ? " " + props.className : "")}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title_attr}
    >
      <Icon path={props.busy ? mdiLoading : props.icon} />
      {props.danger ? (
        <span>{props.title}</span>
      ) : props.inline ? (
        <span className="act-text">
          <span className="act-title">{props.title}</span>
          {props.sub ? <span className="act-sub">{props.sub}</span> : null}
        </span>
      ) : (
        <>
          <span className="act-title">{props.title}</span>
          {props.sub ? <span className="act-sub">{props.sub}</span> : null}
        </>
      )}
    </button>
  );
}

/** Icon tile + title/sub + optional right-hand content. */
export function Row(props: { icon?: string; tone?: "on" | "ok" | "warn" | "bad"; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; onClick?: () => void; compact?: boolean; className?: string; title_attr?: string }) {
  const inner = (
    <>
      {props.icon ? (
        <span className={"row-icon" + (props.tone ? " " + props.tone : "") + (props.compact ? " sm" : "")}>
          <Icon path={props.icon} />
        </span>
      ) : null}
      <span className="row-text">
        <span className="row-title">{props.title}</span>
        {props.sub ? <span className="row-sub">{props.sub}</span> : null}
      </span>
      {props.right}
    </>
  );
  const cls = "row" + (props.compact ? " compact" : "") + (props.className ? " " + props.className : "");
  if (props.onClick)
    return (
      <button type="button" className={cls + " clickable"} onClick={props.onClick} title={props.title_attr}>
        {inner}
      </button>
    );
  return (
    <div className={cls} title={props.title_attr}>
      {inner}
    </div>
  );
}

// ------------------------------------------------------------------ buttons
export function Btn(props: { children: React.ReactNode; onClick?: () => void; variant?: "default" | "primary" | "danger" | "ghost" | "on"; sm?: boolean; icon?: string; disabled?: boolean; title?: string; className?: string; type?: "button" | "submit" }) {
  return (
    <button type={props.type ?? "button"} className={"pill-btn" + (props.variant && props.variant !== "default" ? " " + props.variant : "") + (props.sm ? " sm" : "") + (props.className ? " " + props.className : "")} onClick={props.onClick} disabled={props.disabled} title={props.title}>
      {props.icon ? <Icon path={props.icon} /> : null}
      {props.children}
    </button>
  );
}

export function IconBtn(props: { icon: string; label: string; onClick?: () => void; size?: "sm" | "xs"; soft?: boolean; danger?: boolean; disabled?: boolean; spin?: boolean; className?: string }) {
  return (
    <button type="button" className={"icon-btn" + (props.size ? " " + props.size : "") + (props.soft ? " soft" : "") + (props.danger ? " danger" : "") + (props.className ? " " + props.className : "")} onClick={props.onClick} disabled={props.disabled} aria-label={props.label} title={props.label}>
      <Icon path={props.icon} className={props.spin ? "spin" : undefined} />
    </button>
  );
}

/** Press once to arm, again (within 3.5 s) to run. */
export function Confirm(props: { text: string; onYes: () => void; children: React.ReactNode; className?: string; icon?: string; iconOnly?: boolean; sm?: boolean; disabled?: boolean }) {
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const id = window.setTimeout(() => setArm(false), 3500);
    return () => window.clearTimeout(id);
  }, [arm]);
  const go = () => {
    if (arm) {
      setArm(false);
      props.onYes();
    } else setArm(true);
  };
  if (props.iconOnly && props.icon)
    return (
      <button type="button" className={"icon-btn danger " + (props.sm ? "sm " : "") + (arm ? "armed " : "") + (props.className ?? "")} onClick={go} disabled={props.disabled} aria-label={arm ? props.text : String(props.children)} title={arm ? props.text : undefined}>
        <Icon path={arm ? mdiCheck : props.icon} />
      </button>
    );
  return (
    <button type="button" className={(props.className ?? "pill-btn danger") + (props.sm ? " sm" : "") + (arm ? " armed" : "")} onClick={go} disabled={props.disabled}>
      {props.icon && !arm ? <Icon path={props.icon} /> : null}
      {arm ? props.text : props.children}
    </button>
  );
}

/** Pill-style toggle used for variants, conditions and scene membership. */
export function Chip(props: { active?: boolean; auto?: boolean; onClick?: () => void; children: React.ReactNode; title?: string; disabled?: boolean; icon?: string; tone?: "on" | "ok" | "warn" | "attn"; sm?: boolean; className?: string }) {
  const cls = "chip" + (props.active ? " " + (props.tone ?? "on") : props.tone && !props.onClick ? " " + props.tone : "") + (props.auto ? " dashed" : "") + (props.sm ? " sm" : "") + (props.className ? " " + props.className : "");
  if (!props.onClick)
    return (
      <span className={cls} title={props.title}>
        {props.icon ? <Icon path={props.icon} /> : null}
        {props.children}
      </span>
    );
  return (
    <button type="button" className={cls} title={props.title} disabled={props.disabled} onClick={props.onClick} aria-pressed={props.active}>
      {props.icon ? <Icon path={props.icon} /> : null}
      {props.children}
    </button>
  );
}
export const Pill = Chip;

/** Segmented control. */
export function Segmented<T extends string>(props: { value: T; options: { value: T; label: React.ReactNode; icon?: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; sm?: boolean; fit?: boolean; disabled?: boolean; className?: string }) {
  return (
    <div className={"tabs" + (props.sm ? " sm" : "") + (props.fit ? " fit" : "") + (props.className ? " " + props.className : "")} role="tablist">
      {props.options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === props.value} className={"tab" + (o.value === props.value ? " on" : "")} disabled={props.disabled || o.disabled} title={o.title} onClick={() => props.onChange(o.value)}>
          {o.icon ? <Icon path={o.icon} size="sm" /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ toggle + slider
export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; color?: "warn" | "ok"; sm?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={props.checked} aria-label={props.label} className={"toggle" + (props.checked ? " on" : "") + (props.color ? " " + props.color : "") + (props.sm ? " sm" : "")} disabled={props.disabled} onClick={() => props.onChange(!props.checked)}>
      <span className="knob" />
    </button>
  );
}

/** Labelled switch row: title + help on the left, switch on the right. */
export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; help?: React.ReactNode; color?: "warn" | "ok"; disabled?: boolean; icon?: string; tone?: "on" | "ok" | "warn" | "bad" }) {
  return (
    <div className="row toggle-row">
      {props.icon ? (
        <span className={"row-icon sm" + (props.tone ? " " + props.tone : props.checked ? " on" : "")}>
          <Icon path={props.icon} />
        </span>
      ) : null}
      <span className="row-text">
        <span className="row-title">{props.label}</span>
        {props.help ? <span className="row-sub">{props.help}</span> : null}
      </span>
      <Switch checked={props.checked} onChange={props.onChange} disabled={props.disabled} color={props.color} label={typeof props.label === "string" ? props.label : undefined} />
    </div>
  );
}

/** Tile-card style slider (drag anywhere; commits on release). */
export function Slider(props: { value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; onInput?: (v: number) => void; disabled?: boolean; label: string; sm?: boolean; color?: string; className?: string }) {
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const step = props.step ?? 1;
  const [drag, setDrag] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const shown = drag ?? props.value;
  const pct = max > min ? Math.max(0, Math.min(1, (shown - min) / (max - min))) : 0;
  const valAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const v = Math.round((min + f * (max - min)) / step) * step;
    return Math.min(max, Math.max(min, Number(v.toFixed(6))));
  };
  return (
    <div
      ref={ref}
      className={"slider" + (props.sm ? " sm" : "") + (props.disabled ? " disabled" : "") + (drag != null ? " dragging" : "") + (props.className ? " " + props.className : "")}
      style={props.color ? ({ "--c": props.color } as React.CSSProperties) : undefined}
      role="slider"
      aria-label={props.label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={shown}
      tabIndex={props.disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (props.disabled) return;
        const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : 0;
        if (d) {
          e.preventDefault();
          props.onChange(Math.min(max, Math.max(min, Number((props.value + d).toFixed(6)))));
        }
      }}
      onPointerDown={(e) => {
        if (props.disabled) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const v = valAt(e.clientX);
        setDrag(v);
        props.onInput?.(v);
      }}
      onPointerMove={(e) => {
        if (drag == null) return;
        const v = valAt(e.clientX);
        if (v !== drag) {
          setDrag(v);
          props.onInput?.(v);
        }
      }}
      onPointerUp={(e) => {
        if (drag == null) return;
        const v = valAt(e.clientX);
        setDrag(null);
        props.onChange(v);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      <div className={"fill" + (pct <= 0 ? " empty" : "")} style={{ "--v": pct } as React.CSSProperties} />
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
  return (
    <div className="relative w-full" ref={ref}>
      <div className="search">
        <Icon path={mdiMagnify} />
        <input
          type="search"
          className={"input" + (props.size === "md" ? "" : " sm")}
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
          <button type="button" className="icon-btn xs clear" title="Clear" aria-label="Clear" onMouseDown={(e) => e.preventDefault()} onClick={() => props.onChange(null)}>
            <Icon path={mdiClose} />
          </button>
        ) : null}
      </div>
      {props.value && !open ? <div className="mono mt-1 truncate text-[11px] muted">{props.value}</div> : null}
      {open ? (
        <div className="menu absolute left-0 right-0 top-full z-50 mt-1" style={{ maxHeight: 280 }}>
          {results.length === 0 ? <div className="menu-title">No matches{all.length === 0 ? " (is Home Assistant connected?)" : ""}</div> : null}
          {results.map((e, i) => (
            <button type="button" key={e.entity_id} className={"menu-item" + (i === hl ? " hl" : "")} onMouseDown={() => pick(e)}>
              <span className="mt">
                <span>{e.name}</span>
                <small className="mono">
                  {e.entity_id}
                  {e.keypad ? ` · ${e.keypad}` : ""}
                </small>
              </span>
              <span className="hint" style={{ color: "var(--accent)" }}>
                {e.state}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ small inputs
export function NumberInput(props: { value: number | null | undefined; onChange: (v: number | null) => void; step?: number; min?: number; max?: number; width?: number; placeholder?: string; className?: string; size?: "sm" | "md" }) {
  return (
    <input
      type="number"
      className={"input " + (props.size === "md" ? "" : "sm ") + (props.className ?? "")}
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

export function Field(props: { label: React.ReactNode; help?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={"field " + (props.className ?? "")}>
      <label>{props.label}</label>
      {props.children}
      {props.help ? <p className="help">{props.help}</p> : null}
    </div>
  );
}

export function Loading({ text }: { text?: string }) {
  return (
    <div className="loading">
      <Icon path={mdiLoading} className="spin" /> {text ?? "Loading…"}
    </div>
  );
}

/** Collapsible card with a header line (chapters, variants…). */
export function Fold(props: { open: boolean; onToggle: () => void; head: React.ReactNode; right?: React.ReactNode; children?: React.ReactNode; dim?: boolean; className?: string; innerRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={props.innerRef} className={"fold" + (props.open ? " open" : "") + (props.dim ? " dim" : "") + (props.className ? " " + props.className : "")}>
      <div className="fold-head" onClick={props.onToggle} role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), props.onToggle())}>
        {props.head}
        <span className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {props.right}
        </span>
        <Icon path={mdiChevronDown} className="chev" size="sm" />
      </div>
      {props.open ? <div className="fold-body">{props.children}</div> : null}
    </div>
  );
}

/** Centred dialog with a backdrop. */
export function Dialog(props: { open: boolean; onClose: () => void; title: React.ReactNode; icon?: string; children: React.ReactNode; sm?: boolean; head?: React.ReactNode; foot?: React.ReactNode }) {
  useEffect(() => {
    if (!props.open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [props.open, props.onClose]);
  if (!props.open) return null;
  return (
    <>
      <div className="backdrop" onMouseDown={props.onClose} />
      <div className={"dialog" + (props.sm ? " sm" : "")} role="dialog" aria-label={typeof props.title === "string" ? props.title : undefined}>
        <header className="content-head">
          {props.icon ? <Icon path={props.icon} className="muted" /> : null}
          <h2>{props.title}</h2>
          {props.head}
          <button type="button" className="close" onClick={props.onClose} aria-label="Close">
            <Icon path={mdiClose} />
          </button>
        </header>
        <div className="body">{props.children}</div>
        {props.foot ? <div className="pane-foot">{props.foot}</div> : null}
      </div>
    </>
  );
}

export const SKY_LABEL: Record<string, string> = { sunny: "Sunny", cloudy: "Cloudy", dark: "Dark" };

export function chapterColor(c: string | null | undefined): { base: string; fill: string; line: string } {
  const hex = c && /^#[0-9a-f]{6}$/i.test(c) ? c : "#7fb1d6";
  const r = parseInt(hex.slice(1, 3), 16),
    g = parseInt(hex.slice(3, 5), 16),
    b = parseInt(hex.slice(5, 7), 16);
  return { base: hex, fill: `rgba(${r},${g},${b},0.28)`, line: `rgba(${r},${g},${b},0.75)` };
}

/** CSS custom properties a chapter block needs: the raw colour plus the tablet's fill/line pair. */
export function chapterVars(c: string | null | undefined): React.CSSProperties {
  const col = chapterColor(c);
  return { "--c": col.base, "--c-fill": col.fill, "--c-line": col.line } as React.CSSProperties;
}

export const COLORS = ["#3a4a7a", "#e8b45a", "#f0c86a", "#7fb1d6", "#9cc9a0", "#e89a5a", "#c4706e", "#9a6ab8", "#6ed3c6", "#8a9bb0", "#2a3350"];

export function ColorDots({ value, onChange }: { value: string | null | undefined; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {COLORS.map((col) => (
        <button key={col} type="button" className={"color-dot" + (value === col ? " on" : "")} style={{ background: col }} onClick={() => onChange(col)} aria-label={col} aria-pressed={value === col} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------- double tap
//
// Double-click on a mouse, or two quick taps on touch (iOS Safari fires no dblclick for taps).
// Keyed so the same helper serves many elements in a render loop without hook rules.
const taps = new Map<string, { t: number; x: number; y: number; touch: number }>();
export function doubleTapHandlers(key: string, cb: () => void) {
  const get = () => {
    let l = taps.get(key);
    if (!l) taps.set(key, (l = { t: 0, x: 0, y: 0, touch: 0 }));
    return l;
  };
  return {
    onPointerUp: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const l = get();
      const now = performance.now();
      if (now - l.t < 350 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 24) {
        l.t = 0;
        l.touch = now;
        cb();
      } else {
        l.t = now;
        l.x = e.clientX;
        l.y = e.clientY;
      }
    },
    onDoubleClick: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (performance.now() - get().touch < 600) return; // already handled as a double tap
      cb();
    },
  };
}
