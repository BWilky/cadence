/**
 * cadence-card — Cadence auto mode for tablets and phones
 * ---------------------------------------------------------------------------
 * Shows what Cadence is doing with the building: whether auto mode is driving
 * it (and why), the current chapter and variant, what comes next, a hand-made
 * hold, and the whole day as a ribbon with the auto-mode band underneath.
 *
 *   Tablets / desktop (>= 768 px): centred dialog with a sidebar.
 *     Now · Today · This screen, plus template / sky / occupancy at the bottom.
 *   Phones (< 768 px): bottom sheet, grabber + swipe down to close.
 *     Now / Today switch at the top, gear for this phone's pop-up settings,
 *     chapters open a sub-sheet to start them or pick a variant.
 *
 * Open it from anywhere:
 *   - Tile:   type: custom:cadence-card      (tile look, optional day ribbon)
 *   - Hash:   #cadence  #cadence-today  #cadence-screen  (#pop-up-cadence too)
 *             e.g. any tile/button with tap_action: navigate, navigation_path: "#cadence"
 *   - JS:     window.openCadenceSheet({ tab: "today" })
 *             window.dispatchEvent(new CustomEvent("cadence-sheet-open", { detail: { tab: "now" } }))
 *             (browser_mod.javascript can call this on chosen browsers)
 *
 * Pop-up triggers (per screen, set under "This screen"; a card's `popup:`
 * config sets the defaults for screens that show it):
 *   ask      Home Assistant asks: event cadence_command {command: show, tab, screens}
 *            or a press/change of `trigger_entity` (e.g. input_button.cadence_show)
 *   auto     auto mode turns on or off
 *   hold     someone changes the lights by hand and Cadence holds
 *   chapter  a new chapter starts
 *   Defaults: tablets ask + auto + hold, phones ask only. Pop-ups close after
 *   2 min (tablets) / 1 min (phones) without a touch.
 *
 * Data: sensor.cadence_status, published by the Cadence app (0.5.0+), so every
 * account can read it. Admins on an older Cadence fall back to the app's
 * ingress API. Commands go through script.cadence_command when it exists
 * (works for every account), else straight to the cadence_command event
 * (admins), or the ingress API.
 *
 * Source: https://github.com/bwilky/cadence (card/). Added 26 Oct 2026.
 */
