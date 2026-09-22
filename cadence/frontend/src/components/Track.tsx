import { hhmm, minutesOfDay } from "../api";
import type { CalendarEvent, ResolvedChapter, TimeWindow } from "../types";
import { chapterColor } from "./ui";

/** A 24-hour horizontal track of resolved chapters, optionally with sun shading, auto windows and events. */
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
  hours?: boolean;
}) {
  const pct = (m: number) => (Math.max(0, Math.min(1440, m)) / 1440) * 100;
  const starts = props.chapters.map((c) => (c.start ? minutesOfDay(c.start) : minutesOfDay(c.nominal)));
  const isToday = props.now ? props.now.slice(0, 10) === props.date : false;
  const nowMin = isToday && props.now ? minutesOfDay(props.now) : null;
  const sr = props.sunrise ? minutesOfDay(props.sunrise) : null;
  const ss = props.sunset ? minutesOfDay(props.sunset) : null;
  return (
    <div className="track">
      {sr != null && ss != null ? (
        <>
          <div className="night" style={{ left: 0, width: pct(sr) + "%" }} />
          <div className="night" style={{ left: pct(ss) + "%", right: 0 }} />
        </>
      ) : null}
      {props.hours !== false
        ? Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="hour" style={{ left: pct(h * 60) + "%" }}>
              {h % 3 === 0 ? <span>{String(h).padStart(2, "0")}</span> : null}
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
        const cls = ["block", c.chapter_id === props.currentId ? "current" : "", c.pending_condition ? "cond" : "", past ? "dim" : ""].join(" ");
        const fadeW = c.fade_minutes > 0 ? Math.min(100, (c.fade_minutes / Math.max(1, e - s)) * 100) : 0;
        return (
          <div
            key={c.chapter_id + i}
            className={cls}
            style={{ left: pct(s) + "%", width: Math.max(0.6, pct(e - s)) + "%", ["--c-fill" as string]: col.fill, ["--c-line" as string]: col.line }}
            title={`${c.name} — ${c.start ? hhmm(s) : "waiting (" + hhmm(s) + ")"}${c.note ? "\n" + c.note : ""}`}
            onClick={() => props.onChapter?.(c)}
          >
            {fadeW > 0 ? <div className="fade" style={{ width: fadeW + "%" }} /> : null}
            {c.name}
            {v ? <span className="v">{v}</span> : null}
          </div>
        );
      })}
      {nowMin != null ? <div className="playhead" style={{ left: pct(nowMin) + "%" }} /> : null}
    </div>
  );
}
