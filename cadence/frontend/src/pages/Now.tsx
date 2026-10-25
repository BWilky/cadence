import {
  mdiAccountGroupOutline,
  mdiCalculatorVariantOutline,
  mdiCalendarClock,
  mdiCalendarToday,
  mdiClockOutline,
  mdiClose,
  mdiHandBackRightOutline,
  mdiHistory,
  mdiLoading,
  mdiMotionSensor,
  mdiPause,
  mdiPauseCircleOutline,
  mdiPlay,
  mdiPlayCircleOutline,
  mdiRefresh,
  mdiRobotOutline,
  mdiSkipNext,
  mdiSleep,
  mdiTuneVariant,
  mdiWeatherCloudy,
  mdiWeatherNight,
  mdiWeatherPartlyCloudy,
  mdiWeatherSunny,
  mdiWhiteBalanceSunny,
} from "@mdi/js";
import { useState } from "react";
import { api, fmtTime, type useLive } from "../api";
import { Track } from "../components/Track";
import { Act, Btn, Chip, Icon, IconBtn, Loading, Page, Row, SKY_LABEL, Section, toast } from "../components/ui";
import type { ResolvedChapter } from "../types";

const OCC_REASON: Record<string, string> = { forced: "forced on", forced_off: "forced off", rule: "set by rule", template: "a template runs" };
const SKY_ICON: Record<string, string> = { sunny: mdiWeatherSunny, cloudy: mdiWeatherCloudy, dark: mdiWeatherNight };

type Live = ReturnType<typeof useLive>;