(async () => {
  if (window.__cadenceCard) return;
  window.__cadenceCard = true;

  await Promise.race([
    customElements.whenDefined("ha-panel-lovelace"),
    customElements.whenDefined("hc-lovelace"),
  ]);
  const Base = Object.getPrototypeOf(
    customElements.get("ha-panel-lovelace") || customElements.get("hc-lovelace")
  );
  const html = Base.prototype.html;
  const css = Base.prototype.css;

  const VERSION = "1.0.0";
  const DEF = {
    entity: "sensor.cadence_status",
    script: "script.cadence_command",
    event: "cadence_command",
    triggerEntity: "input_button.cadence_show",
  };
  const TABS = ["now", "today", "screen"];
  const DEAD = ["unavailable", "unknown"];
  const DIALOG_QUERY = "(min-width: 768px)"; // same switch point as the station sheets
  const isDialog = () => window.matchMedia(DIALOG_QUERY).matches;
  const isTablet = () => Math.min(window.screen.width, window.screen.height) >= 600;
  const PALETTE = ["#f2b24a", "#6fa8dc", "#93c47d", "#e06666", "#8e7cc3", "#f6b26b", "#76a5af", "#c27ba0"];
  const STATE_COLOR = { auto: "var(--cad-auto)", hold: "var(--cad-hold)", off: "var(--cad-off)", idle: "var(--cad-idle)" };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };
  const TAB_KEY = "cadence-card:tab";
  const POP_KEY = "cadence-card:popup";

  const getHass = () => document.querySelector("home-assistant")?.hass;
  const inApp = () => !!(window.externalApp || window.webkit?.messageHandlers?.externalBus);
  const haptic = (type = "light") => {
    const e = new Event("haptic", { bubbles: true, composed: true });
    e.detail = type;
    window.dispatchEvent(e);
    if (!inApp() && navigator.vibrate) {
      try { navigator.vibrate(["heavy", "warning", "failure"].includes(type) ? [18, 40, 18] : type === "selection" ? 5 : 10); } catch (err) { /* ignore */ }
    }
  };

  /* ---------- time helpers (everything in Home Assistant's time zone) ---------- */
  const tzOf = (hass) => hass?.config?.time_zone || undefined;
  const fmtT = (hass, iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    try { return d.toLocaleTimeString(hass?.locale?.language || [], { hour: "numeric", minute: "2-digit", timeZone: tzOf(hass) }); }
    catch (e) { return String(iso).slice(11, 16); }
  };
  const fmtHHMM = (hass, hhmm) => {
    const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})/);
    if (!m) return "";
    const d = new Date(2000, 0, 1, +m[1], +m[2]);
    try { return d.toLocaleTimeString(hass?.locale?.language || [], { hour: "numeric", minute: "2-digit" }); }
    catch (e) { return `${m[1]}:${m[2]}`; }
  };
  /* minutes since midnight of an ISO string, as wall time in its own offset (= HA's zone) */
  const minOf = (iso) => {
    const m = String(iso || "").match(/T(\d{2}):(\d{2})/);
    return m ? +m[1] * 60 + +m[2] : null;
  };
  const hhmmMin = (s) => { const m = String(s || "").match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const nowParts = (hass) => {
    try {
      const p = new Intl.DateTimeFormat("en-CA", {
        timeZone: tzOf(hass), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date());
      const g = (t) => p.find((x) => x.type === t)?.value;
      return { date: `${g("year")}-${g("month")}-${g("day")}`, min: +g("hour") * 60 + +g("minute") };
    } catch (e) {
      const d = new Date();
      return { date: d.toISOString().slice(0, 10), min: d.getHours() * 60 + d.getMinutes() };
    }
  };
  const until = (iso) => {
    const ms = Date.parse(iso) - Date.now();
    if (!isFinite(ms)) return "";
    if (ms <= 30000) return "any moment";
    const min = Math.round(ms / 60000);
    if (min < 60) return `in ${min} min`;
    const h = Math.floor(min / 60), r = min % 60;
    return r ? `in ${h} h ${r} min` : `in ${h} h`;
  };
  const since = (iso) => {
    const ms = Date.now() - Date.parse(iso);
    if (!isFinite(ms) || ms < 0) return "";
    const min = Math.round(ms / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const h = Math.floor(min / 60), r = min % 60;
    return r ? `${h} h ${r} min ago` : `${h} h ago`;
  };
  const friendly = (hass, eid) => hass?.states?.[eid]?.attributes?.friendly_name || eid;
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

  /* ---------- the model (one shape for both data sources) ---------- */
  function norm(state, a) {
    // copies: never touch Home Assistant's own state objects
    const tl = (a.timeline || []).filter((r) => r && r.enabled !== false)
      .map((r, i) => ({ ...r, color: r.color || PALETTE[i % PALETTE.length], variants: r.variants || [] }));
    return {
      state, version: a.version, date: a.date, dry_run: !!a.dry_run, ha_connected: a.ha_connected !== false,
      auto_active: !!a.auto_active, auto_reason: a.auto_reason || "", auto_override: a.auto_override || "none",
      auto_mode: a.auto_mode || "windows", auto_source: a.auto_source || null, auto_entity: a.auto_entity || null,
      auto_windows: a.auto_windows || [],
      template: a.template, template_kind: a.template_kind, template_reason: a.template_reason,
      chapter: a.chapter || null, variant: a.variant || null, scenes: a.scenes || [], next: a.next || null,
      hold: a.hold || { active: false }, chapter_hold: a.chapter_hold || null, carry_over: a.carry_over || null,
      sky: a.sky, weather: a.weather, motion: a.motion, occupied: a.occupied, asleep: a.asleep,
      sunrise: a.sunrise, sunset: a.sunset, timeline: tl, show: a.show || null,
    };
  }
  const stateOf = (s) => (!s.auto_active ? "off" : s.hold?.active ? "hold" : !s.chapter ? "idle" : "auto");

  /* ---------- fallback: the app's ingress API (admins only) ---------- */
  const Ingress = {
    status: "idle", // idle | finding | ready | failed
    url: null, slug: null, version: null, model: null, err: null,
    wantedAt: 0, timer: null, sessAt: 0, settings: null, settingsAt: 0, busy: false,
    touch(hass) {
      if (!hass?.user?.is_admin) return;
      this.wantedAt = Date.now();
      if (this.status === "idle") this.start(hass);
    },
    async start(hass) {
      this.status = "finding";
      try {
        const list = await hass.callWS({ type: "supervisor/api", endpoint: "/addons", method: "get" });
        const app = (list?.addons || []).find((a) => a.slug === "cadence" || /_cadence$/.test(a.slug) || a.name === "Cadence");
        if (!app) throw new Error("Cadence app not installed");
        const info = await hass.callWS({ type: "supervisor/api", endpoint: `/addons/${app.slug}/info`, method: "get" });
        if (!info?.ingress_url) throw new Error("Cadence ingress not available");
        if (info.state && info.state !== "started") throw new Error("Cadence app is stopped");
        this.slug = app.slug;
        this.url = info.ingress_url.endsWith("/") ? info.ingress_url : info.ingress_url + "/";
        this.version = info.version;
        this.status = "ready";
        await this.refresh(hass);
      } catch (e) {
        this.status = "failed";
        this.err = e?.message || String(e);
        console.info("[cadence-card] ingress fallback unavailable:", this.err);
        setTimeout(() => { if (this.status === "failed") this.status = "idle"; }, 120000);
        return;
      }
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        const h = getHass();
        if (!h || document.hidden || Date.now() - this.wantedAt > 60000) return;
        this.refresh(h);
      }, 15000);
    },
    async session(hass, force = false) {
      if (!force && Date.now() - this.sessAt < 5 * 60000) return;
      const r = await hass.callWS({ type: "supervisor/api", endpoint: "/ingress/session", method: "post" });
      document.cookie = `ingress_session=${r.session};path=/api/hassio_ingress/;SameSite=Strict${location.protocol === "https:" ? ";Secure" : ""}`;
      this.sessAt = Date.now();
    },
    async api(hass, path, body) {
      for (let attempt = 0; attempt < 2; attempt++) {
        await this.session(hass, attempt > 0);
        const res = await fetch(this.url + path, body === undefined
          ? { credentials: "same-origin" }
          : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (res.ok) return res.json();
        if (attempt || ![401, 403].includes(res.status)) throw new Error(`Cadence API ${res.status}`);
      }
      return null;
    },
    async refresh(hass) {
      if (this.status !== "ready" || this.busy) return;
      this.busy = true;
      try {
        const s = await this.api(hass, "api/status");
        if (!s || !s.date) return;
        const days = await this.api(hass, `api/days?start=${s.date}&end=${s.date}`).catch(() => null);
        if (!this.settings || Date.now() - this.settingsAt > 5 * 60000) {
          this.settings = await this.api(hass, "api/settings").catch(() => this.settings);
          this.settingsAt = Date.now();
        }
        const day = (days || [])[0] || {};
        this.model = norm(stateOf(s), {
          version: this.version, date: s.date, dry_run: s.dry_run, ha_connected: s.ha_connected,
          auto_active: s.auto_active, auto_reason: s.auto_reason, auto_override: s.auto_override,
          auto_mode: day.auto_mode || "windows", auto_windows: day.auto_windows || [],
          auto_source: this.settings?.auto_source, auto_entity: this.settings?.auto_entity,
          template: s.template_name, template_kind: s.template_kind, template_reason: s.template_reason,
          chapter: s.chapter, variant: s.variant, scenes: (s.scenes || []).map((x) => x.name),
          next: s.next_chapter ? { id: s.next_chapter.id, name: s.next_chapter.name, at: s.next_chapter.at, pending: s.next_chapter.pending_condition } : null,
          hold: s.hold,
          chapter_hold: s.chapter_hold ? { chapter: s.chapter_hold.chapter_id, label: s.chapter_hold.label, until: s.chapter_hold.until } : null,
          carry_over: s.carry_over, sky: s.sky?.state, weather: s.sky?.weather, motion: s.motion?.active,
          occupied: s.occupied, asleep: s.asleep, sunrise: s.sun?.sunrise, sunset: s.sun?.sunset,
          timeline: (s.timeline || []).map((r) => ({
            id: r.chapter_id, name: r.name, color: r.color, kind: r.kind, start: r.start, nominal: r.nominal,
            pending: r.pending_condition, enabled: r.enabled, fade: r.fade_minutes, held_by: r.held_by, forced: r.forced_variant,
            variants: (r.variants || []).map((v) => ({ key: v.key, label: v.label })),
          })),
        });
        window.dispatchEvent(new Event("cadence-data"));
      } catch (e) {
        console.warn("[cadence-card] ingress refresh failed", e);
      } finally {
        this.busy = false;
      }
    },
    async command(hass, data) {
      if (data.command === "auto") {
        await this.api(hass, "api/engine/auto", { mode: data.mode === "schedule" ? "none" : data.mode });
      } else if (data.command === "resume") {
        await this.api(hass, "api/engine/hold/release", {});
      } else if (data.command === "apply") {
        await this.api(hass, "api/engine/apply", { chapter_id: data.chapter_id || null, variant_key: data.variant_key || null });
      } else if (data.command === "recompute") {
        await this.api(hass, "api/engine/recompute", {});
      }
      setTimeout(() => this.refresh(hass), 400);
    },
  };

  let entityId = DEF.entity;
  /* { m, via }: via = entity | ingress | loading | offline | missing */
  function current(hass) {
    const st = hass?.states?.[entityId];
    if (st && !DEAD.includes(st.state)) {
      if (st !== current._st) { current._st = st; current._m = norm(st.state, st.attributes || {}); }
      return { m: current._m, via: "entity" };
    }
    if (hass?.user?.is_admin) {
      Ingress.touch(hass);
      if (Ingress.model) return { m: Ingress.model, via: "ingress" };
      if (Ingress.status === "finding" || (Ingress.status === "ready" && !Ingress.model)) return { m: null, via: "loading" };
    }
    return { m: null, via: st ? "offline" : "missing" };
  }

  async function command(hass, data, via) {
    if (via === "ingress") return Ingress.command(hass, data);
    const script = DEF.script;
    if (hass.states[script]) {
      return hass.callService("script", script.split(".")[1], Object.fromEntries(Object.entries(data).filter(([, v]) => v != null && v !== "")));
    }
    return hass.callWS({ type: "fire_event", event_type: DEF.event, event_data: data });
  }

  /* ---------- words ---------- */
  const TITLES = { auto: "Running the building", hold: "Holding · changed by hand", off: "Auto mode is off", idle: "Nothing scheduled now" };
  const SHORT = { auto: "Auto", hold: "Hold", off: "Off", idle: "Idle" };
  const STATE_ICON = { auto: "mdi:robot-outline", hold: "mdi:hand-back-left-outline", off: "mdi:robot-off-outline", idle: "mdi:robot-confused-outline" };
  const SKY = {
    sunny: ["mdi:weather-sunny", "Sunny"], cloudy: ["mdi:weather-cloudy", "Cloudy"], dark: ["mdi:weather-night", "Dark"],
  };
  const KIND = {
    clock: ["mdi:clock-outline", "at a set time"], sun: ["mdi:weather-sunset", "with the sun"], motion: ["mdi:motion-sensor", "on motion"],
    asleep: ["mdi:sleep", "when the building is asleep"], sensor: ["mdi:radar", "on a sensor"],
  };

  /* Auto mode band for the day: [{a, b, kind: on | entity}] in minutes */
  function autoBand(m) {
    const full = [{ a: 0, b: 1440, kind: "on" }];
    if (m.auto_override === "on") return full;
    if (m.auto_override === "off") return [];
    if (m.auto_mode === "on") return full;
    if (m.auto_mode === "off") return [];
    if (m.auto_source === "always") return full;
    const wins = [];
    for (const w of m.auto_windows || []) {
      const s = hhmmMin(w.start), e = hhmmMin(w.end);
      if (s == null || e == null) continue;
      if (s < e) wins.push({ a: s, b: e, kind: "on" });
      else if (s === e) wins.push({ a: 0, b: 1440, kind: "on" });
      else { wins.push({ a: s, b: 1440, kind: "on" }); wins.push({ a: 0, b: e, kind: "on" }); }
    }
    if (m.auto_source === "entity") return m.auto_entity ? [{ a: 0, b: 1440, kind: "entity" }] : [];
    if (m.auto_source === "schedule" || !m.auto_entity) return wins;
    // either: the windows, and the entity can switch it on in the gaps
    wins.sort((x, y) => x.a - y.a);
    const out = [];
    let t = 0;
    for (const w of wins) {
      if (w.a > t) out.push({ a: t, b: w.a, kind: "entity" });
      out.push(w);
      t = Math.max(t, w.b);
    }
    if (t < 1440) out.push({ a: t, b: 1440, kind: "entity" });
    return out;
  }
  function windowEdge(m, nowMin) {
    const band = autoBand(m).filter((x) => x.kind === "on").sort((x, y) => x.a - y.a);
    const inside = band.find((x) => x.a <= nowMin && nowMin < x.b);
    if (inside) {
      // follow a window that wraps midnight
      const end = inside.b === 1440 && band.some((x) => x.a === 0) ? band.find((x) => x.a === 0).b : inside.b;
      return { inside: true, at: end % 1440 };
    }
    const next = band.find((x) => x.a > nowMin) || band[0];
    return { inside: false, at: next ? next.a : null };
  }
  const minLabel = (hass, min) => (min == null ? "" : fmtHHMM(hass, `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`));
  function reasonText(hass, m) {
    const r = m.auto_reason || "";
    const now = nowParts(hass).min;
    if (/^manual override: on/.test(r)) return "Turned on for today";
    if (/^manual override: off/.test(r)) return "Turned off for today";
    if (r === "day plan: auto on") return "On all day (day plan)";
    if (r === "day plan: auto off") return "Off today (day plan)";
    if (r === "always on") return "Always on";
    if (r === "schedule window") {
      const e = windowEdge(m, now);
      return e.inside && e.at && e.at !== now ? `In the schedule until ${minLabel(hass, e.at)}` : "In the schedule window";
    }
    if (r.startsWith("outside schedule")) {
      const e = windowEdge(m, now);
      const ent = m.auto_entity ? ` · ${friendly(hass, m.auto_entity)} off` : "";
      return (e.at != null && !e.inside ? `Outside the schedule · back at ${minLabel(hass, e.at)}` : "Outside the schedule") + ent;
    }
    const em = r.match(/^(\S+\.\S+) is (on|off)$/);
    if (em) return `${friendly(hass, em[1])} is ${em[2]}`;
    if (r === "no schedule or entity configured") return "No schedule or auto entity set up";
    return cap(r);
  }
  function holdText(hass, m) {
    if (m.hold?.until) return `Resumes at ${fmtT(hass, m.hold.until)}`;
    return m.next ? `Resumes when ${m.next.name} starts${m.next.at && !m.next.pending ? ` · ${fmtT(hass, m.next.at)}` : ""}` : "Resumes at the next chapter";
  }
  function nextText(hass, m) {
    const n = m.next;
    if (!n) return "";
    const ch = m.timeline.find((r) => r.id === n.id);
    if (n.pending) {
      const k = ch?.kind;
      return k === "motion" ? "waiting for motion" : k === "asleep" ? "when the building falls asleep" : k === "sensor" ? "waiting for its sensor" : "waiting";
    }
    return n.at ? `${fmtT(hass, n.at)} · ${until(n.at)}` : "";
  }

  /* ---------- pop-up preferences (per screen) ---------- */
  const POP_DEFAULTS = { tablet: { ask: true, auto: true, hold: true, chapter: false }, phone: { ask: true, auto: false, hold: false, chapter: false } };
  let cardPopup = null; // defaults from a card's `popup:` config on this dashboard
  const popOwn = () => { try { return JSON.parse(store.get(POP_KEY) || "{}") || {}; } catch (e) { return {}; } };
  const popPrefs = () => ({ ...POP_DEFAULTS[isTablet() ? "tablet" : "phone"], ...(cardPopup || {}), ...popOwn() });
  const setPop = (k, v) => { const o = popOwn(); o[k] = v; store.set(POP_KEY, JSON.stringify(o)); };

  const THEME_VARS = [
    "--primary-text-color", "--secondary-text-color", "--primary-color", "--accent-color",
    "--card-background-color", "--ha-card-background", "--secondary-background-color",
    "--divider-color", "--rgb-primary-text-color", "--rgb-primary-color", "--disabled-color",
    "--ha-card-border-radius", "--ha-card-border-color", "--ha-card-border-width", "--ha-card-box-shadow",
    "--error-color", "--success-color", "--warning-color", "--amber-color", "--orange-color", "--state-icon-color",
  ];
  const applyTheme = (el, src) => {
    if (!el || !src) return;
    const cs = getComputedStyle(src);
    THEME_VARS.forEach((v) => {
      const val = cs.getPropertyValue(v);
      if (val && val.trim()) el.style.setProperty(v, val.trim());
      else el.style.removeProperty(v);
    });
    el.style.fontFamily = cs.fontFamily;
  };
  const themeSig = (h) => (h?.themes ? `${h.themes.theme}|${h.themes.darkMode}` : "");

  /* ---------- shared styles ---------- */
  const shared = css`
    :host {
      --cad-auto: var(--success-color, #43a047);
      --cad-hold: var(--orange-color, #ff9800);
      --cad-off: var(--disabled-color, #8a8a8a);
      --cad-idle: #7d8ea3;
      --soft: rgba(var(--rgb-primary-text-color, 225, 225, 225), 0.07);
      --soft2: rgba(var(--rgb-primary-text-color, 225, 225, 225), 0.12);
      --accent: var(--primary-color, #03a9f4);
      --warn: var(--warning-color, #ffa600);
      -webkit-tap-highlight-color: transparent;
    }
    * { box-sizing: border-box; }
    button { font: inherit; color: inherit; -webkit-tap-highlight-color: transparent; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500;
      background: var(--soft); color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chip ha-icon { --mdc-icon-size: 15px; }
    .chip.st { color: var(--sc); background: color-mix(in srgb, var(--sc) 15%, transparent); }
    .chip.warn { color: color-mix(in srgb, var(--warn) 70%, var(--primary-text-color)); background: color-mix(in srgb, var(--warn) 16%, transparent); }

    /* day ribbon */
    .rb { position: relative; user-select: none; -webkit-user-select: none; }
    .rb-row { position: relative; border-radius: 8px; overflow: hidden; background: var(--soft); }
    .rb-ch { height: 34px; }
    .rb-auto { height: 10px; margin-top: 4px; border-radius: 5px; }
    .rb.mini .rb-ch { height: 16px; border-radius: 5px; }
    .rb.mini .rb-auto { height: 5px; margin-top: 3px; border-radius: 3px; }
    .night { position: absolute; top: 0; bottom: 0; background: rgba(0, 0, 0, 0.16); pointer-events: none; }
    .blk { position: absolute; top: 0; bottom: 0; display: flex; align-items: center; overflow: hidden; padding: 0 6px;
      background: color-mix(in srgb, var(--c) 30%, transparent); border-left: 2px solid var(--c); font-size: 11px; font-weight: 600;
      color: color-mix(in srgb, var(--c) 55%, var(--primary-text-color)); white-space: nowrap; cursor: pointer; }
    .blk.cur { background: color-mix(in srgb, var(--c) 52%, transparent); }
    .blk.wait { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--c) 22%, transparent) 0 5px, transparent 5px 10px); }
    .blk.past { opacity: 0.55; }
    .rb.mini .blk { padding: 0; font-size: 0; cursor: inherit; }
    .band { position: absolute; top: 0; bottom: 0; background: var(--cad-auto); opacity: 0.85; }
    .band.entity { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--cad-auto) 70%, transparent) 0 3px, transparent 3px 7px); opacity: 1; }
    .rb.off .band { background: var(--cad-off); opacity: 0.5; }
    .rb.off .band.entity { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--cad-off) 60%, transparent) 0 3px, transparent 3px 7px); }
    .now { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: var(--primary-text-color); border-radius: 1px;
      pointer-events: none; box-shadow: 0 0 0 1px var(--bg, var(--card-background-color, #1c1c1c)); }
    .now::before { content: ""; position: absolute; top: -3px; left: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--primary-text-color); }
    .rb.mini .now { top: -2px; bottom: -2px; }
    .rb.mini .now::before { display: none; }
    .hours { position: relative; height: 16px; margin-top: 6px; font-size: 11px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
    .hours span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
    .hours span:first-child { transform: none; }
    .hours span:last-child { transform: translateX(-100%); }
    .sun { position: absolute; top: -1px; display: flex; align-items: center; gap: 2px; transform: translateX(-50%); }
    .sun ha-icon { --mdc-icon-size: 13px; color: var(--amber-color, #ffc107); }
    .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; font-size: 11px; color: var(--secondary-text-color); }
    .legend i { display: inline-block; width: 14px; height: 6px; border-radius: 3px; margin-right: 5px; vertical-align: middle; background: var(--cad-auto); }
    .legend i.entity { background: repeating-linear-gradient(135deg, var(--cad-auto) 0 3px, transparent 3px 6px); }
    .legend i.none { background: var(--soft2); }
  `;

  /* Draw the day: chapters on top, auto-mode band underneath, sun and now */
  function ribbon(hass, m, { mini = false, onPick } = {}) {
    const now = nowParts(hass);
    const today = now.date === m.date;
    const nowMin = today ? now.min : null;
    const pct = (min) => `${(Math.max(0, Math.min(1440, min)) / 1440) * 100}%`;
    const rows = m.timeline
      .map((r) => ({ r, a: minOf(r.start || r.nominal) }))
      .filter((x) => x.a != null)
      .sort((x, y) => x.a - y.a);
    const blocks = rows.map((x, i) => ({ ...x, b: i + 1 < rows.length ? rows[i + 1].a : 1440 })).filter((x) => x.b > x.a);
    const sr = minOf(m.sunrise), ss = minOf(m.sunset);
    const band = autoBand(m);
    const nearSun = (min) => [sr, ss].some((x) => x != null && Math.abs(x - min) < 80);
    const hours = mini ? [] : [0, 6, 12, 18, 24].filter((h) => h === 0 || h === 24 || !nearSun(h * 60));
    return html`
      <div class="rb ${mini ? "mini" : ""} ${m.auto_active ? "" : "off"}" role="img"
        aria-label=${`Today: ${blocks.map((x) => `${x.r.name} ${minLabel(hass, x.a)}`).join(", ")}`}>
        <div class="rb-row rb-ch">
          ${sr != null ? html`<div class="night" style="left:0;width:${pct(sr)}"></div>` : ""}
          ${ss != null ? html`<div class="night" style="left:${pct(ss)};right:0"></div>` : ""}
          ${blocks.map((x) => {
            const cur = m.chapter && m.chapter.id === x.r.id && minOf(m.chapter.start) === minOf(x.r.start);
            const past = nowMin != null && x.b <= nowMin;
            const w = ((x.b - x.a) / 1440) * 100;
            return html`<div class="blk ${cur ? "cur" : ""} ${x.r.pending ? "wait" : ""} ${past ? "past" : ""}"
              style="--c:${x.r.color};left:${pct(x.a)};width:${w}%"
              title="${x.r.name} · ${minLabel(hass, x.a)}"
              @click=${onPick ? () => onPick(x.r) : null}>${!mini && w > 7 ? x.r.name : ""}</div>`;
          })}
        </div>
        <div class="rb-row rb-auto">
          ${band.map((x) => html`<div class="band ${x.kind}" style="left:${pct(x.a)};width:${((x.b - x.a) / 1440) * 100}%"></div>`)}
        </div>
        ${nowMin != null ? html`<div class="now" style="left:${pct(nowMin)}"></div>` : ""}
        ${hours.length ? html`
          <div class="hours">
            ${hours.map((h) => html`<span style="left:${pct(h * 60)}">${h === 24 ? "" : minLabel(hass, h * 60).replace(":00", "")}</span>`)}
            ${sr != null ? html`<span class="sun" style="left:${pct(sr)}"><ha-icon icon="mdi:weather-sunset-up"></ha-icon></span>` : ""}
            ${ss != null ? html`<span class="sun" style="left:${pct(ss)}"><ha-icon icon="mdi:weather-sunset-down"></ha-icon></span>` : ""}
          </div>` : ""}
      </div>`;
  }

  /* ================================================================== */
  /* Sheet                                                               */
  /* ================================================================== */
  class CadenceSheet extends Base {
    static get properties() {
      return {
        hass: { attribute: false },
        _tab: { state: true }, _dialog: { state: true }, _closing: { state: true },
        _sheetY: { state: true }, _subY: { state: true }, _sub: { state: true }, _subClosing: { state: true },
        _confirm: { state: true }, _toastMsg: { state: true }, _pend: { state: true }, _tick: { state: true }, _reason: { state: true },
      };
    }

    constructor() {
      super();
      this._dialog = isDialog();
      const t = store.get(TAB_KEY);
      this._tab = TABS.includes(t) ? t : "now";
      if (!this._dialog && this._tab === "screen") this._tab = "now";
      this._closing = false;
      this._sheetY = 0;
      this._subY = 0;
      this._sub = null; // phone sub-sheet: { kind: "chapter", r } | { kind: "screen" }
      this._confirm = null;
      this._pend = null; // { mode, ts } optimistic auto choice
      this._tick = 0;
      this._reason = null; // why a trigger opened us
    }

    connectedCallback() {
      super.connectedCallback();
      this.setAttribute("layout", this._dialog ? "dialog" : "sheet");
      this._mq = window.matchMedia(DIALOG_QUERY);
      this._onMq = (e) => {
        this._dialog = e.matches;
        this.setAttribute("layout", this._dialog ? "dialog" : "sheet");
        if (!this._dialog && this._tab === "screen") { this._tab = "now"; this._sub = { kind: "screen" }; }
        this._sheetY = 0;
        this._subY = 0;
      };
      this._mq.addEventListener?.("change", this._onMq);
      this._hassT = setInterval(() => {
        const h = getHass();
        if (h && h !== this.hass) {
          const sig = themeSig(h);
          if (this._themeSig !== undefined && sig !== this._themeSig) {
            setTimeout(() => applyTheme(this, this._themeSrc || document.querySelector("home-assistant")), 60);
          }
          this._themeSig = sig;
          this.hass = h;
        }
      }, 250);
      this._clockT = setInterval(() => this._tick++, 20000); // keep "in 12 min" and the now line moving
      this._onData = () => this.requestUpdate();
      window.addEventListener("cadence-data", this._onData);
      this._onKey = (e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        if (this._confirm) this._cancelConfirm();
        else if (this._sub) this._closeSub();
        else this.close();
      };
      window.addEventListener("keydown", this._onKey, true);
    }

    disconnectedCallback() {
      clearInterval(this._hassT);
      clearInterval(this._clockT);
      clearTimeout(this._tt);
      window.removeEventListener("cadence-data", this._onData);
      window.removeEventListener("keydown", this._onKey, true);
      this._mq?.removeEventListener?.("change", this._onMq);
      super.disconnectedCallback();
    }

    close() {
      if (this._closing) return;
      this._closing = true;
      haptic();
      lastClosed = Date.now();
      setTimeout(() => this.remove(), 240);
    }
    openTab(tab) {
      if (!TABS.includes(tab)) return;
      if (!this._dialog && tab === "screen") { this._sub = { kind: "screen" }; return; }
      this._setTab(tab, false);
    }
    _setTab(tab, feel = true) {
      if (tab === this._tab) return;
      if (feel) haptic("selection");
      this._tab = tab;
      store.set(TAB_KEY, tab);
      this.renderRoot?.querySelector(".body")?.scrollTo?.({ top: 0 });
    }
    _openSub(sub) { haptic("light"); this._subClosing = false; this._subY = 0; this._sub = sub; }
    _closeSub() {
      if (!this._sub || this._subClosing) return;
      this._subClosing = true;
      haptic();
      setTimeout(() => { this._sub = null; this._subClosing = false; this._subY = 0; }, 220);
    }
    _toast(msg) {
      this._toastMsg = msg;
      clearTimeout(this._tt);
      this._tt = setTimeout(() => (this._toastMsg = null), 2600);
    }

    /* ---------- actions ---------- */
    _send(data, okMsg) {
      const { via } = current(this.hass);
      return Promise.resolve(command(this.hass, data, via)).then(
        () => { if (okMsg) this._toast(okMsg); return true; },
        (err) => {
          console.warn("[cadence-card]", data, err);
          this._pend = null;
          haptic("failure");
          this._toast(err?.message || "Cadence did not answer");
          return false;
        });
    }
    _setAuto(mode, m) {
      const cur = this._shownAuto(m);
      if (mode === cur) return;
      const run = () => {
        this._pend = { mode, ts: Date.now() };
        setTimeout(() => { this._pend = null; }, 6000);
        this._send({ command: "auto", mode: mode === "none" ? "schedule" : mode },
          mode === "on" ? "Auto mode on for today" : mode === "off" ? "Auto mode off for today" : "Following the schedule again");
      };
      if (mode === "none") { haptic("medium"); run(); return; }
      this._ask(mode === "on"
        ? { icon: "mdi:robot-outline", tone: "auto", title: "Turn auto mode on for today?", text: "Cadence starts driving the lights and music right away and keeps the chapters going until midnight.", go: "Turn on" }
        : { icon: "mdi:robot-off-outline", tone: "danger", title: "Turn auto mode off for today?", text: "Cadence stops changing lights and music until midnight. Everything stays as it is now.", go: "Turn off" },
      run);
    }
    _resume() {
      haptic("medium");
      this._send({ command: "resume" }, "Back on the schedule");
    }
    _apply(r, variant) {
      const name = r ? r.name : "the current chapter";
      this._ask({
        icon: "mdi:play-circle-outline", tone: "auto",
        title: `Start ${name}${variant ? ` · ${variant.label}` : ""} now?`,
        text: "Its scenes and music start right away. Cadence carries on from there at the next chapter.",
        go: "Start",
      }, () => {
        this._send({ command: "apply", chapter_id: r?.id || "", variant_key: variant?.key || "" }, `Starting ${name}`);
        if (this._sub) this._closeSub();
      });
    }
    _ask(c, run) { haptic("warning"); this._confirm = { ...c, run }; }
    _cancelConfirm() { haptic("selection"); this._confirm = null; }
    _go() {
      const c = this._confirm;
      if (!c) return;
      this._confirm = null;
      haptic("heavy");
      c.run();
    }
    _shownAuto(m) {
      if (this._pend && Date.now() - this._pend.ts < 6000 && this._pend.mode !== m.auto_override) return this._pend.mode;
      return m.auto_override || "none";
    }

    /* ---------- swipe to close ---------- */
    _hDown = (e) => { this._sd = { y: e.clientY, sub: false }; e.currentTarget.setPointerCapture(e.pointerId); };
    _hDownSub = (e) => { this._sd = { y: e.clientY, sub: true }; e.currentTarget.setPointerCapture(e.pointerId); };
    _hMove = (e) => {
      if (!this._sd) return;
      const dy = Math.max(0, e.clientY - this._sd.y);
      if (this._sd.sub) this._subY = dy; else this._sheetY = dy;
    };
    _hUp = () => {
      if (!this._sd) return;
      const sub = this._sd.sub;
      this._sd = null;
      if (sub) { if (this._subY > 90) this._closeSub(); else this._subY = 0; }
      else if (this._sheetY > 90) this.close(); else this._sheetY = 0;
    };

    /* ---------- render ---------- */
    render() {
      if (!this.hass) return html``;
      const { m, via } = current(this.hass);
      return this._dialog ? this._renderDialog(m, via) : this._renderSheet(m, via);
    }

    _renderSheet(m, via) {
      const style = this._sheetY > 0 ? `transform:translateY(${this._sheetY}px);transition:none;` : "";
      const st = m?.state;
      return html`
        <div class="backdrop ${this._closing ? "closing" : ""}" @click=${() => this.close()}></div>
        <div class="sheet ${this._closing ? "closing" : ""} ${this._sub ? "behind" : ""}" style=${style} role="dialog" aria-label="Cadence">
          <div class="header" @pointerdown=${this._hDown} @pointermove=${this._hMove} @pointerup=${this._hUp} @pointercancel=${this._hUp}>
            <div class="grabber"></div>
            <div class="title-row">
              <ha-icon icon="mdi:movie-open-play" class="brand"></ha-icon>
              <span class="title">Cadence</span>
              ${m ? html`<span class="chip st" style="--sc:${STATE_COLOR[st]}"><ha-icon .icon=${STATE_ICON[st]}></ha-icon>${SHORT[st]}</span>` : ""}
              <button class="close" @pointerdown=${(e) => e.stopPropagation()} @click=${() => this._openSub({ kind: "screen" })} aria-label="Pop-ups on this phone">
                <ha-icon icon="mdi:cog-outline"></ha-icon></button>
            </div>
            ${m ? html`
              <div class="seg tabs" role="tablist" @pointerdown=${(e) => e.stopPropagation()}>
                ${[["now", "Now"], ["today", "Today"]].map(([k, l]) => html`
                  <button role="tab" class=${this._tab === k ? "on" : ""} aria-selected=${this._tab === k ? "true" : "false"}
                    @click=${() => this._setTab(k)}>${l}</button>`)}
              </div>` : ""}
          </div>
          <div class="body">
            ${m ? (this._tab === "today" ? this._today(m) : this._now(m, via)) : this._empty(via)}
          </div>
          ${this._toastMsg && !this._sub ? html`<div class="toast">${this._toastMsg}</div>` : ""}
        </div>
        ${this._sub ? this._subSheet(m) : ""}
        ${this._confirm ? this._confirmDialog() : ""}
      `;
    }

    _renderDialog(m, via) {
      const st = m?.state;
      const tab = this._tab;
      const nav = [["now", "mdi:robot-outline", "Now"], ["today", "mdi:timeline-clock-outline", "Today"], ["screen", "mdi:tablet-dashboard", "This screen"]];
      return html`
        <div class="backdrop ${this._closing ? "closing" : ""}" @click=${() => this.close()}></div>
        <div class="dialog ${this._closing ? "closing" : ""}" role="dialog" aria-label="Cadence">
          <aside class="side">
            <div class="side-head">
              <ha-icon icon="mdi:movie-open-play" class="brand"></ha-icon>
              <span class="side-title">Cadence</span>
            </div>
            <nav role="tablist">
              ${nav.map(([k, icon, label]) => html`
                <button class="nav-item ${tab === k ? "on" : ""}" role="tab" aria-selected=${tab === k ? "true" : "false"} @click=${() => this._setTab(k)}>
                  <ha-icon .icon=${icon}></ha-icon><span class="nav-name">${label}</span>
                  ${k === "now" && m ? html`<span class="dot" style="background:${STATE_COLOR[st]}"></span>` : ""}
                </button>`)}
            </nav>
            <div class="side-spacer"></div>
            ${m ? this._sideInfo(m, via) : ""}
          </aside>
          <main class="content">
            <header class="content-head">
              <h2>${tab === "today" ? "Today" : tab === "screen" ? "This screen" : "Now"}</h2>
              ${m && tab === "today" && m.template ? html`<span class="chip">${m.template}</span>` : ""}
              ${m && tab === "now" ? html`<span class="chip st" style="--sc:${STATE_COLOR[st]}"><ha-icon .icon=${STATE_ICON[st]}></ha-icon>${SHORT[st]}</span>` : ""}
              ${m?.dry_run && tab !== "screen" ? html`<span class="chip warn"><ha-icon icon="mdi:test-tube"></ha-icon>Dry run</span>` : ""}
              <button class="close" @click=${() => this.close()} aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button>
            </header>
            <div class="body">
              ${tab === "screen" ? this._screen() : m ? (tab === "today" ? this._today(m) : this._now(m, via)) : this._empty(via)}
            </div>
            ${this._toastMsg ? html`<div class="toast">${this._toastMsg}</div>` : ""}
          </main>
        </div>
        ${this._sub?.kind === "chapter" ? this._chapterDialog(m, this._sub.r) : ""}
        ${this._confirm ? this._confirmDialog() : ""}
      `;
    }

    _empty(via) {
      const admin = this.hass?.user?.is_admin;
      const msg = {
        loading: ["mdi:progress-clock", "Asking Cadence…", "Reading the schedule from the Cadence app."],
        offline: ["mdi:lan-disconnect", "Cadence is not running", "The Cadence app stopped publishing its status. Check the app in Settings → Apps."],
        missing: ["mdi:help-circle-outline", "Cadence status not found",
          admin
            ? `No ${entityId} yet and the Cadence app's ingress API did not answer${Ingress.err ? ` (${Ingress.err})` : ""}. Update Cadence to 0.5.0 or later.`
            : `No ${entityId} yet. Cadence 0.5.0 or later publishes it; ask an admin to update the app.`],
      }[via] || ["mdi:help-circle-outline", "Cadence status not found", ""];
      return html`<div class="empty-state"><ha-icon .icon=${msg[0]}></ha-icon><div class="es-t">${msg[1]}</div><div class="es-x">${msg[2]}</div></div>`;
    }

    /* Now: status, chapter, ribbon, auto control, senses */
    _now(m, via) {
      const st = m.state;
      const reason = reasonText(this.hass, m);
      const ch = m.chapter;
      const chColor = (ch && (m.timeline.find((r) => r.id === ch.id)?.color || ch.color)) || "var(--cad-idle)";
      const nxt = m.next;
      const nxtR = nxt && m.timeline.find((r) => r.id === nxt.id);
      const progress = ch?.start && nxt?.at && !nxt.pending
        ? Math.min(1, Math.max(0, (Date.now() - Date.parse(ch.start)) / (Date.parse(nxt.at) - Date.parse(ch.start)))) : null;
      const shown = this._shownAuto(m);
      return html`
        ${this._reason ? html`<div class="why"><ha-icon icon="mdi:bell-ring-outline"></ha-icon>${this._reason}
          <button class="why-x" @click=${() => (this._reason = null)} aria-label="Dismiss"><ha-icon icon="mdi:close"></ha-icon></button></div>` : ""}
        <section class="hero" style="--sc:${STATE_COLOR[st]}">
          <div class="hero-ic"><ha-icon .icon=${STATE_ICON[st]}></ha-icon></div>
          <div class="hero-t">
            <div class="hero-title">${TITLES[st]}</div>
            <div class="hero-sub">${reason}</div>
            ${m.dry_run && !this._dialog ? html`<span class="chip warn hero-dry" title="Cadence logs what it would do and leaves the lights alone"><ha-icon icon="mdi:test-tube"></ha-icon>Dry run · logging only</span>` : ""}
          </div>
        </section>
        ${st === "hold" ? html`
          <section class="banner hold">
            <ha-icon icon="mdi:hand-back-left-outline"></ha-icon>
            <div class="b-t"><b>Someone changed things by hand</b><span>${m.hold.since ? `${since(m.hold.since)} · ` : ""}${holdText(this.hass, m)}</span></div>
            <button class="pill strong" @click=${() => this._resume()}>Resume</button>
          </section>` : ""}
        ${m.chapter_hold ? html`
          <section class="banner">
            <ha-icon icon="mdi:timer-sand"></ha-icon>
            <div class="b-t"><b>${m.timeline.find((r) => r.id === m.chapter_hold.chapter)?.name || "This chapter"} is holding</b>
              <span>while ${m.chapter_hold.label || "its sensor"} stays on${m.chapter_hold.until ? ` · at most until ${fmtT(this.hass, m.chapter_hold.until)}` : ""}</span></div>
          </section>` : ""}

        <section class="chapter" style="--c:${chColor}">
          ${ch ? html`
            <div class="ch-top">
              <span class="ch-label">Now</span>
              ${m.variant ? html`<span class="chip vchip">${m.variant.label}</span>` : ""}
              <span class="ch-since">since ${fmtT(this.hass, ch.start)}</span>
            </div>
            <div class="ch-name">${ch.name}</div>
            ${m.scenes?.length ? html`<div class="ch-scenes">${m.scenes.join(" · ")}</div>` : ""}
            ${progress != null ? html`<div class="prog"><i style="width:${progress * 100}%"></i></div>` : ""}
          ` : html`<div class="ch-top"><span class="ch-label">Now</span></div><div class="ch-name dim">${m.template ? "Between chapters" : "No template runs today"}</div>`}
          ${nxt ? html`
            <div class="ch-next" role="button" tabindex="0" @click=${() => nxtR && this._pick(nxtR)}>
              <span class="nx-dot" style="background:${nxtR?.color || "var(--cad-idle)"}"></span>
              <span class="nx-k">Next</span><span class="nx-n">${nxt.name}</span><span class="nx-t">${nextText(this.hass, m)}</span>
            </div>` : ""}
        </section>

        <section class="section">
          <div class="sec-head"><span>Today</span><span class="sec-sub">${m.template || "Nothing runs"}</span></div>
          ${m.timeline.length ? ribbon(this.hass, m, { onPick: (r) => this._pick(r) }) : html`<div class="muted">No chapters today.</div>`}
          <div class="legend">
            <span><i></i>Auto on</span>
            ${autoBand(m).some((x) => x.kind === "entity") ? html`<span><i class="entity"></i>${m.auto_entity ? `When ${friendly(this.hass, m.auto_entity)} is on` : "Follows the auto entity"}</span>` : ""}
            <span><i class="none"></i>Off</span>
          </div>
        </section>

        <section class="section">
          <div class="sec-head"><span>Auto mode today</span><span class="sec-sub">${shown === "none" ? "Following the schedule" : "Until midnight"}</span></div>
          <div class="seg big" role="radiogroup" aria-label="Auto mode today">
            ${[["none", "mdi:calendar-clock", "Schedule"], ["on", "mdi:robot-outline", "On"], ["off", "mdi:robot-off-outline", "Off"]].map(([k, icon, l]) => html`
              <button role="radio" aria-checked=${shown === k ? "true" : "false"} class="${shown === k ? "on" : ""} k-${k}" @click=${() => this._setAuto(k, m)}>
                <ha-icon .icon=${icon}></ha-icon>${l}</button>`)}
          </div>
        </section>

        ${this._dialog ? this._upcoming(m) : html`<div class="senses">${this._senses(m)}</div>`}
        ${via === "ingress" ? html`<div class="muted small">Read from the Cadence app directly (admin). Cadence 0.5.0+ publishes ${entityId} for every account.</div>` : ""}
      `;
    }

    _senses(m) {
      const items = [];
      if (m.sky && SKY[m.sky]) items.push([SKY[m.sky][0], SKY[m.sky][1]]);
      if (m.motion != null) items.push([m.motion ? "mdi:motion-sensor" : "mdi:motion-sensor-off", m.motion ? "Motion" : "Quiet"]);
      if (m.occupied != null) items.push([m.occupied ? "mdi:account-group" : "mdi:home-outline", m.occupied ? "Occupied" : "Vacant"]);
      if (m.asleep != null) items.push([m.asleep ? "mdi:sleep" : "mdi:white-balance-sunny", m.asleep ? "Asleep" : "Awake"]);
      if (!this._dialog && m.template) items.push(["mdi:calendar-text-outline", m.template]);
      return items.map(([icon, l]) => html`<span class="chip"><ha-icon .icon=${icon}></ha-icon>${l}</span>`);
    }

    _sideInfo(m, via) {
      const rows = [
        m.template ? ["mdi:calendar-text-outline", "Template", m.template] : ["mdi:calendar-blank-outline", "Template", "Nothing runs"],
        m.sky && SKY[m.sky] ? [SKY[m.sky][0], "Sky", SKY[m.sky][1]] : null,
        m.motion != null ? ["mdi:motion-sensor", "Motion", m.motion ? "Yes" : "Quiet"] : null,
        m.occupied != null ? ["mdi:account-group", "Building", m.occupied ? "Occupied" : "Vacant"] : null,
        m.asleep != null ? ["mdi:sleep", "Asleep", m.asleep ? "Yes" : "No"] : null,
        m.dry_run ? ["mdi:test-tube", "Dry run", "Logging only"] : null,
      ].filter(Boolean);
      return html`
        <div class="info" role="group" aria-label="Senses">
          ${rows.map(([icon, k, v]) => html`<div class="info-row" title="${k}: ${v}"><ha-icon .icon=${icon}></ha-icon><span class="k">${k}</span><span class="v">${v}</span></div>`)}
          ${via === "ingress" ? html`<div class="info-row muted"><ha-icon icon="mdi:shield-account-outline"></ha-icon><span class="k">Read via the app (admin)</span></div>` : ""}
        </div>`;
    }

    /* Today: every chapter with its start, tap to start it */
    _rows(m) {
      const now = nowParts(this.hass);
      const nowMin = now.date === m.date ? now.min : null;
      const rows = m.timeline
        .map((r) => ({ r, a: minOf(r.start || r.nominal) }))
        .sort((x, y) => (x.a ?? 9999) - (y.a ?? 9999));
      return rows.map((x, i) => {
        const cur = !!(m.chapter && m.chapter.id === x.r.id && minOf(m.chapter.start) === minOf(x.r.start));
        const nextA = rows[i + 1]?.a ?? 1440;
        const past = !cur && nowMin != null && x.a != null && nextA <= nowMin && !x.r.pending;
        return { ...x, cur, past, nowMin };
      });
    }

    _row({ r, cur, past }) {
      const [kIcon, kText] = KIND[r.kind] || KIND.clock;
      const tag = cur ? "Now" : r.pending ? (r.held_by ? `Held by ${r.held_by}` : "Waiting") : past ? "Done" : "";
      return html`
        <button class="row ${cur ? "cur" : ""} ${past ? "past" : ""}" style="--c:${r.color}" @click=${() => this._pick(r)}>
          <span class="r-time">${r.start ? fmtT(this.hass, r.start) : html`<span class="approx">${fmtT(this.hass, r.nominal)}</span>`}</span>
          <span class="r-bar"></span>
          <span class="r-main">
            <span class="r-name">${r.name}</span>
            <span class="r-sub"><ha-icon .icon=${kIcon}></ha-icon>${r.pending ? kText : r.kind === "clock" ? (r.fade >= 1 ? `fades over ${Math.round(r.fade)} min` : "at a set time") : kText}
              ${r.forced ? html` · <b>${r.variants.find((v) => v.key === r.forced)?.label || r.forced}</b> forced` : ""}</span>
          </span>
          ${tag ? html`<span class="r-tag ${cur ? "is-now" : ""}">${tag}</span>` : ""}
          <ha-icon class="r-go" icon="mdi:chevron-right"></ha-icon>
        </button>`;
    }

    _today(m) {
      const rows = this._rows(m);
      const nowMin = rows[0]?.nowMin ?? null;
      return html`
        ${m.timeline.length ? html`<section class="section">${ribbon(this.hass, m, { onPick: (r) => this._pick(r) })}</section>` : ""}
        ${m.carry_over && m.carry_over.until && nowMin != null && minOf(m.carry_over.until) > nowMin ? html`
          <div class="muted small">← ${m.carry_over.name} from yesterday runs until ${fmtT(this.hass, m.carry_over.until)}</div>` : ""}
        <div class="list">
          ${rows.length ? rows.map((x) => this._row(x)) : html`<div class="muted">No chapters today${m.template ? "" : ": no template runs"}.</div>`}
        </div>`;
    }

    /* Next few chapters, for the roomy tablet Now page */
    _upcoming(m) {
      const rows = this._rows(m);
      const i = rows.findIndex((x) => x.cur);
      const next = rows.filter((x, j) => j > i && !x.past).slice(0, 4);
      if (!next.length) return "";
      return html`
        <section class="section">
          <div class="sec-head"><span>Coming up</span>
            <button class="link" @click=${() => this._setTab("today")}>Whole day<ha-icon icon="mdi:chevron-right"></ha-icon></button></div>
          <div class="list">${next.map((x) => this._row(x))}</div>
        </section>`;
    }

    _pick(r) {
      if (!r) return;
      this._openSub({ kind: "chapter", r });
    }

    _chapterBody(m, r) {
      const cur = m?.chapter && m.chapter.id === r.id;
      const [kIcon, kText] = KIND[r.kind] || KIND.clock;
      return html`
        <div class="cd-meta">
          <span class="chip"><ha-icon .icon=${kIcon}></ha-icon>${r.start ? `${fmtT(this.hass, r.start)} · ${kText}` : `from ${fmtT(this.hass, r.nominal)} · ${kText}`}</span>
          ${cur ? html`<span class="chip st" style="--sc:var(--cad-auto)">Running now${m.variant ? ` · ${m.variant.label}` : ""}</span>` : ""}
          ${r.held_by ? html`<span class="chip">Held by ${r.held_by}</span>` : ""}
        </div>
        ${!m?.auto_active ? html`<div class="muted small">Auto mode is off. Starting a chapter fires its scenes once; Cadence won't follow up until auto mode is on.</div>` : ""}
        ${m?.dry_run ? html`<div class="muted small">Dry run: Cadence logs what it would do and leaves the building alone.</div>` : ""}
        <button class="act" @click=${() => this._apply(r, null)}><ha-icon icon="mdi:play"></ha-icon>Start ${r.name} now</button>
        ${r.variants.length > 1 ? html`
          <div class="sec-head"><span>Or start as</span></div>
          <div class="vgrid">
            ${r.variants.map((v) => html`<button class="vbtn ${cur && m.variant?.key === v.key ? "on" : ""}" @click=${() => this._apply(r, v)}>${v.label}</button>`)}
          </div>` : ""}`;
    }

    _chapterDialog(m, r) {
      return html`
        <div class="cf-scrim" @click=${() => this._closeSub()}></div>
        <div class="cd" style="--c:${r.color}" role="dialog" aria-label=${r.name}>
          <div class="cd-head"><span class="cd-dot"></span><span class="cd-title">${r.name}</span>
            <button class="close" @click=${() => this._closeSub()} aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button></div>
          ${this._chapterBody(m, r)}
        </div>`;
    }

    _subSheet(m) {
      const s = this._sub;
      const style = this._subY > 0 ? `transform:translateY(${this._subY}px);transition:none;` : "";
      const title = s.kind === "screen" ? "Pop-ups on this phone" : s.r.name;
      return html`
        <div class="backdrop sub-bd ${this._subClosing ? "closing" : ""}" @click=${() => this._closeSub()}></div>
        <div class="sheet sub ${this._subClosing ? "closing" : ""}" style="${style}${s.kind === "chapter" ? `--c:${s.r.color}` : ""}" role="dialog" aria-label=${title}>
          <div class="header" @pointerdown=${this._hDownSub} @pointermove=${this._hMove} @pointerup=${this._hUp} @pointercancel=${this._hUp}>
            <div class="grabber"></div>
            <div class="title-row">
              <button class="close back" @pointerdown=${(e) => e.stopPropagation()} @click=${() => this._closeSub()} aria-label="Back">
                <ha-icon icon="mdi:chevron-left"></ha-icon></button>
              ${s.kind === "chapter" ? html`<span class="cd-dot"></span>` : html`<ha-icon icon="mdi:bell-cog-outline" class="brand"></ha-icon>`}
              <span class="title">${title}</span>
            </div>
          </div>
          <div class="body">${s.kind === "screen" ? this._screen() : this._chapterBody(m, s.r)}</div>
          ${this._toastMsg ? html`<div class="toast">${this._toastMsg}</div>` : ""}
        </div>`;
    }

    /* This screen: which triggers pop the sheet up here */
    _screen() {
      const p = popPrefs();
      const kind = isTablet() ? "tablet" : "phone";
      const rows = [
        ["ask", "mdi:bell-ring-outline", "When Home Assistant asks", "An automation sends Cadence's show command, or presses the trigger button."],
        ["auto", "mdi:robot-outline", "When auto mode turns on or off", "The schedule window opens or closes, or someone changes it."],
        ["hold", "mdi:hand-back-left-outline", "When someone changes things by hand", "A keypad scene changes and Cadence holds until the next chapter."],
        ["chapter", "mdi:book-open-page-variant-outline", "When a new chapter starts", "Every chapter change through the day."],
      ];
      return html`
        <div class="muted small">This ${kind} pops Cadence up on its own when:</div>
        <div class="toggles">
          ${rows.map(([k, icon, t, x]) => html`
            <button class="tg ${p[k] ? "on" : ""}" role="switch" aria-checked=${p[k] ? "true" : "false"}
              @click=${() => { haptic("selection"); setPop(k, !p[k]); this.requestUpdate(); }}>
              <ha-icon .icon=${icon}></ha-icon>
              <span class="tg-t"><b>${t}</b><span>${x}</span></span>
              <span class="sw"><i></i></span>
            </button>`)}
        </div>
        <div class="muted small">Settings are kept on this ${kind} only. A pop-up closes after ${isTablet() ? "2 minutes" : "a minute"} without a touch.</div>
        <div class="muted small">Cadence card ${VERSION}${current(this.hass).m?.version ? ` · Cadence ${current(this.hass).m.version}` : ""}</div>`;
    }

    _confirmDialog() {
      const c = this._confirm;
      return html`
        <div class="cf-scrim top" @click=${() => this._cancelConfirm()}></div>
        <div class="cf" role="alertdialog" aria-label=${c.title}>
          <div class="cf-icon ${c.tone || ""}"><ha-icon .icon=${c.icon}></ha-icon></div>
          <div class="cf-title">${c.title}</div>
          <div class="cf-text">${c.text}</div>
          <div class="cf-btns">
            <button class="cf-cancel" @click=${() => this._cancelConfirm()}>Cancel</button>
            <button class="cf-go ${c.tone || ""}" @click=${() => this._go()}>${c.go}</button>
          </div>
        </div>`;
    }

    static get styles() {
      return [shared, css`
        :host {
          position: fixed; inset: 0; z-index: 10000; display: block;
          color: var(--primary-text-color, #e1e1e1);
          --bg: var(--ha-card-background, var(--card-background-color, #1c1c1c));
          --danger: var(--error-color, #db4437);
        }
        .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); animation: fade-in .24s ease; }
        .backdrop.sub-bd { background: rgba(0,0,0,.28); }
        .backdrop.closing { animation: fade-out .24s ease forwards; }
        .sheet { position: fixed; left: 0; right: 0; bottom: 0; margin: 0 auto; max-width: 560px; max-height: 92vh; max-height: 92dvh;
          display: flex; flex-direction: column; background: var(--bg); border-radius: 18px 18px 0 0; box-shadow: 0 -8px 32px rgba(0,0,0,.35);
          animation: slide-up .28s cubic-bezier(.25,1,.4,1); transition: transform .2s ease, filter .2s ease; padding-bottom: env(safe-area-inset-bottom, 0); }
        .sheet.behind { filter: brightness(.82); }
        .sheet.sub { max-height: 84vh; max-height: 84dvh; min-height: 36vh; }
        .sheet.closing { animation: slide-down .24s ease forwards; }
        @keyframes slide-up { from { transform: translateY(100%); } to { transform: none; } }
        @keyframes slide-down { from { transform: none; } to { transform: translateY(110%); } }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fade-out { from { opacity: 1; } to { opacity: 0; } }
        @keyframes cf-up { from { opacity: 0; transform: translateY(16px) scale(.97); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .sheet, .backdrop, .cf, .cd, .dialog { animation-duration: .01s !important; } }

        .header { padding: 6px 16px 10px; cursor: grab; touch-action: none; flex-shrink: 0; }
        .grabber { width: 40px; height: 4px; border-radius: 2px; background: var(--divider-color, rgba(120,120,120,.4)); margin: 6px auto 12px; }
        .title-row { display: flex; align-items: center; gap: 8px; }
        .brand { color: var(--accent); }
        .title { flex: 1; min-width: 0; font-size: 18px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .close { width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
          background: var(--soft2); color: var(--secondary-text-color); flex-shrink: 0; }
        .close.back { background: transparent; margin-left: -8px; width: 36px; }
        .close:active { transform: scale(.94); }

        .body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 16px 24px; display: flex; flex-direction: column; gap: 12px; }
        .body > * { flex-shrink: 0; }
        .section { background: var(--secondary-background-color, rgba(120,120,120,.08)); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
        .sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 600; }
        .sec-sub { font-size: 12px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .muted { color: var(--secondary-text-color); font-size: 13px; }
        .small { font-size: 12px; line-height: 1.45; }

        /* segmented controls */
        .seg { display: flex; gap: 4px; padding: 4px; border-radius: 12px; background: var(--soft); }
        .seg button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; border: none; border-radius: 9px; padding: 8px 6px;
          background: transparent; color: var(--secondary-text-color); font-size: 13px; font-weight: 600; cursor: pointer; transition: background .15s ease, color .15s ease; }
        .seg button.on { background: var(--bg); color: var(--primary-text-color); box-shadow: 0 1px 3px rgba(0,0,0,.18); }
        .seg button ha-icon { --mdc-icon-size: 18px; }
        .seg.tabs { margin-top: 12px; }
        .seg.big button { padding: 11px 6px; font-size: 14px; }
        .seg.big button.on.k-on { background: color-mix(in srgb, var(--cad-auto) 22%, var(--bg)); }
        .seg.big button.on.k-on ha-icon { color: var(--cad-auto); }
        .seg.big button.on.k-off { background: color-mix(in srgb, var(--danger) 16%, var(--bg)); }
        .seg.big button.on.k-off ha-icon { color: var(--danger); }
        .seg.big button.on.k-none ha-icon { color: var(--accent); }

        /* hero */
        .why { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 12px; border-radius: 12px; font-size: 13px; font-weight: 500;
          background: color-mix(in srgb, var(--accent) 14%, transparent); }
        .why ha-icon { --mdc-icon-size: 18px; color: var(--accent); }
        .why-x { margin-left: auto; border: none; background: none; cursor: pointer; display: flex; padding: 4px; color: var(--secondary-text-color); }
        .hero { display: flex; align-items: center; gap: 14px; padding: 4px 2px; }
        .hero-ic { width: 54px; height: 54px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
          color: var(--sc); background: color-mix(in srgb, var(--sc) 18%, transparent); position: relative; }
        .hero-ic ha-icon { --mdc-icon-size: 30px; }
        :host([state="auto"]) .hero-ic::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid var(--sc);
          opacity: .0; animation: pulse 2.8s ease-out infinite; }
        @keyframes pulse { 0% { opacity: .55; transform: scale(.92); } 80%, 100% { opacity: 0; transform: scale(1.18); } }
        @media (prefers-reduced-motion: reduce) { .hero-ic::after { animation: none !important; } }
        .hero-t { flex: 1; min-width: 0; }
        .hero-title { font-size: 20px; font-weight: 600; line-height: 1.25; }
        .hero-sub { margin-top: 2px; font-size: 13px; color: var(--secondary-text-color); }
        .hero-dry { margin-top: 6px; padding: 2px 9px; }

        .banner { display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 14px; border-radius: 14px; background: var(--secondary-background-color, rgba(120,120,120,.08)); }
        .banner > ha-icon { color: var(--secondary-text-color); flex-shrink: 0; }
        .banner.hold { background: color-mix(in srgb, var(--cad-hold) 14%, transparent); }
        .banner.hold > ha-icon { color: var(--cad-hold); }
        .b-t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
        .b-t span { color: var(--secondary-text-color); font-size: 12px; }
        .pill { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: none; border-radius: 999px; padding: 9px 16px;
          background: var(--soft2); cursor: pointer; font-size: 13px; font-weight: 600; flex-shrink: 0; }
        .pill.strong { background: var(--cad-hold); color: #000; }
        .pill:active { transform: scale(.97); }

        /* current chapter */
        .chapter { position: relative; overflow: hidden; border-radius: 16px; padding: 14px 16px 12px; display: flex; flex-direction: column; gap: 4px;
          background: color-mix(in srgb, var(--c) 16%, var(--secondary-background-color, rgba(120,120,120,.08))); }
        .chapter::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--c); }
        .ch-top { display: flex; align-items: center; gap: 8px; }
        .ch-label { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: color-mix(in srgb, var(--c) 60%, var(--primary-text-color)); }
        .vchip { color: color-mix(in srgb, var(--c) 55%, var(--primary-text-color)); background: color-mix(in srgb, var(--c) 22%, transparent); padding: 2px 9px; }
        .ch-since { margin-left: auto; font-size: 12px; color: var(--secondary-text-color); }
        .ch-name { font-size: 26px; font-weight: 600; line-height: 1.2; }
        .ch-name.dim { font-size: 18px; color: var(--secondary-text-color); }
        .ch-scenes { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .prog { height: 4px; border-radius: 2px; background: var(--soft2); margin: 8px 0 2px; overflow: hidden; }
        .prog i { display: block; height: 100%; background: var(--c); border-radius: 2px; transition: width .4s ease; }
        .ch-next { display: flex; align-items: center; gap: 8px; margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--soft2); font-size: 13px; cursor: pointer; min-width: 0; }
        .nx-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
        .nx-k { color: var(--secondary-text-color); }
        .nx-n { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .nx-t { margin-left: auto; color: var(--secondary-text-color); white-space: nowrap; font-variant-numeric: tabular-nums; }

        .senses { display: flex; flex-wrap: wrap; gap: 6px; }
        .link { display: inline-flex; align-items: center; gap: 2px; border: none; background: none; padding: 0; cursor: pointer;
          font-size: 12px; font-weight: 600; color: var(--accent); }
        .link ha-icon { --mdc-icon-size: 16px; }
        .section .row { background: var(--bg); }
        .section .row.cur { background: color-mix(in srgb, var(--c) 18%, var(--bg)); }

        /* today list */
        .list { display: flex; flex-direction: column; gap: 6px; }
        .row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 8px 10px 10px; border: none; border-radius: 12px; text-align: left; cursor: pointer;
          background: var(--secondary-background-color, rgba(120,120,120,.08)); min-width: 0; }
        .row:active { transform: scale(.99); }
        .row.cur { background: color-mix(in srgb, var(--c) 18%, var(--secondary-background-color, rgba(120,120,120,.08))); }
        .row.past { opacity: .6; }
        .r-time { width: 66px; flex-shrink: 0; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--secondary-text-color); }
        .row.cur .r-time { color: var(--primary-text-color); }
        .approx { font-style: italic; font-weight: 500; }
        .approx::before { content: "~"; }
        .r-bar { width: 4px; align-self: stretch; border-radius: 2px; background: var(--c); flex-shrink: 0; }
        .r-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
        .r-name { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .r-sub { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .r-sub ha-icon { --mdc-icon-size: 14px; flex-shrink: 0; }
        .r-tag { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 999px; background: var(--soft2); color: var(--secondary-text-color); white-space: nowrap; }
        .r-tag.is-now { background: var(--c); color: #000; }
        .r-go { --mdc-icon-size: 20px; color: var(--secondary-text-color); flex-shrink: 0; }

        /* chapter actions */
        .cd-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--c); flex-shrink: 0; }
        .cd-meta { display: flex; flex-wrap: wrap; gap: 6px; }
        .act { display: flex; align-items: center; justify-content: center; gap: 8px; border: none; border-radius: 12px; padding: 13px 10px; font-weight: 600; font-size: 15px;
          cursor: pointer; background: color-mix(in srgb, var(--c, var(--accent)) 30%, transparent); color: var(--primary-text-color); }
        .act ha-icon { --mdc-icon-size: 20px; }
        .act:active { transform: scale(.98); }
        .vgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        .vbtn { border: none; border-radius: 12px; padding: 12px 8px; background: var(--soft2); font-weight: 600; font-size: 14px; cursor: pointer;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .vbtn.on { box-shadow: inset 0 0 0 2px var(--c); }
        .vbtn:active { transform: scale(.97); }
        .cd { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 41; width: min(440px, 92vw); max-height: 86vh; overflow-y: auto;
          display: flex; flex-direction: column; gap: 12px; padding: 18px; background: var(--bg); border-radius: 18px; box-shadow: 0 12px 36px rgba(0,0,0,.4);
          animation: fade-in .18s ease; }
        .cd-head { display: flex; align-items: center; gap: 10px; }
        .cd-title { flex: 1; font-size: 19px; font-weight: 600; }

        /* this screen */
        .toggles { display: flex; flex-direction: column; gap: 8px; }
        .tg { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px; border: none; border-radius: 12px; text-align: left; cursor: pointer;
          background: var(--secondary-background-color, rgba(120,120,120,.08)); }
        .tg > ha-icon { color: var(--secondary-text-color); flex-shrink: 0; }
        .tg.on > ha-icon { color: var(--accent); }
        .tg-t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
        .tg-t span { font-size: 12px; color: var(--secondary-text-color); }
        .sw { width: 40px; height: 24px; border-radius: 12px; background: var(--soft2); position: relative; flex-shrink: 0; transition: background .18s ease; }
        .sw i { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3);
          transition: left .18s cubic-bezier(.25,1,.4,1); }
        .tg.on .sw { background: var(--accent); }
        .tg.on .sw i { left: 19px; }

        .empty-state { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 32px 12px; text-align: center; }
        .empty-state ha-icon { --mdc-icon-size: 40px; color: var(--secondary-text-color); }
        .es-t { font-size: 17px; font-weight: 600; }
        .es-x { font-size: 13px; color: var(--secondary-text-color); max-width: 380px; line-height: 1.45; }

        .toast { position: absolute; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 30;
          max-width: calc(100% - 32px); padding: 10px 16px; border-radius: 12px; background: rgba(30,30,30,.92); color: #fff; font-size: 13px;
          box-shadow: 0 6px 20px rgba(0,0,0,.35); animation: fade-in .2s ease; pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* confirm (same look as the station sheets) */
        .cf-scrim { position: fixed; inset: 0; z-index: 40; background: rgba(0,0,0,.45); animation: fade-in .18s ease; }
        .cf-scrim.top { z-index: 42; }
        .cf { position: fixed; left: 12px; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); z-index: 43; max-width: 440px; margin: 0 auto;
          display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px 16px 16px; text-align: center; background: var(--bg);
          border-radius: 18px; box-shadow: 0 12px 36px rgba(0,0,0,.4); animation: cf-up .22s cubic-bezier(.25,1,.4,1); color: var(--primary-text-color); }
        .cf-icon { width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); }
        .cf-icon.danger { color: var(--danger); background: color-mix(in srgb, var(--danger) 15%, transparent); }
        .cf-icon.auto { color: var(--cad-auto); background: color-mix(in srgb, var(--cad-auto) 15%, transparent); }
        .cf-icon ha-icon { --mdc-icon-size: 28px; }
        .cf-title { margin-top: 4px; font-size: 17px; font-weight: 600; }
        .cf-text { max-width: 360px; font-size: 13px; line-height: 1.45; color: var(--secondary-text-color); }
        .cf-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; margin-top: 8px; }
        .cf-btns button { border: none; border-radius: 12px; padding: 13px; font-weight: 600; cursor: pointer; }
        .cf-btns button:active { filter: brightness(.92); }
        .cf-cancel { background: var(--soft2); }
        .cf-go { background: var(--accent); color: #fff !important; }
        .cf-go.danger { background: var(--danger); }
        .cf-go.auto { background: var(--cad-auto); }

        /* tablet / desktop dialog */
        .dialog { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(1060px, 94vw); height: min(86vh, 860px);
          display: flex; background: var(--bg); border-radius: 22px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.4); animation: dlg-in .22s cubic-bezier(.25,1,.4,1); }
        .dialog.closing { animation: dlg-out .2s ease forwards; }
        @keyframes dlg-in { from { opacity: 0; transform: translate(-50%, -48%) scale(.97); } to { opacity: 1; transform: translate(-50%, -50%); } }
        @keyframes dlg-out { to { opacity: 0; transform: translate(-50%, -48%) scale(.97); } }
        .side { width: 236px; flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; padding: 22px 14px 16px; overflow-y: auto;
          background: var(--secondary-background-color, rgba(120,120,120,.08)); }
        .side-head { display: flex; align-items: center; gap: 8px; padding: 0 8px 14px; }
        .side-title { flex: 1; font-size: 22px; font-weight: 600; }
        nav { display: flex; flex-direction: column; gap: 4px; }
        .nav-item { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: none; border-radius: 12px; background: transparent; text-align: left;
          font-weight: 500; font-size: 15px; color: var(--secondary-text-color); cursor: pointer; min-width: 0; }
        .nav-item ha-icon { --mdc-icon-size: 20px; flex-shrink: 0; }
        .nav-item.on { background: var(--bg); color: var(--primary-text-color); box-shadow: 0 1px 3px rgba(0,0,0,.15); }
        .nav-item.on > ha-icon { color: var(--accent); }
        .nav-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
        .side-spacer { flex: 1; min-height: 8px; }
        .info { display: flex; flex-direction: column; gap: 9px; padding: 12px; border-radius: 14px; background: var(--bg); }
        .info-row { display: flex; align-items: center; gap: 8px; font-size: 12px; min-width: 0; }
        .info-row ha-icon { --mdc-icon-size: 16px; color: var(--secondary-text-color); flex-shrink: 0; }
        .info-row .k { color: var(--secondary-text-color); flex-shrink: 0; }
        .info-row .v { margin-left: auto; font-weight: 600; text-align: right; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .content { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
        .content-head { display: flex; align-items: center; gap: 10px; padding: 20px 20px 10px; flex-shrink: 0; }
        .content-head h2 { flex: 1; margin: 0; font-size: 21px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        :host([layout="dialog"]) .body { padding: 4px 20px 24px; gap: 14px; }
        :host([layout="dialog"]) .hero-ic { width: 64px; height: 64px; }
        :host([layout="dialog"]) .hero-ic ha-icon { --mdc-icon-size: 34px; }
        :host([layout="dialog"]) .hero-title { font-size: 24px; }
        :host([layout="dialog"]) .ch-name { font-size: 32px; }
        :host([layout="dialog"]) .rb-ch { height: 44px; }
        :host([layout="dialog"]) .rb-auto { height: 12px; }
        :host([layout="dialog"]) .blk { font-size: 12px; }
        :host([layout="dialog"]) .seg.big { max-width: 520px; }
        :host([layout="dialog"]) .list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        :host([layout="dialog"]) .toggles { max-width: 620px; }
        :host([layout="dialog"]) .cf { top: 50%; bottom: auto; left: 50%; right: auto; width: min(440px, 90vw); transform: translate(-50%, -50%); animation: fade-in .18s ease; }
        @media (max-width: 900px) { :host([layout="dialog"]) .list { grid-template-columns: 1fr; } }
      `];
    }

    updated() {
      const { m } = current(this.hass);
      const st = m?.state || "none";
      if (this.getAttribute("state") !== st) this.setAttribute("state", st);
    }
  }
  if (!customElements.get("cadence-sheet")) customElements.define("cadence-sheet", CadenceSheet);

  /* ---------- opener ---------- */
  let lastClosed = 0;
  const openSheet = ({ tab, reason, from, auto } = {}) => {
    const existing = document.body.querySelector("cadence-sheet");
    if (existing && !existing._closing) {
      if (tab) existing.openTab(tab);
      if (reason) existing._reason = reason;
      return existing;
    }
    existing?.remove();
    const el = document.createElement("cadence-sheet");
    el.hass = getHass();
    const src = from || document.querySelector("home-assistant");
    el._themeSrc = src;
    el._themeSig = themeSig(el.hass);
    el._auto = !!auto;
    applyTheme(el, src);
    document.body.appendChild(el);
    if (tab) el.openTab(tab);
    if (reason) el._reason = reason;
    return el;
  };
  window.openCadenceSheet = (opts = {}) => openSheet(opts || {});
  window.addEventListener("cadence-sheet-open", (e) => openSheet(e.detail || {}));

  /* #cadence, #cadence-today, #cadence-screen, #pop-up-cadence */
  const HASH = /^#(?:pop-up-)?cadence(?:-(now|today|screen))?$/;
  const checkHash = () => {
    const mt = location.hash.match(HASH);
    if (!mt) return;
    history.replaceState(history.state, "", location.pathname + location.search);
    openSheet({ tab: mt[1] });
  };
  window.addEventListener("hashchange", checkHash);
  window.addEventListener("location-changed", () => setTimeout(checkHash, 0));
  checkHash();

  /* ---------- pop-up triggers ---------- */
  (() => {
    let prev = null;
    let prevTrig;
    const reasons = [];
    setInterval(() => {
      const h = getHass();
      if (!h) return;
      const { m } = current(h);
      const trig = h.states?.[DEF.triggerEntity]?.state;
      if (prev === null) { prev = m ? { ...m } : {}; prevTrig = trig; return; }
      const p = popPrefs();
      reasons.length = 0;
      let tab = null;
      if (m) {
        if (p.auto && prev.auto_active !== undefined && m.auto_active !== prev.auto_active) {
          reasons.push(m.auto_active ? "Auto mode turned on" : "Auto mode turned off");
        }
        if (p.hold && m.hold?.active && !prev.hold?.active) reasons.push("Someone changed things by hand");
        if (p.chapter && m.chapter?.id && prev.chapter && (m.chapter.id !== prev.chapter.id || m.chapter.start !== prev.chapter.start)) {
          reasons.push(`${m.chapter.name} started`);
        }
        const sh = m.show;
        if (p.ask && sh?.at && sh.at !== prev.show?.at && Date.now() - Date.parse(sh.at) < 120000) {
          const fits = !sh.screens || sh.screens === "all" || (sh.screens === "tablets") === isTablet();
          if (fits) { reasons.push("Home Assistant asked to show Cadence"); tab = TABS.includes(sh.tab) ? sh.tab : null; }
        }
      }
      if (p.ask && trig !== prevTrig && trig !== undefined && prevTrig !== undefined && !DEAD.includes(trig)) {
        reasons.push("Home Assistant asked to show Cadence");
      }
      prev = m ? { ...m } : prev;
      prevTrig = trig;
      if (!reasons.length || document.hidden) return;
      if (Date.now() - lastClosed < 5000) return; // just closed by hand: don't bounce back
      openSheet({ tab: tab || "now", reason: reasons[0], auto: true });
    }, 1000);
  })();

  /* Idle close: same rules as the station sheets; never mid-confirmation */
  (() => {
    const IDLE_PHONE_S = 60, IDLE_TABLET_S = 120;
    const idleMs = () => (isTablet() ? IDLE_TABLET_S : IDLE_PHONE_S) * 1000;
    let last = Date.now();
    const bump = () => (last = Date.now());
    for (const ev of ["pointerdown", "pointermove", "touchstart", "touchmove", "keydown", "wheel", "input"]) {
      window.addEventListener(ev, bump, { capture: true, passive: true });
    }
    const closeInstant = () => document.querySelectorAll("cadence-sheet").forEach((s) => s.remove());
    document.addEventListener("visibilitychange", () => document.hidden && closeInstant());
    window.addEventListener("pagehide", closeInstant);
    let wasOpen = false;
    setInterval(() => {
      if (document.hidden) return;
      const open = [...document.querySelectorAll("cadence-sheet")].filter((s) => !s._closing);
      if (!open.length) { wasOpen = false; return; }
      if (!wasOpen) { wasOpen = true; bump(); return; }
      if (open.some((s) => s._confirm)) return;
      if (Date.now() - last < idleMs()) return;
      open.forEach((s) => { s._closing = true; setTimeout(() => s.remove(), 240); });
      wasOpen = false;
    }, 1000);
  })();

  /* ================================================================== */
  /* Tile card                                                           */
  /* ================================================================== */
  class CadenceCard extends Base {
    static get properties() { return { hass: { attribute: false }, _config: { state: true }, _tick: { state: true } }; }

    static getStubConfig() { return { ribbon: true }; }
    static getConfigForm() {
      return {
        schema: [
          { name: "name", selector: { text: {} } },
          { name: "icon", selector: { icon: {} } },
          { name: "ribbon", selector: { boolean: {} } },
          { name: "vertical", selector: { boolean: {} } },
          { name: "tab", selector: { select: { mode: "dropdown", options: [{ value: "now", label: "Now" }, { value: "today", label: "Today" }, { value: "screen", label: "This screen" }] } } },
          { name: "entity", selector: { entity: { domain: "sensor" } } },
        ],
        computeLabel: (s) => ({ name: "Name", icon: "Icon", ribbon: "Show today's ribbon", vertical: "Vertical", tab: "Opens on", entity: "Cadence status entity" })[s.name],
      };
    }

    setConfig(config) {
      this._config = { ...(config || {}) };
      if (config?.entity) entityId = config.entity;
      if (config?.popup && typeof config.popup === "object") cardPopup = { ...(cardPopup || {}), ...config.popup };
    }
    getCardSize() { return this._config?.ribbon ? 2 : 1; }
    getGridOptions() {
      const v = this._config?.vertical;
      return { columns: 6, rows: (this._config?.ribbon ? 1 : 0) + (v ? 2 : 1), min_columns: 3, min_rows: 1 };
    }
    connectedCallback() {
      super.connectedCallback();
      this._t = setInterval(() => this._tick = (this._tick || 0) + 1, 30000);
      this._onData = () => this.requestUpdate();
      window.addEventListener("cadence-data", this._onData);
    }
    disconnectedCallback() {
      clearInterval(this._t);
      window.removeEventListener("cadence-data", this._onData);
      super.disconnectedCallback();
    }

    _open() {
      haptic("light");
      openSheet({ tab: this._config?.tab, from: this });
    }

    render() {
      if (!this._config || !this.hass) return html``;
      const c = this._config;
      const { m, via } = current(this.hass);
      const st = m?.state;
      const color = !m ? "var(--disabled-color, #8a8a8a)" : STATE_COLOR[st];
      const icon = c.icon || (m ? STATE_ICON[st] : "mdi:movie-open-play");
      let primary, secondary;
      if (!m) {
        primary = c.name || "Cadence";
        secondary = via === "loading" ? "Loading…" : via === "offline" ? "Not running" : "Status not found";
      } else {
        primary = c.name || (m.chapter ? m.chapter.name : "Cadence");
        const bits = [SHORT[st]];
        if (m.variant && st !== "off") bits.push(m.variant.label);
        if (st === "hold") bits.push("changed by hand");
        else if (m.next && st !== "off") bits.push(`next ${m.next.name}${m.next.at && !m.next.pending ? ` ${fmtT(this.hass, m.next.at)}` : ""}`);
        else if (st === "off") bits.push(reasonText(this.hass, m));
        if (c.name && m.chapter) bits.splice(1, 0, m.chapter.name);
        secondary = bits.join(" · ");
      }
      return html`
        <ha-card class="${c.vertical ? "vertical" : ""}" style="--tile-color:${color}" @click=${() => this._open()}
          role="button" tabindex="0" aria-label="Open Cadence: ${primary}, ${secondary}"
          @keydown=${(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._open(); } }}>
          <div class="t-head">
            <div class="t-icon"><ha-icon .icon=${icon}></ha-icon>${m?.dry_run ? html`<span class="badge" title="Dry run"><ha-icon icon="mdi:test-tube"></ha-icon></span>` : ""}</div>
            <div class="t-info">
              <span class="t-name">${primary}</span>
              <span class="t-state">${secondary}</span>
            </div>
          </div>
          ${c.ribbon && m && m.timeline.length ? html`<div class="t-feat">${ribbon(this.hass, m, { mini: true })}</div>` : ""}
        </ha-card>`;
    }

    static get styles() {
      return [shared, css`
        :host { display: block; height: 100%; }
        ha-card { height: 100%; display: flex; flex-direction: column; justify-content: center; cursor: pointer; overflow: hidden;
          -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; }
        ha-card:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
        .t-head { display: flex; align-items: center; gap: 10px; padding: 10px; min-width: 0; }
        .t-icon { position: relative; width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
          color: var(--tile-color); background: color-mix(in srgb, var(--tile-color) 20%, transparent); transition: background-color .18s ease, color .18s ease, transform .1s ease; }
        .t-icon ha-icon { --mdc-icon-size: 24px; }
        ha-card:active .t-icon { transform: scale(.92); }
        .badge { position: absolute; right: -4px; bottom: -4px; width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          background: var(--warning-color, #ffa600); color: #000; }
        .badge ha-icon { --mdc-icon-size: 11px; }
        .t-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .t-name { font-size: 14px; font-weight: 500; line-height: 20px; letter-spacing: .1px; color: var(--primary-text-color);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .t-state { font-size: 12px; line-height: 16px; letter-spacing: .4px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .t-feat { padding: 0 12px 12px; }
        .vertical .t-head { flex-direction: column; text-align: center; gap: 6px; padding: 12px 10px 10px; }
        .vertical .t-info { align-items: center; width: 100%; }
      `];
    }
  }
  if (!customElements.get("cadence-card")) customElements.define("cadence-card", CadenceCard);

  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === "cadence-card")) {
    window.customCards.push({
      type: "cadence-card", name: "Cadence", preview: false,
      description: "Cadence auto mode at a glance; tap for the day, the schedule and controls.",
      documentationURL: "https://github.com/bwilky/cadence/tree/main/card",
    });
  }

  console.info(`%c CADENCE-CARD %c ${VERSION} `,
    "background:#6fa8dc;color:#000;border-radius:4px 0 0 4px;padding:2px 6px",
    "background:#555;color:#fff;border-radius:0 4px 4px 0;padding:2px 6px");
})();
