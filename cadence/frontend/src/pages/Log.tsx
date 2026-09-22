import { useEffect, useState } from "react";
import { api, type useLive } from "../api";
import type { LogEntry } from "../types";

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
    <div className="stack">
      <div className="row between">
        <h2 className="serif" style={{ fontStyle: "italic", margin: 0, fontWeight: 400 }}>
          Activity
        </h2>
        <input type="search" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="card" style={{ padding: "4px 14px" }}>
        {shown.length === 0 ? <div className="empty">Nothing yet.</div> : null}
        {shown.map((e) => (
          <div key={e.seq} className={"logline " + e.level}>
            <span className="ts">{new Date(e.ts * 1000).toLocaleTimeString([], { hour12: false })}</span>
            <span className="kind">{e.kind}</span>
            <span className="msg">
              {e.message}
              {e.detail ? (
                <details>
                  <summary>detail</summary>
                  <pre>{JSON.stringify(e.detail, null, 1)}</pre>
                </details>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
