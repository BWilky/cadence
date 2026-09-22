import { useState } from "react";
import { api, fmtTime, type useLive } from "../api";
import { Track } from "../components/Track";
import { SKY_LABEL, toast } from "../components/ui";
import type { ResolvedChapter } from "../types";

type Live = ReturnType<typeof useLive>;

export function Now({ live }: { live: Live }) {
  const st = live.status;
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<ResolvedChapter | null>(null);

  if (!st) return <div className="empty">Waiting for the engine…</div>;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast(String((e as Error).message), true);
    } finally {
      setBusy(false);
    }
  };

  const variantOf = (c: ResolvedChapter) => (st.chapter && c.chapter_id === st.chapter.id ? st.variant?.label : c.forced_variant ? c.forced_variant + " (forced)" : null);

  return (
    <div className="stack">
      <div className="grid2">
        <div className="card">
          <div className="eyebrow">Now · {st.template_name ?? "no template"}</div>
          <h2 style={{ fontSize: 34, margin: "4px 0 2px" }}>{st.chapter?.name ?? "Nothing scheduled"}</h2>
          <div className="row">
            {st.variant ? <span className="chip">{st.variant.label}</span> : null}
            {st.scenes.map((s) => (
              <span key={s.id} className="pill">
                <span className="swatch" style={{ background: s.color ?? "#556" }} /> {s.name}
              </span>
            ))}
          </div>
          {st.chapter?.note ? <p className="text-2 small" style={{ marginTop: 8 }}>{st.chapter.note}</p> : null}
          <div className="kv" style={{ marginTop: 10 }}>
            <span className="k">Started</span>
            <span className="mono">{fmtTime(st.chapter?.start)}</span>
            <span className="k">Next</span>
            <span>
              {st.next_chapter ? (
                <>
                  <b>{st.next_chapter.name}</b> <span className="mono text-2">{st.next_chapter.pending_condition ? `waiting for ${st.next_chapter.kind}` : fmtTime(st.next_chapter.at)}</span>
                </>
              ) : (
                "—"
              )}
            </span>
            <span className="k">Last applied</span>
            <span className="mono small">{st.last_apply ? `${fmtTime(st.last_apply.at)} · ${st.last_apply.chapter_id} / ${st.last_apply.variant_key ?? "-"}` : "never"}</span>
          </div>
          {st.fading.length ? (
            <div className="help" style={{ marginTop: 8 }}>
              Fading — waiting for {st.fading.map((f) => f.led).join(", ")} to light.
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="eyebrow">Control</div>
          <div className="row" style={{ marginTop: 8 }}>
            <span className={"chip " + (st.auto_active ? "live" : "off")}>{st.auto_active ? "Auto mode" : "Manual"}</span>
            <span className="small text-2">{st.auto_reason}</span>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sm live" disabled={busy || st.auto_override === "on"} onClick={() => act(() => api.post("api/engine/auto", { mode: "on" }), "Auto forced on for today")}>
              Force auto on today
            </button>
            <button className="btn sm" disabled={busy || st.auto_override === "off"} onClick={() => act(() => api.post("api/engine/auto", { mode: "off" }), "Auto off for today")}>
              Auto off today
            </button>
            {st.auto_override !== "none" ? (
              <button className="btn sm ghost" disabled={busy} onClick={() => act(() => api.post("api/engine/auto", { mode: "none" }), "Back to the schedule")}>
                Clear override
              </button>
            ) : null}
          </div>
          <hr className="sep" />
          {st.hold.active ? (
            <div className="stack">
              <div>
                <span className="chip warn">Manual hold</span> <span className="small text-2">{st.hold.reason}</span>
              </div>
              <div className="help">
                Since {fmtTime(st.hold.since)} · resumes {st.hold.until ? fmtTime(st.hold.until) : "at the next chapter"}
              </div>
              <div className="row">
                <button className="btn sm primary" disabled={busy} onClick={() => act(() => api.post("api/engine/hold/release"), "Hold released")}>
                  Resume automation now
                </button>
              </div>
            </div>
          ) : (
            <div className="help">No manual hold. Pressing a keypad scene by hand pauses Cadence until the next chapter.</div>
          )}
          <hr className="sep" />
          <div className="row">
            <button className="btn sm" disabled={busy} onClick={() => act(() => api.post("api/engine/apply", {}), "Re-applied the current chapter")}>
              Re-apply current chapter
            </button>
            <button className="btn sm ghost" disabled={busy} onClick={() => act(() => api.post("api/engine/recompute"), "Recomputed")}>
              Recompute
            </button>
          </div>
          {st.dry_run ? <div className="help" style={{ marginTop: 8 }}>Dry run is on: every action is logged, none is sent to Home Assistant.</div> : null}
        </div>

        <div className="card">
          <div className="eyebrow">Outside</div>
          <div className="kv" style={{ marginTop: 8 }}>
            <span className="k">Sky</span>
            <span>
              <b>{st.sky.state ? SKY_LABEL[st.sky.state] : "—"}</b> <span className="small text-2">{st.sky.reason}</span>
            </span>
            <span className="k">Lux</span>
            <span className="mono">{st.sky.lux != null ? Math.round(st.sky.lux) + " lx" : st.sky.lux_entity ? "stale / unavailable" : "no sensor"}</span>
            <span className="k">Sun</span>
            <span className="mono">
              {st.sky.elevation != null ? st.sky.elevation.toFixed(1) + "°" : "—"} · rise {fmtTime(st.sun.sunrise)} · set {fmtTime(st.sun.sunset)}
            </span>
            <span className="k">Weather</span>
            <span>{st.sky.weather ?? "—"}</span>
            <span className="k">Motion</span>
            <span>
              {st.motion.active == null ? "no sensor" : st.motion.active ? <span className="live">Movement</span> : "Quiet"}{" "}
              <span className="small muted mono">{st.motion.entity ?? ""}</span>
            </span>
            <span className="k">Asleep</span>
            <span>{st.asleep == null ? "no sensor" : st.asleep ? "Yes" : "No"}</span>
            <span className="k">Occupied</span>
            <span>{st.occupied == null ? "unknown" : st.occupied ? "Yes" : "No"}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <div className="eyebrow">Today · {st.date}</div>
          <div className="help">Click a chapter to jump to it.</div>
        </div>
        <div style={{ marginTop: 8 }}>
          <Track chapters={st.timeline} date={st.date} now={st.now} sunrise={st.sun.sunrise} sunset={st.sun.sunset} currentId={st.chapter?.id} variantOf={variantOf} onChapter={setPick} />
        </div>
        {pick ? (
          <div className="card" style={{ marginTop: 10, background: "var(--surface-2)" }}>
            <div className="row between">
              <div>
                <b className="serif" style={{ fontStyle: "italic", fontSize: 18 }}>
                  {pick.name}
                </b>{" "}
                <span className="mono small text-2">{pick.start ? fmtTime(pick.start) : "waiting"}</span>
                {pick.note ? <div className="small text-2">{pick.note}</div> : null}
              </div>
              <button className="btn sm ghost" onClick={() => setPick(null)}>
                Close
              </button>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm primary" disabled={busy} onClick={() => act(() => api.post("api/engine/apply", { chapter_id: pick.chapter_id }), `Applied ${pick.name}`)}>
                Apply now (auto variant)
              </button>
              {pick.variants.map((v) => (
                <button key={v.key} className="vbtn" disabled={busy} onClick={() => act(() => api.post("api/engine/apply", { chapter_id: pick.chapter_id, variant_key: v.key }), `Applied ${pick.name} · ${v.label}`)}>
                  {v.label}
                </button>
              ))}
            </div>
            <div className="help" style={{ marginTop: 6 }}>
              Applying a chapter by hand releases any hold and fires its scenes immediately. The schedule takes over again at the next chapter.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