export function Now({ live }: { live: Live }) {
  const st = live.status;
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<ResolvedChapter | null>(null);

  if (!st)
    return (
      <Page title="Now" icon={mdiPlayCircleOutline}>
        <Loading text="Waiting for the engine…" />
      </Page>
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

  const templateLabel = st.template_name ?? (st.template_kind === "own" ? "Own chapters" : "Nothing runs");
  const templateHint = st.template_kind === "rule" && st.template_reason ? st.template_reason.split(" · ")[0] : st.template_kind === "custom" ? "chosen" : null;

  return (
    <Page
      title="Now"
      icon={mdiPlayCircleOutline}
      actions={
        <div className="chips">
          {st.variant ? <Chip tone="on">{st.variant.label}</Chip> : null}
          <Chip title={st.template_reason ?? ""}>
            {templateLabel}
            {templateHint ? <span className="muted"> · {templateHint}</span> : null}
          </Chip>
          {st.hold.active ? <Chip tone="warn">Holding</Chip> : null}
          {st.dry_run ? <Chip tone="attn">Dry run</Chip> : null}
        </div>
      }
    >
      <div className="cols">
        {/* ------------------------------------------------------------ left */}
        <div className="col">
          <Section icon={mdiPlayCircleOutline} title="Now">
            <div className="big-title">{st.chapter?.name ?? "Nothing scheduled"}</div>
            {st.scenes.length ? (
              <div className="chips">
                {st.scenes.map((s) => (
                  <Chip key={s.id}>
                    <span className="swatch" style={{ background: s.color ?? "#556" }} /> {s.name}
                  </Chip>
                ))}
              </div>
            ) : null}
            {st.chapter?.note ? <p className="help">{st.chapter.note}</p> : null}
            <div className="rows">
              <Row compact icon={mdiClockOutline} title="Started" right={<span className="row-val">{fmtTime(st.chapter?.start)}</span>} />
              <Row
                compact
                icon={mdiSkipNext}
                title="Next"
                sub={st.next_chapter ? st.next_chapter.name : "Nothing more today"}
                right={<span className="row-val">{st.next_chapter ? (st.next_chapter.pending_condition ? `waiting for ${st.next_chapter.kind}` : fmtTime(st.next_chapter.at)) : "—"}</span>}
              />
              <Row
                compact
                icon={mdiHistory}
                title="Last applied"
                sub={st.last_apply ? <span className="mono">{`${st.last_apply.chapter_id} / ${st.last_apply.variant_key ?? "-"}`}</span> : "never"}
                right={st.last_apply ? <span className="row-val">{fmtTime(st.last_apply.at)}</span> : null}
              />
            </div>
            {st.chapter_hold ? (
              <div className="sub" style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}>
                <Row
                  compact
                  icon={mdiPauseCircleOutline}
                  tone="on"
                  title={
                    <>
                      Holding <b>{st.chapter_hold.chapter}</b>
                    </>
                  }
                  sub={
                    <>
                      While <span className="mono">{st.chapter_hold.label ?? st.chapter_hold.entity_id}</span> is {st.chapter_hold.while_state}
                      {st.chapter_hold.until ? ` · hard end ${fmtTime(st.chapter_hold.until)}` : ""}. The next chapter starts when it clears.
                    </>
                  }
                />
              </div>
            ) : null}
            {st.fading.length ? (
              <div className="sub">
                <div className="row compact">
                  <Icon path={mdiLoading} className="spin muted" size="sm" />
                  <span className="row-text">
                    <span className="row-sub">Fading — waiting for {st.fading.map((f) => f.led).join(", ")} to light.</span>
                  </span>
                </div>
              </div>
            ) : null}
          </Section>

          <Section icon={mdiCalendarToday} title="Today" count={st.date} actions={<span className="count">Click a chapter to jump to it</span>}>
            <Track chapters={st.timeline} date={st.date} now={st.now} sunrise={st.sun.sunrise} sunset={st.sun.sunset} currentId={st.chapter?.id} variantOf={variantOf} onChapter={setPick} carryOver={st.carry_over} />
            {pick ? (
              <div className="sub">
                <div className="row">
                  <span className="row-text">
                    <span className="row-title">
                      {pick.name} <span className="muted tnum" style={{ fontWeight: 400, fontSize: 13 }}>{pick.start ? fmtTime(pick.start) : "waiting"}</span>
                    </span>
                    {pick.note ? <span className="row-sub">{pick.note}</span> : null}
                  </span>
                  <IconBtn icon={mdiClose} label="Close" size="sm" onClick={() => setPick(null)} />
                </div>
                <div className="chips">
                  <Btn variant="primary" disabled={busy} onClick={() => act(() => api.post("api/engine/apply", { chapter_id: pick.chapter_id }), `Applied ${pick.name}`)}>
                    Apply now (auto variant)
                  </Btn>
                  {pick.variants.map((v) => (
                    <Chip key={v.key} disabled={busy} onClick={() => act(() => api.post("api/engine/apply", { chapter_id: pick.chapter_id, variant_key: v.key }), `Applied ${pick.name} · ${v.label}`)}>
                      {v.label}
                    </Chip>
                  ))}
                </div>
                <p className="help">Applying a chapter by hand releases any hold and fires its scenes immediately. The schedule takes over again at the next chapter.</p>
              </div>
            ) : null}
          </Section>
        </div>

        {/* ----------------------------------------------------------- right */}
        <div className="col">
          <Section icon={mdiTuneVariant} title="Control">
            <div className="act-grid three">
              <Act icon={mdiPlay} title="Force on today" sub="Auto runs whatever the schedule says" on={st.auto_override === "on"} disabled={busy} onClick={() => act(() => api.post("api/engine/auto", { mode: "on" }), "Auto forced on for today")} />
              <Act icon={mdiPause} title="Off today" sub="Cadence leaves the building alone" on={st.auto_override === "off"} disabled={busy} onClick={() => act(() => api.post("api/engine/auto", { mode: "off" }), "Auto off for today")} />
              <Act icon={mdiCalendarClock} title="Schedule" sub="Follow the weekly windows" on={st.auto_override === "none"} disabled={busy} onClick={() => act(() => api.post("api/engine/auto", { mode: "none" }), "Back to the schedule")} />
            </div>
            <Row icon={mdiRobotOutline} tone={st.auto_active ? "on" : undefined} title={st.auto_active ? "Auto mode" : "Manual"} sub={st.auto_reason} />
            <div className="divider" />
            {st.hold.active ? (
              <div className="sub" style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>
                <Row
                  compact
                  icon={mdiHandBackRightOutline}
                  tone="bad"
                  title={`Manual hold — ${st.hold.reason}`}
                  sub={
                    <>
                      Since {fmtTime(st.hold.since)} · resumes {st.hold.until ? fmtTime(st.hold.until) : "at the next chapter"}
                    </>
                  }
                />
                <div>
                  <Btn variant="primary" disabled={busy} onClick={() => act(() => api.post("api/engine/hold/release"), "Hold released")}>
                    Resume automation now
                  </Btn>
                </div>
              </div>
            ) : (
              <p className="help">No manual hold. Pressing a keypad scene by hand pauses Cadence until the next chapter.</p>
            )}
            <div className="act-grid">
              <Act icon={mdiRefresh} title="Re-apply current chapter" sub="Fires the chapter's scenes again" disabled={busy} onClick={() => act(() => api.post("api/engine/apply", {}), "Re-applied the current chapter")} />
              <Act icon={mdiCalculatorVariantOutline} title="Recompute" sub="Re-reads sensors and the plan" disabled={busy} onClick={() => act(() => api.post("api/engine/recompute"), "Recomputed")} />
            </div>
            {st.dry_run ? (
              <p className="help" style={{ color: "color-mix(in srgb, var(--warn) 70%, var(--text))" }}>
                Dry run is on: every action is logged, none is sent to Home Assistant.
              </p>
            ) : null}
          </Section>

          <Section icon={mdiWeatherPartlyCloudy} title="Outside">
            <div className="rows">
              <Row
                icon={st.sky.state ? SKY_ICON[st.sky.state] : mdiWeatherPartlyCloudy}
                tone={st.sky.state === "sunny" ? "warn" : st.sky.state === "dark" ? "on" : undefined}
                title={st.sky.state ? SKY_LABEL[st.sky.state] : "—"}
                sub={st.sky.reason}
                right={<span className="row-val">{st.sky.lux != null ? `${Math.round(st.sky.lux)} lx` : st.sky.lux_entity ? "stale / unavailable" : "no sensor"}</span>}
              />
              <Row
                icon={mdiWhiteBalanceSunny}
                title={st.sky.elevation != null ? `Sun ${st.sky.elevation.toFixed(0)}°` : "Sun —"}
                sub={
                  <>
                    ↑ {fmtTime(st.sun.sunrise)} · ↓ {fmtTime(st.sun.sunset)}
                  </>
                }
              />
              <Row icon={mdiWeatherPartlyCloudy} title="Weather" sub={st.sky.weather ?? "—"} />
              <Row
                icon={mdiMotionSensor}
                tone={st.motion.active ? "on" : undefined}
                title={st.motion.active == null ? "No motion sensor" : st.motion.active ? "Movement" : "Quiet"}
                sub={st.motion.entity ? <span className="mono">{st.motion.entity}</span> : "Motion"}
              />
              <Row icon={mdiSleep} title={st.asleep == null ? "No sleep sensor" : st.asleep ? "Asleep" : "Awake"} sub="Building asleep" />
              <Row
                icon={mdiAccountGroupOutline}
                tone={st.occupied ? "ok" : undefined}
                title={st.occupied == null ? "Occupancy unknown" : st.occupied ? "Occupied" : "Vacant"}
                sub={st.occupied_reason && st.occupied_reason !== "none" ? OCC_REASON[st.occupied_reason] ?? st.occupied_reason : "Occupied"}
              />
            </div>
          </Section>
        </div>
      </div>
    </Page>
  );
}
