import { useEffect, useMemo, useRef, useState } from "react";
import { api, fmtTime, hhmm, minutesOfDay, type useLive } from "../api";
import daylightImg from "../assets/daylight.jpg";
import nightImg from "../assets/night.jpg";
import { SKY_LABEL, chapterColor, toast } from "../components/ui";
import type { ResolvedChapter } from "../types";
import "./tablet.css";

type Live = ReturnType<typeof useLive>;

// Where each zone glows on the 1400×665 building photo (percentages).
const ZONES: { id: string; glows: { x: number; y: number; rx: number; ry: number }[]; spill?: number; low?: boolean }[] = [
  { id: "cupola", glows: [{ x: 64.6, y: 18.5, rx: 5.5, ry: 3.2 }] },
  { id: "clerestory", glows: [{ x: 55.0, y: 30.0, rx: 9.5, ry: 3.2 }, { x: 85.0, y: 25.0, rx: 12.5, ry: 4.6 }] },
  { id: "dormer", glows: [{ x: 68.3, y: 34.0, rx: 3.2, ry: 4.2 }] },
  { id: "greatroom", glows: [{ x: 48.5, y: 54.0, rx: 11.5, ry: 8.5 }] },
  { id: "porch", glows: [{ x: 37.5, y: 56.0, rx: 6.5, ry: 6.0 }, { x: 60.5, y: 61.0, rx: 6.0, ry: 4.5 }], spill: 0.35 },
  { id: "eastwing", glows: [{ x: 86.0, y: 58.5, rx: 7.5, ry: 6.5 }, { x: 95.0, y: 58.0, rx: 4.0, ry: 5.0 }], spill: 0.3 },
  { id: "lamps", glows: [{ x: 33.5, y: 45.0, rx: 3.0, ry: 5.5 }, { x: 1.1, y: 49.0, rx: 1.6, ry: 3.2 }], spill: 0.8 },
  { id: "path", glows: [{ x: 25.0, y: 60.0, rx: 12.0, ry: 4.5 }, { x: 70.0, y: 64.0, rx: 26.0, ry: 4.5 }], spill: 0.45, low: true },
];

const smooth = (p: number) => {
  p = Math.max(0, Math.min(1, p));
  return p * p * (3 - 2 * p);
};

/** 0 = night, 1 = full day, from real sunrise/sunset. */
function daylightAt(nowMin: number, sunrise: number | null, sunset: number | null): number {
  if (sunrise == null || sunset == null) return nowMin > 420 && nowMin < 1140 ? 1 : 0;
  const dawn = sunrise - 32;
  if (nowMin < dawn) return 0;
  if (nowMin < sunrise) return smooth((nowMin - dawn) / 32) * 0.55;
  if (nowMin < sunrise + 75) return 0.55 + smooth((nowMin - sunrise) / 75) * 0.45;
  if (nowMin < sunset - 60) return 1;
  if (nowMin < sunset) return 1 - smooth((nowMin - (sunset - 60)) / 60) * 0.45;
  if (nowMin < sunset + 45) return 0.55 - smooth((nowMin - sunset) / 45) * 0.55;
  return 0;
}

