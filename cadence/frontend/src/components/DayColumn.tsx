import { useEffect, useRef, useState } from "react";
import { hhmm, minutesOfDay } from "../api";
import type { DayView, ResolvedChapter } from "../types";
import { chapterColor } from "./ui";
import type { TrackContext } from "./Track";

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
    <div ref={hostRef} className={["col", tone, drag ? "dragging" : "", props.className ?? ""].join(" ")} onContextMenu={(e) => ctxFromEvent(e, null)}>
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
          <div className={"block ghost " + (co.chapter_id === props.currentId ? "current" : "")} style={{ top: 0, height: `calc(${pct(end)}% - 3px)`, ["--c-fill" as string]: col.fill, ["--c-line" as string]: col.line }} title={`${co.name} — carried over from the previous day`}>
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
        let nextIdx = -1;
        for (let j = i + 1; j < chapters.length; j++) {
          if (chapters[j].enabled) {
            nextIdx = j;
            break;
          }
        }
        const next = nextIdx >= 0 ? chapters[nextIdx] : null;
        const col = chapterColor(c.color);
        const v = props.variantOf?.(c);
        const past = nowMin != null && e < nowMin;
        const held = !!c.held_by;
        const cls = ["block", c.chapter_id === props.currentId ? "current" : "", c.pending_condition ? "cond" : "", held ? "held" : "", past ? "dim" : ""].join(" ");
        const startText = held ? `waiting — held by ${c.held_by}` : c.start ? hhmm(s) : c.start_entity ? `waiting for ${c.start_entity} (hard start ${hhmm(s)})` : "waiting (" + hhmm(s) + ")";
        const holdText = c.hold ? `\nHolds while ${c.hold.label ?? c.hold.entity_id} is ${c.hold.while_state}${c.hold.latest ? ` (until ${c.hold.latest})` : ""}` : "";
        const tall = e - s >= 60;
        const hasMusic = (c.music ?? []).length > 0;
        const timeText = drag?.id === c.chapter_id ? hhmm(drag.minute) : c.pending_condition ? "~" + hhmm(s) : hhmm(s);
        return (
          <div
            key={c.chapter_id + i}
            className={cls}
            style={{ top: `calc(${pct(s)}% + 1px)`, height: `calc(${Math.max(1.2, pct(e - s))}% - 3px)`, ["--c-fill" as string]: col.fill, ["--c-line" as string]: col.line }}
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
              >
                <span className="pill" />
              </div>
            ) : null}
            <div className="t">
              <span>{timeText}</span>
              {held ? <span title={`held by ${c.held_by}`}>⏸</span> : null}
              {hasMusic ? <span className="mu" title="Music on this chapter">♫</span> : null}
              {!tall ? <span className="n"> {c.name}</span> : null}
            </div>
            {tall ? <div className="n">{c.name}</div> : null}
            {tall && v ? <div className="v">{v}</div> : null}
            {c.hold ? <div className="holdmark" /> : null}
            {props.onMoveStart && next && next.kind === "clock" ? (
              <div
                className="grip bottom"
                title={`Drag to change when ${next.name} starts`}
                onPointerDown={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  setDrag({ id: next.chapter_id, minute: starts[nextIdx] });
                }}
                onClick={(ev) => ev.stopPropagation()}
              >
                <span className="pill" />
              </div>
            ) : null}
          </div>
        );
      })}
      {nowMin != null ? <div className="playhead" style={{ top: pct(nowMin) + "%" }} /> : null}
    </div>
  );
}
