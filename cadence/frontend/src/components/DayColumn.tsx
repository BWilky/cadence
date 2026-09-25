import { useEffect, useRef, useState } from "react";
import { hhmm, minutesOfDay } from "../api";
import type { DayView, MusicAction, ResolvedChapter } from "../types";
import { chapterColor } from "./ui";
import type { TrackContext } from "./Track";

interface MusicPoint {
  m: number;
  level: number;
}

/** Same walk as the horizontal track: derive one "what the music is doing" envelope for the day. */
function musicEnvelope(chapters: ResolvedChapter[], starts: number[]) {
  let playing = false;
  let level = 0;
  let label: string | undefined;
  const points: MusicPoint[] = [{ m: 0, level: 0 }];
  const segments: { s: number; e: number; playing: boolean; label?: string }[] = [];
  const cues: number[] = [];
  const active = chapters.map((c, i) => ({ c, s: starts[i] })).filter((x) => x.c.enabled);
  active.forEach((x, i) => {
    const e = i + 1 < active.length ? active[i + 1].s : 1440;
    const music: (MusicAction & { scene?: string })[] = x.c.music ?? [];
    if (music.length) cues.push(x.s);
    let fadeMin = 0;
    const targets: number[] = [];
    let muted = false;
    for (const m of music) {
      if (m.kind === "spotify_context" || m.kind === "play_playlist" || m.kind === "play") {
        playing = true;
        label = m.label ?? label;
      } else if (m.kind === "pause" || m.kind === "stop") playing = false;
      else if (m.kind === "volume_fade" || m.kind === "volume_set") {
        targets.push(m.volume ?? 0);
        if (m.kind === "volume_fade") fadeMin = Math.max(fadeMin, m.minutes ?? 0);
        if (m.from_zero) points.push({ m: x.s, level: 0 });
      } else if (m.kind === "mute") muted = true;
      else if (m.kind === "unmute") muted = false;
    }
    if (targets.length) {
      const target = targets.reduce((a, b) => a + b, 0) / targets.length;
      points.push({ m: x.s, level });
      level = target;
      points.push({ m: Math.min(e, x.s + fadeMin), level });
    } else if (muted) {
      points.push({ m: x.s, level });
      level = 0;
      points.push({ m: x.s, level: 0 });
    }
    segments.push({ s: x.s, e, playing, label });
  });
  points.push({ m: 1440, level });
  return { segments, points, cues };
}