export function Tablet({ live, query }: { live: Live; query: URLSearchParams }) {
  const st = live.status;
  const [tick, setTick] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setTick(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const [viewHours, setViewHours] = useState<number>(() => {
    const q = parseFloat(query.get("view") ?? "");
    if (!Number.isNaN(q)) return Math.max(1, Math.min(24, q));
    const saved = parseFloat(localStorage.getItem("cadence.tablet.view") ?? "");
    return Number.isNaN(saved) ? 6 : saved;
  });
  useEffect(() => localStorage.setItem("cadence.tablet.view", String(viewHours)), [viewHours]);
  const [open, setOpen] = useState<ResolvedChapter | null>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number; caret: number } | null>(null);
  const [follow, setFollow] = useState(true);
  const [menu, setMenu] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);

  const nowMin = tick.getHours() * 60 + tick.getMinutes() + tick.getSeconds() / 60;
  const sunrise = st?.sun.sunrise ? minutesOfDay(st.sun.sunrise) : null;
  const sunset = st?.sun.sunset ? minutesOfDay(st.sun.sunset) : null;
  const daylight = daylightAt(nowMin, sunrise, sunset);

  // ----- timeline geometry
  const PAD = 400;
  const [vw, setVw] = useState(800);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVw(el.clientWidth || 800));
    ro.observe(el);
    setVw(el.clientWidth || 800);
    return () => ro.disconnect();
  }, []);
  const W = (vw * 24) / viewHours; // px for 24h
  const x = (m: number) => PAD + (m / 1440) * W;

  // follow the playhead
  useEffect(() => {
    if (!follow || !scroller.current) return;
    programmatic.current = true;
    scroller.current.scrollLeft = x(nowMin) - vw / 2;
    const id = window.setTimeout(() => (programmatic.current = false), 50);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(nowMin * 4), follow, W, vw]);

  const chapters = st?.timeline ?? [];
  const starts = useMemo(() => chapters.map((c) => (c.start ? minutesOfDay(c.start) : minutesOfDay(c.nominal))), [chapters]);

  const applyChapter = async (c: ResolvedChapter, variant?: string) => {
    try {
      await api.post("api/engine/apply", { chapter_id: c.chapter_id, variant_key: variant ?? null });
      toast(`Applied ${c.name}${variant ? " · " + variant : ""}`);
      setOpen(null);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const release = async () => {
    try {
      await api.post("api/engine/hold/release");
      toast("Resuming the schedule");
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const openChapter = (c: ResolvedChapter, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const width = 340;
    let left = r.left + r.width / 2 - width / 2;
    left = Math.max(16, Math.min(window.innerWidth - width - 16, left));
    const caret = Math.max(20, Math.min(width - 32, r.left + r.width / 2 - left - 6));
    setPopPos({ left, top: r.top - 12, caret });
    setOpen(open?.chapter_id === c.chapter_id ? null : c);
  };

  // ruler ticks
  const labelEvery = viewHours <= 2 ? 30 : viewHours <= 8 ? 60 : viewHours <= 14 ? 120 : 180;
  const mid = viewHours <= 2 ? 15 : viewHours <= 8 ? 30 : 60;
  const minor = viewHours <= 2 ? 5 : viewHours <= 8 ? 15 : 30;
  const ticks: number[] = [];
  for (let t = 0; t <= 1440; t += minor) ticks.push(t);

  const chip = st ? (st.hold.active ? { cls: "warn", text: "Holding" } : st.auto_active ? { cls: "auto", text: st.dry_run ? "Auto · dry run" : "Auto" } : { cls: "", text: "Manual" }) : null;

  return (
    <div className="tv">
      <div className="photo">
        <div className="stage">
          <div className="layer night" style={{ backgroundImage: `url(${nightImg})` }} />
          <div className="layer daylight" style={{ backgroundImage: `url(${daylightImg})`, opacity: daylight, filter: `saturate(${0.8 + daylight * 0.2})` }} />
          {ZONES.map((z) => {
            const level = (live.zones[z.id] ?? st?.zones[z.id] ?? 0) / 100;
            const mask = z.glows.map((g) => `radial-gradient(ellipse ${g.rx}% ${g.ry}% at ${g.x}% ${g.y}%, #000 0%, #000 45%, transparent 100%)`).join(",");
            const amt = z.spill ?? 0.14;
            const spill = z.glows
              .map((g) => `radial-gradient(ellipse ${g.rx * 2.6}% ${g.ry * (z.low ? 2.2 : 3.2)}% at ${g.x}% ${g.y + (z.low ? 1.5 : 0)}%, rgba(255,190,110,${amt}) 0%, rgba(255,170,90,${amt * 0.45}) 40%, rgba(255,150,70,0) 100%)`)
              .join(",");
            // Glows read against the night photo; by day the lit interior is already visible.
            const vis = level * (1 - daylight * 0.85);
            return (
              <span key={z.id}>
                <div className="layer reveal" style={{ backgroundImage: `url(${daylightImg})`, WebkitMaskImage: mask, maskImage: mask, opacity: vis }} />
                <div className="layer spill" style={{ backgroundImage: spill, opacity: vis }} />
              </span>
            );
          })}
        </div>
        <div className="vignette" />
        <header className="hud-top">
          <div className="now">
            <div className="eyebrow">
              Now {chip ? <span className={"tchip " + (chip.cls === "auto" ? "live" : chip.cls)}>{chip.text}</span> : null}
              {st?.variant ? <span className="tchip">{st.variant.label}</span> : null}
            </div>
            <h1 className="name">{st ? st.chapter?.name ?? "Nothing scheduled" : "Connecting…"}</h1>
            <div className="next">
              {st?.next_chapter ? (
                <>
                  Next <b>{st.next_chapter.pending_condition ? `waiting for ${st.next_chapter.kind}` : fmtTime(st.next_chapter.at)}</b> {st.next_chapter.name}
                </>
              ) : null}
              {st?.hold.active ? <div className="tdanger">Changed by hand · resumes {st.hold.until ? fmtTime(st.hold.until) : "at the next chapter"}</div> : null}
            </div>
          </div>
          <div className="clock">
            <div className="time">
              <span>{hhmm(nowMin)}</span>
              <small className="mono">:{String(tick.getSeconds()).padStart(2, "0")}</small>
            </div>
            <div className="sun">
              <span className={"live-dot" + (live.connected && st?.ha_connected ? "" : " off")} />
              {live.connected ? (st?.ha_connected ? "Live" : "Home Assistant offline") : "Reconnecting"} &nbsp;·&nbsp; Sunrise <b>{fmtTime(st?.sun.sunrise)}</b> · Sunset <b>{fmtTime(st?.sun.sunset)}</b>
            </div>
          </div>
        </header>
      </div>

      <div className="outside">
        <span className="tpill" title={st?.sky.reason}>
          <span className="k">Sky</span>
          <span className="v">{st?.sky.state ? SKY_LABEL[st.sky.state] : "—"}</span>
        </span>
        <span className={"tpill" + (st?.motion.active ? " on" : "")}>
          <span className="k">Motion</span>
          <span className="v">{st?.motion.active == null ? "—" : st.motion.active ? "Movement" : "Quiet"}</span>
        </span>
        {st?.sky.lux != null ? (
          <span className="tpill">
            <span className="k">Lux</span>
            <span className="v mono">{Math.round(st.sky.lux)}</span>
          </span>
        ) : null}
        {st?.fading.length ? (
          <span className="tpill">
            <span className="v">Fading…</span>
          </span>
        ) : null}
        {st?.hold.active ? (
          <button className="tpill action" onClick={release}>
            Resume schedule
          </button>
        ) : null}
        {!follow ? (
          <button className="tpill action" onClick={() => setFollow(true)}>
            Back to now
          </button>
        ) : null}
      </div>
      <div className="controls">
        <div style={{ position: "relative" }}>
          <button className="tpill ghost mono" onClick={() => setMenu(!menu)}>
            {viewHours >= 24 ? "Whole day" : `${viewHours} h`}
          </button>
          {menu ? (
            <div className="tmenu">
              <div className="eyebrow" style={{ padding: "6px 10px 2px" }}>
                Timeline shows
              </div>
              {[3, 6, 12, 24].map((h) => (
                <button
                  key={h}
                  className="tmenu-item"
                  style={{ color: viewHours === h ? "var(--lamp-2)" : undefined }}
                  onClick={() => {
                    setViewHours(h);
                    setMenu(false);
                    setFollow(true);
                  }}
                >
                  {h === 24 ? "Whole day" : `${h} hours`}
                </button>
              ))}
              <hr className="tsep" />
              <a className="tmenu-item" href="#/now" target="_blank" rel="noreferrer">
                Open the planner
              </a>
            </div>
          ) : null}
        </div>
      </div>

      <section className="timeline">
        <div
          className="scroller"
          ref={scroller}
          onScroll={() => {
            if (!programmatic.current) setFollow(false);
          }}
        >
          <div className="ttrack" style={{ width: W + PAD * 2 }}>
            <div className="ruler">
              {ticks.map((t) => {
                const isLabel = t % labelEvery === 0;
                const isMid = t % mid === 0;
                return (
                  <div key={t} className={"tick" + (isLabel || isMid ? "" : " minor")} style={{ left: x(t) }}>
                    {isLabel ? <span>{hhmm(t)}</span> : null}
                  </div>
                );
              })}
            </div>
            <div className="chapters">
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
                const isCur = st?.chapter?.id === c.chapter_id;
                const past = e < nowMin && !isCur;
                const w = Math.max(6, x(e) - x(s));
                const fadeW = c.fade_minutes > 0 ? Math.min(w, (c.fade_minutes / 1440) * W) : 0;
                const variantText = isCur ? st?.variant?.label : c.forced_variant ? c.forced_variant : c.variants.length > 1 ? "auto" : "";
                return (
                  <div
                    key={c.chapter_id + i}
                    className={["chapter", isCur ? "current" : "", past ? "past" : "", c.pending_condition ? "cond" : "", open?.chapter_id === c.chapter_id ? "open" : ""].join(" ")}
                    style={{ left: x(s), width: w, ["--c-fill" as string]: col.fill, ["--c-line" as string]: col.line }}
                    onClick={(ev) => openChapter(c, ev.currentTarget)}
                  >
                    {fadeW > 0 ? <div className="fade" style={{ width: fadeW }} /> : null}
                    <div className="label">{c.name}</div>
                    <div className="meta">
                      {c.start ? hhmm(s) : `~${hhmm(s)} · ${c.kind}`}
                      {variantText ? <span className="var"> · {variantText}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="playhead" style={{ left: x(nowMin) }}>
              <span className="flag">{hhmm(nowMin)}</span>
            </div>
          </div>
        </div>
      </section>

      {open && popPos ? (
        <div className="pop" style={{ left: popPos.left, top: popPos.top, transform: "translateY(-100%)", ["--caret" as string]: popPos.caret + "px" }}>
          <div className="title">{open.name}</div>
          <div className="when">
            <span>
              Starts <b>{open.start ? fmtTime(open.start) : `when ${open.kind} (from ${hhmm(minutesOfDay(open.nominal))})`}</b>
            </span>
            {open.fade_minutes ? <span style={{ color: "var(--text-2)" }}>{open.fade_minutes} min fade</span> : null}
          </div>
          {open.note ? <p className="note">{open.note}</p> : null}
          {open.variants.length ? (
            <div className="variants">
              {open.variants.map((v) => (
                <button key={v.key} className={"tvbtn" + (st?.chapter?.id === open.chapter_id && st?.variant?.key === v.key ? " active" : "")} onClick={() => applyChapter(open, v.key)}>
                  {v.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="actions">
            <button className="tbtn primary" onClick={() => applyChapter(open)}>
              {st?.chapter?.id === open.chapter_id ? "Re-apply now" : "Start this chapter now"}
            </button>
            <button className="tbtn" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {!st ? (
        <div className="lock">
          <div className="big">Cadence</div>
          <div style={{ color: "var(--text-2)" }}>{live.connected ? "Waiting for the engine…" : "Connecting…"}</div>
        </div>
      ) : null}
    </div>
  );
}
