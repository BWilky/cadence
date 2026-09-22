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

// ------------------------------------------------------------------------- formatting helpers

export function fmtTime(iso: string | null | undefined, withSeconds = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: withSeconds ? "2-digit" : undefined, hour12: false });
}

export function fmtDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T12:00:00" : ""));
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function hhmm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

export function todayISO(): string {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
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

export function describeStart(s: { kind: StartKindLike; time?: string | null; sun_event?: string | null; elevation?: number | null; direction?: string; offset_minutes?: number; earliest?: string | null; latest?: string | null }): string {
  if (s.kind === "clock") return s.time ?? "--:--";
  if (s.kind === "sun") {
    const off = s.offset_minutes ? ` ${s.offset_minutes > 0 ? "+" : ""}${s.offset_minutes} min` : "";
    if (s.sun_event === "elevation" || (!s.sun_event && s.elevation != null)) return `sun ${s.elevation ?? 0}° ${s.direction ?? "setting"}${off}`;
    return `${s.sun_event ?? "sunset"}${off}`;
  }
  const win = [s.earliest ? `from ${s.earliest}` : null, s.latest ? `by ${s.latest}` : null].filter(Boolean).join(", ");
  return `${s.kind === "asleep" ? "when asleep" : "on motion"}${win ? ` (${win})` : ""}`;
}
type StartKindLike = "clock" | "sun" | "motion" | "asleep";
