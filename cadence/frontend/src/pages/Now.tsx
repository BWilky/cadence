import { useState } from "react";
import { api, fmtTime, type useLive } from "../api";
import { Track } from "../components/Track";
import { Pill, SKY_LABEL, toast } from "../components/ui";
import type { ResolvedChapter } from "../types";

type Live = ReturnType<typeof useLive>;

export function Now({ live }: { live: Live }) {
  const st = live.status;
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<ResolvedChapter | null>(null);

  if (!st)
    return (
      <div className="flex h-64 items-center justify-center gap-3 opacity-60">
        <span className="loading loading-ring loading-md" /> Waiting for the engine…
      </div>
    );

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
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Now */}
        <div className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body gap-3">
            <div className="eyebrow">Now · {st.template_name ?? "no template"}</div>
            <h2 className="display text-4xl leading-none">{st.chapter?.name ?? "Nothing scheduled"}</h2>
            <div className="flex flex-wrap items-center gap-2">
              {st.variant ? <span className="badge badge-primary badge-soft">{st.variant.label}</span> : null}
              {st.scenes.map((s) => (
                <span key={s.id} className="badge badge-ghost gap-1.5">
                  <span className="swatch h-2.5 w-2.5" style={{ background: s.color ?? "#556" }} /> {s.name}
                </span>
              ))}
            </div>
            {st.chapter?.note ? <p className="text-sm opacity-70">{st.chapter.note}</p> : null}
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <span className="opacity-50">Started</span>
              <span className="font-mono">{fmtTime(st.chapter?.start)}</span>
              <span className="opacity-50">Next</span>
              <span>
                {st.next_chapter ? (
                  <>
                    <b className="font-medium">{st.next_chapter.name}</b>{" "}
                    <span className="font-mono opacity-70">{st.next_chapter.pending_condition ? `waiting for ${st.next_chapter.kind}` : fmtTime(st.next_chapter.at)}</span>
                  </>
                ) : (
                  "—"
                )}
              </span>
              <span className="opacity-50">Last applied</span>
              <span className="font-mono text-xs">{st.last_apply ? `${fmtTime(st.last_apply.at)} · ${st.last_apply.chapter_id} / ${st.last_apply.variant_key ?? "-"}` : "never"}</span>
            </div>
            {st.fading.length ? (
              <div role="alert" className="alert alert-soft alert-info py-2 text-xs">
                <span className="loading loading-dots loading-xs" />
                Fading — waiting for {st.fading.map((f) => f.led).join(", ")} to light.
              </div>
            ) : null}
          </div>
        </div>

        {/* Control */}
        <div className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body gap-3">
            <div className="eyebrow">Control</div>
            <div className="flex items-center gap-2">
              <span className={"badge " + (st.auto_active ? "badge-accent" : "badge-ghost")}>{st.auto_active ? "Auto mode" : "Manual"}</span>
              <span className="text-xs opacity-70">{st.auto_reason}</span>
            </div>
            <div className="join">
              <button className={"btn btn-sm join-item " + (st.auto_override === "on" ? "btn-accent" : "btn-outline")} disabled={busy} onClick={() => act(() => api.post("api/engine/auto", { mode: "on" }), "Auto forced on for today")}>
                Force on today
              </button>
              <button className={"btn btn-sm join-item " + (st.auto_override === "off" ? "btn-neutral" : "btn-outline")} disabled={busy} onClick={() => act(() => api.post("api/engine/auto", { mode: "off" }), "Auto off for today")}>
                Off today
              </button>
              <button className={"btn btn-sm join-item " + (st.auto_override === "none" ? "btn-neutral" : "btn-outline")} disabled={busy} onClick={() => act(() => api.post("api/engine/auto", { mode: "none" }), "Back to the schedule")}>
                Schedule
              </button>
            </div>
            <div className="divider my-0" />
            {st.hold.active ? (
              <div role="alert" className="alert alert-soft alert-warning items-start">
                <div className="flex flex-col gap-1">
                  <div className="font-medium">Manual hold — {st.hold.reason}</div>
                  <div className="text-xs opacity-80">
                    Since {fmtTime(st.hold.since)} · resumes {st.hold.until ? fmtTime(st.hold.until) : "at the next chapter"}
                  </div>
                  <button className="btn btn-sm btn-primary mt-1 self-start" disabled={busy} onClick={() => act(() => api.post("api/engine/hold/release"), "Hold released")}>
                    Resume automation now
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs opacity-60">No manual hold. Pressing a keypad scene by hand pauses Cadence until the next chapter.</p>
            )}
            <div className="divider my-0" />
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => act(() => api.post("api/engine/apply", {}), "Re-applied the current chapter")}>
                Re-apply current chapter
              </button>
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act(() => api.post("api/engine/recompute"), "Recomputed")}>
                Recompute
              </button>
            </div>
            {st.dry_run ? <p className="text-xs text-warning/80">Dry run is on: every action is logged, none is sent to Home Assistant.</p> : null}
          </div>
        </div>

        {/* Outside */}
        <div className="card border border-base-300 bg-base-100 shadow-sm">
          <div className="card-body gap-3">
            <div className="eyebrow">Outside</div>
            <div className="stats stats-vertical bg-base-200/60 shadow-none sm:stats-horizontal">
              <div className="stat px-4 py-3">
                <div className="stat-title text-xs">Sky</div>
                <div className="stat-value text-2xl">{st.sky.state ? SKY_LABEL[st.sky.state] : "—"}</div>
                <div className="stat-desc truncate">{st.sky.reason}</div>
              </div>
              <div className="stat px-4 py-3">
                <div className="stat-title text-xs">Lux</div>
                <div className="stat-value font-mono text-2xl">{st.sky.lux != null ? Math.round(st.sky.lux) : "—"}</div>
                <div className="stat-desc">{st.sky.lux != null ? "lx" : st.sky.lux_entity ? "stale / unavailable" : "no sensor"}</div>
              </div>
              <div className="stat px-4 py-3">
                <div className="stat-title text-xs">Sun</div>
                <div className="stat-value font-mono text-2xl">{st.sky.elevation != null ? st.sky.elevation.toFixed(0) + "°" : "—"}</div>
                <div className="stat-desc">
                  ↑ {fmtTime(st.sun.sunrise)} · ↓ {fmtTime(st.sun.sunset)}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <span className="opacity-50">Weather</span>
              <span>{st.sky.weather ?? "—"}</span>
              <span className="opacity-50">Motion</span>
              <span>
                {st.motion.active == null ? "no sensor" : st.motion.active ? <span className="text-accent">Movement</span> : "Quiet"} <span className="font-mono text-[11px] opacity-50">{st.motion.entity ?? ""}</span>
              </span>
              <span className="opacity-50">Asleep</span>
              <span>{st.asleep == null ? "no sensor" : st.asleep ? "Yes" : "No"}</span>
              <span className="opacity-50">Occupied</span>
              <span>{st.occupied == null ? "unknown" : st.occupied ? "Yes" : "No"}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-3">
          <div className="flex items-center justify-between">
            <div className="eyebrow">Today · {st.date}</div>
            <div className="text-xs opacity-60">Click a chapter to jump to it.</div>
          </div>
          <Track chapters={st.timeline} date={st.date} now={st.now} sunrise={st.sun.sunrise} sunset={st.sun.sunset} currentId={st.chapter?.id} variantOf={variantOf} onChapter={setPick} />
          {pick ? (
            <div className="rounded-box border border-base-300 bg-base-200/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="display text-xl">{pick.name}</span> <span className="font-mono text-xs opacity-60">{pick.start ? fmtTime(pick.start) : "waiting"}</span>
                  {pick.note ? <div className="text-xs opacity-70">{pick.note}</div> : null}
                </div>
                <button className="btn btn-ghost btn-xs" onClick={() => setPick(null)}>
                  ✕
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act(() => api.post("api/engine/apply", { chapter_id: pick.chapter_id }), `Applied ${pick.name}`)}>
                  Apply now (auto variant)
                </button>
                {pick.variants.map((v) => (
                  <Pill key={v.key} disabled={busy} onClick={() => act(() => api.post("api/engine/apply", { chapter_id: pick.chapter_id, variant_key: v.key }), `Applied ${pick.name} · ${v.label}`)}>
                    {v.label}
                  </Pill>
                ))}
              </div>
              <p className="mt-2 text-xs opacity-60">Applying a chapter by hand releases any hold and fires its scenes immediately. The schedule takes over again at the next chapter.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
