import { mdiHistory, mdiMagnify } from "@mdi/js";
import { useEffect, useState } from "react";
import { api, type useLive } from "../api";
import { Chip, Icon, Page, Section } from "../components/ui";
import type { LogEntry } from "../types";

const TONE: Record<string, "attn" | "warn" | undefined> = { warning: "attn", error: "warn" };

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
    <Page
      title="Activity"
      icon={mdiHistory}
      actions={
        <div className="search" style={{ width: 240 }}>
          <Icon path={mdiMagnify} />
          <input type="search" className="input sm" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter activity" />
        </div>
      }
    >
      <Section>
        {shown.length === 0 ? (
          <div className="empty">Nothing yet.</div>
        ) : (
          <div className="log">
            {shown.map((e) => (
              <div key={e.seq} className="log-row">
                <span className="ts">{new Date(e.ts * 1000).toLocaleTimeString([], { hour12: false })}</span>
                <span className="kind">
                  <Chip sm tone={TONE[e.level]}>
                    {e.kind}
                  </Chip>
                </span>
                <div className={"msg" + (e.level === "error" ? " err" : e.level === "warning" ? " warn" : "")}>
                  {e.message}
                  {e.detail ? (
                    <details>
                      <summary>detail</summary>
                      <pre>{JSON.stringify(e.detail, null, 1)}</pre>
                    </details>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </Page>
  );
}
