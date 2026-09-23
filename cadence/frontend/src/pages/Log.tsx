import { useEffect, useState } from "react";
import { api, type useLive } from "../api";
import type { LogEntry } from "../types";

const LEVEL: Record<string, string> = { info: "badge-ghost", warning: "badge-warning badge-soft", error: "badge-error badge-soft" };

export function Log({ live }: { live: ReturnType<typeof useLive> }) {
  const [base, setBase] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    api.get<LogEntry[]>("api/log?limit=300").then(setBase).catch(() => undefined);
  }, []);
  const seen = new Set<number>();
  const all = [...live.logs, ...base].filter((e) => (seen.has(e.seq) ? false : (seen.add(e.seq), true)));
  const q = filter.toLowerCase();
  const shown = q ? all.filter((e) => e.message.toLowerCase().includes(q) || e.kind.includes(q)) : all;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="display text-2xl">Activity</h2>
        <input type="search" className="input input-sm w-60" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="card card-border bg-base-200">
        <div className="card-body p-0">
          {shown.length === 0 ? <div className="p-8 text-center opacity-60">Nothing yet.</div> : null}
          <table className="table table-xs">
            <tbody>
              {shown.map((e) => (
                <tr key={e.seq} className="hover:bg-base-300/40">
                  <td className="w-20 font-mono text-[11px] opacity-60">{new Date(e.ts * 1000).toLocaleTimeString([], { hour12: false })}</td>
                  <td className="w-24">
                    <span className={"badge badge-xs " + (LEVEL[e.level] ?? "badge-ghost")}>{e.kind}</span>
                  </td>
                  <td className={e.level === "error" ? "text-error" : e.level === "warning" ? "text-warning" : ""}>
                    {e.message}
                    {e.detail ? (
                      <details className="collapse-arrow mt-1 text-[11px] opacity-70">
                        <summary className="cursor-pointer">detail</summary>
                        <pre className="mt-1 whitespace-pre-wrap font-mono">{JSON.stringify(e.detail, null, 1)}</pre>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