/** One day as a vertical column: 00:00 at the top, 24:00 at the bottom. */
export function DayColumn(props: {
  view: DayView;
  now?: string | null;
  currentId?: string | null;
  variantOf?: (c: ResolvedChapter) => string | null | undefined;
  onChapter?: (c: ResolvedChapter) => void;
  onContext?: (ctx: TrackContext) => void;
  onMoveStart?: (c: ResolvedChapter, minute: number) => void; // drag the top edge
  emptyText?: string;
  className?: string;
}) {
  const d = props.view;
  const chapters = d.chapters;
  const pct = (m: number) => (Math.max(0, Math.min(1440, m)) / 1440) * 100;
  const hostRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; minute: number } | null>(null);
  const baseStarts = chapters.map((c) => (c.start ? minutesOfDay(c.start) : minutesOfDay(c.nominal)));
  const starts = baseStarts.map((m, i) => (drag && chapters[i].chapter_id === drag.id ? drag.minute : m));

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect) return;
      const m = Math.round((((e.clientY - rect.top) / rect.height) * 1440) / 5) * 5;
      setDrag((x) => (x ? { ...x, minute: Math.max(0, Math.min(1435, m)) } : x));
    };
    const up = () => {
      const c = chapters.find((x) => x.chapter_id === drag.id);
      const orig = c ? baseStarts[chapters.indexOf(c)] : null;
      if (c && orig !== null && drag.minute !== orig) props.onMoveStart?.(c, drag.minute);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id, drag?.minute]);

  const isToday = props.now ? props.now.slice(0, 10) === d.date : false;
  const nowMin = isToday && props.now ? minutesOfDay(props.now) : null;
  const sr = d.sunrise ? minutesOfDay(d.sunrise) : null;
  const ss = d.sunset ? minutesOfDay(d.sunset) : null;
  const env = musicEnvelope(chapters, starts);
  const hasMusic = env.cues.length > 0;

  const ctxFromEvent = (e: React.MouseEvent<HTMLElement>, chapter: ResolvedChapter | null) => {
    if (!props.onContext) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (hostRef.current ?? e.currentTarget).getBoundingClientRect();
    const minute = Math.round((((e.clientY - rect.top) / rect.height) * 1440) / 5) * 5;
    props.onContext({ minute: Math.max(0, Math.min(1439, minute)), chapter, x: e.clientX, y: e.clientY });
  };

  const tone = d.occupied === false ? "vacant" : d.detached ? "own" : "following";
  const enabledStarts = chapters.map((c, i) => (c.enabled && c.start ? starts[i] : null)).filter((m): m is number => m !== null);
  const firstStart = enabledStarts.length ? Math.min(...enabledStarts) : 1440;

  return (
    <div ref={hostRef} className={["col", tone, hasMusic ? "has-music" : "", drag ? "dragging" : "", props.className ?? ""].join(" ")} onContextMenu={(e) => ctxFromEvent(e, null)}>
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} className="hline" style={{ top: pct(h * 60) + "%" }} />
      ))}
      {sr != null && ss != null ? (
        <>
          <div className="night" style={{ top: 0, height: pct(sr) + "%" }} />
          <div className="night" style={{ top: pct(ss) + "%", bottom: 0 }} />
        </>
      ) : null}
      {d.auto_mode === "on" ? <div className="auto" style={{ top: 0, bottom: 0 }} /> : null}
      {d.auto_mode === "windows"
        ? d.auto_windows.map((w, i) => {
            const [sh, sm] = w.start.split(":").map(Number);
            const [eh, em] = w.end.split(":").map(Number);
            const s = sh * 60 + sm;
            const e = eh * 60 + em;
            if (e > s) return <div key={i} className="auto" style={{ top: pct(s) + "%", height: pct(e - s) + "%" }} />;
            return (
              <span key={i}>
                <div className="auto" style={{ top: pct(s) + "%", bottom: 0 }} />
                <div className="auto" style={{ top: 0, height: pct(e) + "%" }} />
              </span>
            );
          })
        : null}
      {d.events.map((ev, i) => {
        if (ev.all_day) return <div key={i} className="event" style={{ top: "0.5%", bottom: "0.5%" }} title={ev.summary ?? ""} />;
        const s = minutesOfDay(ev.start);
        const e = ev.end && ev.end.slice(0, 10) === d.date ? minutesOfDay(ev.end) : 1440;
        return <div key={i} className="event" style={{ top: pct(s) + "%", height: Math.max(0.4, pct(e - s)) + "%" }} title={ev.summary ?? ""} />;
      })}
      {chapters.length === 0 && props.emptyText ? <div className="empty">{props.emptyText}</div> : null}
      {(() => {
        const co = d.carry_over;
        if (!co) return null;
        const end = co.until ? minutesOfDay(co.until) : firstStart;
        if (end <= 0) return null;
        const col = chapterColor(co.color);
        return (
          <div className={"block ghost " + (co.chapter_id === props.currentId ? "current" : "")} style={{ top: 0, height: pct(end) + "%", ["--c-fill" as string]: col.fill, ["--c-line" as string]: col.line }} title={`${co.name} — carried over from the previous day`}>
            <div className="n">↑ {co.name}</div>
          </div>
        );
      })()}
      {chapters.map((c, i) => {
        if (!c.enabled) return null;
        const s = starts[i];
        let e = 1440;
        for (let j = i + 1; j < chapters.length; j++) {
          if (chapters[j].enabled) {
            e = starts[j];
            break;
          }
        }
        const col = chapterColor(c.color);
        const v = props.variantOf?.(c);
        const past = nowMin != null && e < nowMin;
        const held = !!c.held_by;
        const cls = ["block", c.chapter_id === props.currentId ? "current" : "", c.pending_condition ? "cond" : "", held ? "held" : "", past ? "dim" : ""].join(" ");
        const fadeH = c.fade_minutes > 0 ? Math.min(100, (c.fade_minutes / Math.max(1, e - s)) * 100) : 0;
        const startText = held ? `waiting — held by ${c.held_by}` : c.start ? hhmm(s) : c.start_entity ? `waiting for ${c.start_entity} (hard start ${hhmm(s)})` : "waiting (" + hhmm(s) + ")";
        const holdText = c.hold ? `\nHolds while ${c.hold.label ?? c.hold.entity_id} is ${c.hold.while_state}${c.hold.latest ? ` (until ${c.hold.latest})` : ""}` : "";
        const tall = e - s >= 45;
        return (
          <div
            key={c.chapter_id + i}
            className={cls}
            style={{ top: pct(s) + "%", height: Math.max(1.2, pct(e - s)) + "%", ["--c-fill" as string]: col.fill, ["--c-line" as string]: col.line }}
            title={`${c.name} — ${startText}${holdText}${c.note ? "\n" + c.note : ""}`}
            onClick={() => props.onChapter?.(c)}
            onContextMenu={(ev) => ctxFromEvent(ev, c)}
          >
            {props.onMoveStart && c.kind === "clock" ? (
              <div
                className="grip"
                title="Drag to change the start time"
                onPointerDown={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  setDrag({ id: c.chapter_id, minute: s });
                }}
                onClick={(ev) => ev.stopPropagation()}
              />
            ) : null}
            {fadeH > 0 ? <div className="fade" style={{ height: fadeH + "%" }} /> : null}
            {c.hold ? <div className="holdmark" /> : null}
            <div className="t">
              {drag?.id === c.chapter_id ? hhmm(drag.minute) : c.start ? hhmm(s) : c.pending_condition ? "~" + hhmm(s) : hhmm(s)}
              {held ? " ⏸" : ""}
              {!tall ? <span className="n"> · {c.name}</span> : null}
            </div>
            {tall ? <div className="n">{c.name}</div> : null}
            {tall && v ? <div className="v">{v}</div> : null}
          </div>
        );
      })}
      {hasMusic ? (
        <div className="music" aria-hidden="true">
          {env.segments
            .filter((sg) => sg.playing)
            .map((sg, i) => (
              <div key={i} className="seg" style={{ top: pct(sg.s) + "%", height: Math.max(0.3, pct(sg.e - sg.s)) + "%" }} title={sg.label ? `♫ ${sg.label}` : "♫ playing"} />
            ))}
          <svg className="env" viewBox="0 0 100 1440" preserveAspectRatio="none">
            {(() => {
              const peak = Math.max(0.05, ...env.points.map((p) => p.level));
              const pts = env.points.map((p) => `${8 + (p.level / peak) * 84},${p.m}`).join(" ");
              return <polyline points={pts} />;
            })()}
          </svg>
          {env.cues.map((m, i) => (
            <span key={i} className="cue" style={{ top: pct(m) + "%" }} />
          ))}
        </div>
      ) : null}
      {nowMin != null ? <div className="playhead" style={{ top: pct(nowMin) + "%" }} /> : null}
    </div>
  );
}
