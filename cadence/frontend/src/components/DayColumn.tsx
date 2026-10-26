import { useEffect, useRef, useState } from "react";
import { hhmm, minutesOfDay, snapMinute } from "../api";
import type { DayView, ResolvedChapter } from "../types";
import { chapterVars } from "./ui";
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
  playhead?: boolean; // false = the parent draws one line across every column
  hourH?: number; // px per hour the parent sizes the column with (default 44)
}) {
  const d = props.view;
  const chapters = d.chapters;
  const pct = (m: number) => (Math.max(0, Math.min(1440, m)) / 1440) * 100;
  const hostRef = useRef<HTMLDivElement>(null);
  // The edge being dragged sits exactly under the pointer, snapped to the quarter hour. After the drop the
  // block stays where it was released (`dropped`) until the refreshed day arrives, so it never
  // snaps back to the old time while the save is in flight.
  const [drag, setDrag] = useState<{ id: string; minute: number; dropped?: boolean } | null>(null);
  const baseStarts = chapters.map((c) => (c.start ? minutesOfDay(c.start) : minutesOfDay(c.nominal)));
  const starts = baseStarts.map((m, i) => (drag && chapters[i].chapter_id === drag.id ? drag.minute : m));

  // The drop minute is read from the pointer-up event itself (React state can lag one move
  // behind), and listeners are bound once per drag.
  const dragId = drag && !drag.dropped ? drag.id : null;
  useEffect(() => {
    if (!dragId) return;
    const minuteAt = (clientY: number) => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return snapMinute(((clientY - rect.top) / rect.height) * 1440);
    };
    const move = (e: PointerEvent) => {
      const m = minuteAt(e.clientY);
      if (m != null) setDrag((x) => (x && x.minute !== m ? { ...x, minute: m } : x));
    };
    const up = (e: PointerEvent) => {
      const c = chapters.find((x) => x.chapter_id === dragId);
      const orig = c ? baseStarts[chapters.indexOf(c)] : null;
      const m = minuteAt(e.clientY);
      if (c && orig !== null && m != null && m !== orig) {
        props.onMoveStart?.(c, m);
        setDrag({ id: dragId, minute: m, dropped: true });
      } else setDrag(null);
    };
    const cancel = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId]);
  // The refreshed day carries the new start: let go of the dropped position.
  useEffect(() => setDrag((x) => (x?.dropped ? null : x)), [d]);

  const isToday = props.now ? props.now.slice(0, 10) === d.date : false;
  const nowMin = isToday && props.now ? minutesOfDay(props.now) : null;
  const sr = d.sunrise ? minutesOfDay(d.sunrise) : null;
  const ss = d.sunset ? minutesOfDay(d.sunset) : null;

  const ctxFromEvent = (e: React.MouseEvent<HTMLElement>, chapter: ResolvedChapter | null) => {
    if (!props.onContext) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (hostRef.current ?? e.currentTarget).getBoundingClientRect();
    const minute = snapMinute(((e.clientY - rect.top) / rect.height) * 1440);
    props.onContext({ minute, chapter, x: e.clientX, y: e.clientY });
  };

  const tone = d.occupied === false ? "vacant" : d.detached ? "own" : "following";
  const todayCls = isToday ? "today" : "";
  const enabledStarts = chapters.map((c, i) => (c.enabled && c.start ? starts[i] : null)).filter((m): m is number => m !== null);
  const firstStart = enabledStarts.length ? Math.min(...enabledStarts) : 1440;

  // A chapter shorter than one readable line is drawn MIN_PX tall anyway, over the start of the
  // following block, which pads its text down past the overlap so neither covers the other. Edges
  // stay at their true times, so dragging and the hour grid are unaffected.
  const ppm = (props.hourH ?? 44) / 60; // px per minute
  const MIN_PX = 20;
  const layout: Record<number, { h: number; cover: number; over: boolean }> = {};
  let prevBottom = -Infinity; // px below 00:00 where the block drawn above this one ends
  const order = chapters.map((_, i) => i).filter((i) => chapters[i].enabled).sort((a, b) => starts[a] - starts[b]);
  order.forEach((i, k) => {
    const e = k + 1 < order.length ? starts[order[k + 1]] : 1440;
    const top = starts[i] * ppm + 1;
    const real = (e - starts[i]) * ppm - 3;
    const h = Math.max(MIN_PX, real);
    // Never pad the text clean out of the block: a covered block keeps at least one line of room.
    const cover = Math.min(Math.max(0, prevBottom - top), Math.max(0, h - MIN_PX));
    layout[i] = { h, cover, over: h > real };
    prevBottom = Math.max(prevBottom, top + h);
  });

  return (
    <div ref={hostRef} className={["daycol", tone, todayCls, dragId ? "dragging" : "", props.className ?? ""].join(" ")} onContextMenu={(e) => ctxFromEvent(e, null)}>
      {Array.from({ length: 96 }, (_, q) => (
        <div key={q} className={"hline" + (q % 4 ? " q" : "")} style={{ top: pct(q * 15) + "%" }} />
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
        return (
          <div className={"block ghost " + (co.chapter_id === props.currentId ? "current" : "")} style={{ top: 0, height: `calc(${pct(end)}% - 3px)`, ...chapterVars(co.color) }} title={`${co.name} — carried over from the previous day`}>
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
        const v = props.variantOf?.(c);
        const past = nowMin != null && e < nowMin;
        const held = !!c.held_by;
        const lay = layout[i];
        const room = lay.h - lay.cover; // px left for text once the block above is cleared
        const size = room >= 48 ? "tall" : room >= 26 ? "mid" : "tiny";
        const cls = ["block", size, lay.over ? "over" : "", c.chapter_id === props.currentId ? "current" : "", c.pending_condition ? "cond" : "", held ? "held" : "", past ? "dim" : ""].join(" ");
        const startText = held ? `waiting — held by ${c.held_by}` : c.start ? hhmm(s) : c.start_entity ? `waiting for ${c.start_entity} (hard start ${hhmm(s)})` : "waiting (" + hhmm(s) + ")";
        const holdText = c.hold ? `\nHolds while ${c.hold.label ?? c.hold.entity_id} is ${c.hold.while_state}${c.hold.latest ? ` (until ${c.hold.latest})` : ""}` : "";
        const hasMusic = (c.music ?? []).length > 0;
        const timeText = drag?.id === c.chapter_id ? hhmm(drag.minute) : c.pending_condition ? "~" + hhmm(s) : hhmm(s);
        return (
          <div
            key={c.chapter_id + i}
            className={cls}
            style={{ top: `calc(${pct(s)}% + 1px)`, height: lay.h, paddingTop: lay.cover ? `calc(var(--pad-y) + ${lay.cover}px)` : undefined, ...chapterVars(c.color) }}
            title={`${c.name} — ${startText}${holdText}${c.note ? "\n" + c.note : ""}`}
            onClick={() => props.onChapter?.(c)}
            onContextMenu={(ev) => ctxFromEvent(ev, c)}
          >
            {props.onMoveStart && c.kind === "clock" ? (
              <div
                className={"grip" + (dragId === c.chapter_id ? " active" : "")}
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
            <div className="n">
              <span className="name">{c.name}</span>
              {held ? <span className="mk" title={`held by ${c.held_by}`}>⏸</span> : null}
              {hasMusic ? <span className="mk" title="Music on this chapter">♫</span> : null}
              {size !== "tall" ? <span className="t inline">{timeText}</span> : null}
            </div>
            {size === "tall" ? (
              <div className="t">
                {timeText}
                {v ? <span className="v"> · {v}</span> : null}
              </div>
            ) : null}
            {c.hold ? <div className="holdmark" /> : null}
            {props.onMoveStart && next && next.kind === "clock" ? (
              <div
                className={"grip bottom" + (dragId === next.chapter_id ? " active" : "")}
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
      {nowMin != null && props.playhead !== false ? <div className="playhead" style={{ top: pct(nowMin) + "%" }} /> : null}
    </div>
  );
}
