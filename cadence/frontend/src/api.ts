import { useEffect, useRef, useState } from "react";
import type { Boot, EngineStatus, LogEntry } from "./types";

declare global {
  interface Window {
    __CADENCE__?: Boot;
  }
}

export const boot: Boot = window.__CADENCE__ ?? { basePath: "/", version: "dev", user: { name: "Developer", via: "dev" }, googleLogin: false };

function url(path: string): string {
  const base = boot.basePath.endsWith("/") ? boot.basePath : boot.basePath + "/";
  return base + path.replace(/^\//, "");
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(url(path), {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  del: <T>(path: string) => request<T>("DELETE", path),
};

type WsMessage =
  | { type: "status"; status: EngineStatus }
  | { type: "log"; entry: LogEntry }
  | { type: "zones"; zones: Record<string, number> }
  | { type: "pong" };

/** Live engine status over the WebSocket, with REST fallback and auto-reconnect. */
export function useLive(): { status: EngineStatus | null; connected: boolean; logs: LogEntry[]; zones: Record<string, number> } {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [zones, setZones] = useState<Record<string, number>>({});
  const retry = useRef(1000);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let timer: number | undefined;

    api.get<EngineStatus>("api/status").then((s) => setStatus((cur) => cur ?? s)).catch(() => undefined);

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const target = proto + "//" + location.host + url("api/ws");
      ws = new WebSocket(target);
      ws.onopen = () => {
        setConnected(true);
        retry.current = 1000;
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as WsMessage;
        if (msg.type === "status") {
          setSiteTimezone(msg.status.timezone);
          setStatus(msg.status);
          setZones(msg.status.zones);
        } else if (msg.type === "log") {
          setLogs((l) => [msg.entry, ...l].slice(0, 300));
        } else if (msg.type === "zones") {
          setZones(msg.zones);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        timer = window.setTimeout(connect, retry.current);
        retry.current = Math.min(retry.current * 2, 15000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    const ping = window.setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, 25000);
    return () => {
      closed = true;
      window.clearInterval(ping);
      if (timer) window.clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { status, connected, logs, zones };
}

/** Simple hash router: "#/planner", "#/tablet?view=6". */
export function useHashRoute(): { route: string; query: URLSearchParams; navigate: (to: string) => void } {
  const parse = () => {
    const h = location.hash.replace(/^#\/?/, "");
    const [path, q] = h.split("?");
    return { route: path || "now", query: new URLSearchParams(q || "") };
  };
  const [state, setState] = useState(parse);
  useEffect(() => {
    const on = () => setState(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return { ...state, navigate: (to: string) => (location.hash = "#/" + to.replace(/^\//, "")) };
}

// ------------------------------------------------------------------------- site time
//
// Every clock the planner shows is the building's, not the browser's: a chapter at 07:30 is 07:30
// in the engine's timezone whoever is looking. The timezone arrives with the engine status and is
// remembered so the first paint is right too; until it is known, the wall clock written in the
// backend's ISO strings (which carry the site offset) is used as is.

const TZ_KEY = "cadence.site_tz";
let siteTZ: string | null = (() => {
  try {
    return localStorage.getItem(TZ_KEY);
  } catch {
    return null;
  }
})();
const partsFmt = new Map<string, Intl.DateTimeFormat>();

export function setSiteTimezone(tz: string | null | undefined): void {
  if (!tz || tz === siteTZ) return;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz }); // throws on an unknown zone
  } catch {
    return;
  }
  siteTZ = tz;
  try {
    localStorage.setItem(TZ_KEY, tz);
  } catch {
    /* private window */
  }
}

/** Date and wall-clock fields of an instant in the site timezone (browser-local when unknown). */
function siteParts(d: Date): { y: number; mo: number; d: number; h: number; m: number; s: number } {
  if (!siteTZ) return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
  let f = partsFmt.get(siteTZ);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: siteTZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    partsFmt.set(siteTZ, f);
  }
  const v: Record<string, number> = {};
  for (const p of f.formatToParts(d)) if (p.type !== "literal") v[p.type] = Number(p.value);
  return { y: v.year, mo: v.month, d: v.day, h: v.hour % 24, m: v.minute, s: v.second };
}

/** Wall clock of an ISO datetime in site time: via the timezone when known, else as written. */
function wallClock(iso: string): { h: number; m: number; s: number } | null {
  if (siteTZ || /[zZ]$/.test(iso)) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return siteParts(d);
  }
  const m = /T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso);
  return m ? { h: Number(m[1]), m: Number(m[2]), s: Number(m[3] ?? 0) } : null;
}

// ------------------------------------------------------------------------- formatting helpers

export function fmtTime(iso: string | null | undefined, withSeconds = false): string {
  if (!iso) return "—";
  const w = wallClock(iso);
  if (!w) return iso;
  const hm = String(w.h).padStart(2, "0") + ":" + String(w.m).padStart(2, "0");
  return withSeconds ? hm + ":" + String(w.s).padStart(2, "0") : hm;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T12:00:00" : ""));
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export function minutesOfDay(iso: string): number {
  const w = wallClock(iso);
  return w ? w.h * 60 + w.m + w.s / 60 : 0;
}

/** The current minute of the day at the site. */
export function nowMinutesOfDay(d: Date = new Date()): number {
  const w = siteParts(d);
  return w.h * 60 + w.m + w.s / 60;
}

/** Chapter starts set in the planner land on quarter hours. */
export const SNAP_MINUTES = 15;
export function snapMinute(minutes: number, max = 1440 - SNAP_MINUTES): number {
  return Math.max(0, Math.min(max, Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES));
}

/** "HH:MM" rounded to the quarter hour; empty stays empty. */
export function snapHHMM(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? hhmm(snapMinute(Number(m[1]) * 60 + Number(m[2]))) : t;
}

export function hhmm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

export function todayISO(): string {
  const w = siteParts(new Date());
  return w.y + "-" + String(w.mo).padStart(2, "0") + "-" + String(w.d).padStart(2, "0");
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "item";
}

export function describeStart(
  s: { kind: StartKindLike; time?: string | null; sun_event?: string | null; elevation?: number | null; direction?: string; offset_minutes?: number; earliest?: string | null; latest?: string | null; entity_id?: string | null; to_state?: string },
  groups?: { id: string; name: string }[],
): string {
  if (s.kind === "clock") return s.time ?? "--:--";
  if (s.kind === "sun") {
    const off = s.offset_minutes ? ` ${s.offset_minutes > 0 ? "+" : ""}${s.offset_minutes} min` : "";
    if (s.sun_event === "elevation" || (!s.sun_event && s.elevation != null)) return `sun ${s.elevation ?? 0}° ${s.direction ?? "setting"}${off}`;
    return `${s.sun_event ?? "sunset"}${off}`;
  }
  const hard = s.latest ? `${s.latest}` : "";
  const early = s.earliest ? ` or from ${s.earliest}` : "";
  const ref = s.entity_id ?? "sensor";
  const g = ref.startsWith("group:") ? groups?.find((x) => x.id === ref.slice(6)) : undefined;
  const who = g ? g.name : ref.replace(/^binary_sensor\./, "");
  const what = s.kind === "asleep" ? "when asleep" : s.kind === "motion" ? "on motion" : `when ${who} ${s.to_state ?? "on"}`;
  return hard ? `${hard}${early} ${what}` : `${what}${s.earliest ? ` (from ${s.earliest})` : ""}`;
}
type StartKindLike = "clock" | "sun" | "motion" | "asleep" | "sensor";
