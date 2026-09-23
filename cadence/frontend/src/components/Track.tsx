import { useEffect, useRef, useState } from "react";
import { hhmm, minutesOfDay } from "../api";
import type { CalendarEvent, CarryOver, MusicAction, ResolvedChapter, TimeWindow } from "../types";
import { chapterColor } from "./ui";

export interface TrackContext {
  minute: number; // time under the pointer
  chapter: ResolvedChapter | null;
  x: number;
  y: number;
}

interface MusicPoint {
  m: number;
  level: number; // 0..1
}

/** Walk the day's chapters and derive a single "what the music is doing" envelope. */
function musicEnvelope(chapters: ResolvedChapter[], starts: number[]): { segments: { s: number; e: number; playing: boolean; label?: string; image?: string | null }[]; points: MusicPoint[]; cues: number[] } {
  let playing = false;
  let level = 0;
  let label: string | undefined;
  let image: string | null | undefined;
  const points: MusicPoint[] = [{ m: 0, level: 0 }];
  const segments: { s: number; e: number; playing: boolean; label?: string; image?: string | null }[] = [];
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
        image = m.image ?? image;
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
    segments.push({ s: x.s, e, playing, label, image });
  });
  points.push({ m: 1440, level });
  return { segments, points, cues };
}

/** A 24-hour horizontal track of resolved chapters with a subtle music strip along the bottom. */
export function Track(props: {
  chapters: ResolvedChapter[];
  date: string;
  now?: string | null;
  sunrise?: string | null;
  sunset?: string | null;
  autoWindows?: TimeWindow[];
  autoMode?: string;
  events?: CalendarEvent[];
  currentId?: string | null;
  variantOf?: (c: ResolvedChapter) => string | null | undefined;
  onChapter?: (c: ResolvedChapter) => void;
  onContext?: (ctx: TrackContext) => void;
  onMoveStart?: (c: ResolvedChapter, minute: number) => void; // drag the left edge
  carryOver?: CarryOver | null;
  hours?: boolean;
  hourLabels?: boolean;
  music?: boolean;
  className?: string;
}) {
  const pct = (m: number) => (Math.max(0, Math.min(1440, m)) / 1440) * 100;
  const hostRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; minute: number } | null>(null);
  const baseStarts = props.chapters.map((c) => (c.start ? minutesOfDay(c.start) : minutesOfDay(c.nominal)));
  const starts = baseStarts.map((m, i) => (drag && props.chapters[i].chapter_id === drag.id ? drag.minute : m));

  // Drag the left edge of a block to move its start (5-minute snapping).
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect) return;
      const m = Math.round((((e.clientX - rect.left) / rect.width) * 1440) / 5) * 5;
      setDrag((d) => (d ? { ...d, minute: Math.max(0, Math.min(1435, m)) } : d));
    };
    const up = () => {
      const c = props.chapters.find((x) => x.chapter_id === drag.id);
      const orig = c ? baseStarts[props.chapters.indexOf(c)] : null;
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
  const isToday = props.now ? props.now.slice(0, 10) === props.date : false;
  const nowMin = isToday && props.now ? minutesOfDay(props.now) : null;
  const sr = props.sunrise ? minutesOfDay(props.sunrise) : null;
  const ss = props.sunset ? minutesOfDay(props.sunset) : null;
  const showMusic = props.music !== false;
  const env = showMusic ? musicEnvelope(props.chapters, starts) : null;

  const ctxFromEvent = (e: React.MouseEvent<HTMLElement>, chapter: ResolvedChapter | null) => {
    if (!props.onContext) return;
    e.preventDefault();
    e.stopPropagation();
    const host = e.currentTarget.closest(".track") as HTMLElement | null;
    const rect = (host ?? e.currentTarget).getBoundingClientRect();
    const minute = Math.round(((e.clientX - rect.left) / rect.width) * 1440 / 5) * 5;
    props.onContext({ minute: Math.max(0, Math.min(1439, minute)), chapter, x: e.clientX, y: e.clientY });
  };

  return (
    <div ref={hostRef} className={"track " + (props.className ?? "") + (showMusic ? " has-music" : "") + (drag ? " dragging" : "")} onContextMenu={(e) => ctxFromEvent(e, null)}>
      {sr != null && ss != null ? (
        <>
          <div className="night" style={{ left: 0, width: pct(sr) + "%" }} />
          <div className="night" style={{ left: pct(ss) + "%", right: 0 }} />
        </>
      ) : null}
      {props.hours !== false
        ? Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="hour" style={{ left: pct(h * 60) + "%" }}>
              {props.hourLabels !== false && h % 3 === 0 ? <span>{String(h).padStart(2, "0")}</span> : null}
            </div>
          ))
        : null}
      {props.autoMode === "on" ? <div className="auto" style={{ left: 0, right: 0 }} /> : null}
      {props.autoMode === "windows"
        ? (props.autoWindows ?? []).map((w, i) => {
            const [sh, sm] = w.start.split(":").map(Number);
            const [eh, em] = w.end.split(":").map(Number);
            const s = sh * 60 + sm;
            const e = eh * 60 + em;
            if (e > s) return <div key={i} className="auto" style={{ left: pct(s) + "%", width: pct(e - s) + "%" }} />;
            return (
              <span key={i}>
                <div className="auto" style={{ left: pct(s) + "%", right: 0 }} />
                <div className="auto" style={{ left: 0, width: pct(e) + "%" }} />
              </span>
            );
          })
        : null}
      {(props.events ?? []).map((ev, i) => {
        if (ev.all_day) return <div key={i} className="event" style={{ left: "0.5%", right: "0.5%" }} title={ev.summary ?? ""} />;
        const s = minutesOfDay(ev.start);
        const e = ev.end && ev.end.slice(0, 10) === props.date ? minutesOfDay(ev.end) : 1440;
        return <div key={i} className="event" style={{ left: pct(s) + "%", width: Math.max(0.4, pct(e - s)) + "%" }} title={ev.summary ?? ""} />;
      })}
      {(() => {
        // Yesterday's last chapter runs on until this day's first chapter starts.
        const co = props.carryOver;
        if (!co) return null;
        const startedMins = props.chapters.map((c, i) => (c.enabled && c.start ? starts[i] : null)).filter((m): m is number => m !== null);
        const firstStart = startedMins.length ? Math.min(...startedMins) : 1440;
        const end = co.until ? minutesOfDay(co.until) : firstStart;
        if (end <= 0) return null;
        const col = chapterColor(co.color);
        return (
          <div className={"block ghost " + (co.chapter_id === props.currentId ? "current" : "")} style={{ left: 0, width: pct(end) + "%", ["--c-fill" as string]: col.fill, ["--c-line" as string]: col.line }} title={`${co.name} — carried over from the previous day`}>
            ← {co.name}
          </div>
        );
      })()}
      {props.chapters.map((c, i) => {
        if (!c.enabled) return null;
        const s = starts[i];
        let e = 1440;
        for (let j = i + 1; j < props.chapters.length; j++) {
          if (props.chapters[j].enabled) {
            e = starts[j];
            break;
          }
        }
        const col = chapterColor(c.color);
        const v = props.variantOf?.(c);
        const past = nowMin != null && e < nowMin;
        const held = !!c.held_by;
        const cls = ["block", c.chapter_id === props.currentId ? "current" : "", c.pending_condition ? "cond" : "", held ? "held" : "", past ? "dim" : "", c.source === "day" ? "dayonly" : "", c.hold ? "holder" : ""].join(" ");
        const fadeW = c.fade_minutes > 0 ? Math.min(100, (c.fade_minutes / Math.max(1, e - s)) * 100) : 0;
        const startText = held ? `waiting — held by ${c.held_by}` : c.start ? hhmm(s) : c.start_entity ? `waiting for ${c.start_entity} (hard start ${hhmm(s)})` : "waiting (" + hhmm(s) + ")";
        const holdText = c.hold ? `\nHolds while ${c.hold.label ?? c.hold.entity_id} is ${c.hold.while_state}${c.hold.latest ? ` (until ${c.hold.latest})` : ""}` : "";
        return (
          <div
            key={c.chapter_id + i}
            className={cls}
            style={{ left: pct(s) + "%", width: Math.max(0.6, pct(e - s)) + "%", ["--c-fill" as string]: col.fill, ["--c-line" as string]: col.line }}
            title={`${c.name} — ${startText}${holdText}${c.source === "day" ? "\n(this day only)" : ""}${c.note ? "\n" + c.note : ""}`}
            onClick={() => props.onChapter?.(c)}
            onContextMenu={(e) => ctxFromEvent(e, c)}
          >
            {props.onMoveStart && c.kind === "clock" ? (
              <div
                className="grip"
                title="Drag to change the start time"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDrag({ id: c.chapter_id, minute: s });
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : null}
            {fadeW > 0 ? <div className="fade" style={{ width: fadeW + "%" }} /> : null}
            {c.hold ? <div className="holdmark" /> : null}
            {c.source === "day" ? <span className="mr-1 opacity-70">◆</span> : null}
            {held ? <span className="mr-1 opacity-70">⏸</span> : null}
            {c.name}
            {drag?.id === c.chapter_id ? <span className="v">{hhmm(drag.minute)}</span> : v ? <span className="v">{v}</span> : null}
          </div>
        );
      })}
      {env ? (
        <div className="music" aria-hidden="true">
          {env.segments
            .filter((sg) => sg.playing)
            .map((sg, i) => (
              <div key={i} className="seg" style={{ left: pct(sg.s) + "%", width: Math.max(0.3, pct(sg.e - sg.s)) + "%" }} title={sg.label ? `♫ ${sg.label}` : "♫ playing"} />
            ))}
          <svg className="env" viewBox="0 0 1440 100" preserveAspectRatio="none">
            {(() => {
              // Normalise to the day's loudest target so a 12% zone level still draws a visible shape.
              const peak = Math.max(0.05, ...env.points.map((p) => p.level));
              const pts = env.points.map((p) => `${p.m},${96 - (p.level / peak) * 88}`).join(" ");
              return <polyline points={pts} />;
            })()}
          </svg>
          {env.cues.map((m, i) => (
            <span key={i} className="cue" style={{ left: pct(m) + "%" }} />
          ))}
        </div>
      ) : null}
      {nowMin != null ? <div className="playhead" style={{ left: pct(nowMin) + "%" }} /> : null}
    </div>
  );
}
