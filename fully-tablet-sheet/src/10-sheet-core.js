
  /* ================================================================== */
  /* History data (recorder + logbook over the websocket)                */
  /* ================================================================== */
  const RANGES = [["6h", 6], ["24h", 24], ["48h", 48], ["7d", 168]];
  const rowTime = (r) => {
    const v = r.lu ?? r.last_updated ?? r.lc ?? r.last_changed;
    if (typeof v === "number") return v * 1000;
    const p = Date.parse(v);
    return Number.isFinite(p) ? p : null;
  };
  const rowState = (r) => r.s ?? r.state;
  /* -> [{t, s}] sorted by time, each with the state that starts at t */
  const series = (rows) => (rows || [])
    .map((r) => ({ t: rowTime(r), s: rowState(r) }))
    .filter((x) => x.t != null)
    .sort((a, b) => a.t - b.t);
  /* -> [{from, to, s}] covering [start, end] */
  const segments = (rows, start, end) => {
    const s = series(rows);
    const out = [];
    let cur = null, from = start;
    for (const x of s) {
      if (x.t <= start) { cur = x.s; continue; }
      if (cur !== null) out.push({ from, to: x.t, s: cur });
      cur = x.s; from = x.t;
    }
    out.push({ from, to: end, s: cur });
    return out;
  };

  const loadHistory = async (hass, t, hours) => {
    const I = ids(t.prefix);
    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600 * 1000);
    const entity_ids = [I.screen, I.battery, I.plugged, I.fg, I.reboot, I.btn("restart_browser"), I.btn("load_start_url"), I.btn("clear_browser_cache"), I.btn("bring_to_foreground"), I.btn("send_to_background")];
    if (t.plug) entity_ids.push(t.plug);
    const have = entity_ids.filter((id) => hass.states?.[id]);
    const [hist, log] = await Promise.all([
      hass.callWS({
        type: "history/history_during_period", start_time: start.toISOString(), end_time: end.toISOString(),
        entity_ids: [I.screen, I.battery, I.plugged, I.fg].filter((id) => hass.states?.[id]),
        minimal_response: true, no_attributes: true, significant_changes_only: false,
      }).catch((err) => { console.warn(TAG, "history", err); return {}; }),
      hass.callWS({
        type: "logbook/get_events", start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: have,
      }).catch((err) => { console.warn(TAG, "logbook", err); return []; }),
    ]);
    const s = start.getTime(), e = end.getTime();
    const screen = segments(hist[I.screen], s, e);
    const plugged = segments(hist[I.plugged], s, e);
    const fg = segments(hist[I.fg], s, e);
    const battery = series(hist[I.battery]).map((x) => ({ t: x.t, v: parseFloat(x.s) })).filter((x) => Number.isFinite(x.v));
    const stats = {
      onMs: screen.filter((x) => x.s === "on").reduce((a, x) => a + (x.to - x.from), 0),
      offMs: screen.filter((x) => x.s === "off").reduce((a, x) => a + (x.to - x.from), 0),
      deadMs: screen.filter((x) => !x.s || DEAD.includes(x.s)).reduce((a, x) => a + (x.to - x.from), 0),
      onCount: series(hist[I.screen]).filter((x) => x.s === "on" && x.t > s).length,
      dropCount: series(hist[I.screen]).filter((x) => x.s === "unavailable" && x.t > s).length,
      chargeMs: plugged.filter((x) => x.s === "on").reduce((a, x) => a + (x.to - x.from), 0),
      unplugCount: series(hist[I.plugged]).filter((x) => x.s === "off" && x.t > s).length,
      batMin: battery.length ? Math.min(...battery.map((x) => x.v)) : null,
      batMax: battery.length ? Math.max(...battery.map((x) => x.v)) : null,
    };
    const entries = (Array.isArray(log) ? log : []).map((r) => describeLog(r, t, I)).filter(Boolean).sort((a, b) => b.t - a.t);
    return { start: s, end: e, screen, plugged, fg, battery, stats, log: entries, at: Date.now() };
  };

  /* One logbook row -> {t, icon, tone, text, sub} or null to skip */
  const describeLog = (r, t, I) => {
    const ts = typeof r.when === "number" ? r.when * 1000 : Date.parse(r.when);
    if (!Number.isFinite(ts)) return null;
    const id = r.entity_id || "";
    const st = r.state;
    const via = r.context_entity_id_name ? `via ${r.context_entity_id_name}` : r.context_user_id ? "by a user" : "";
    const sub = [fmtTime(ts, true), via].filter(Boolean).join(" · ");
    const dead = st && DEAD.includes(st);
    if (id === I.screen) {
      if (st === "unavailable") return { t: ts, icon: "mdi:lan-disconnect", tone: "bad", text: "Lost contact with the tablet", sub };
      if (st === "on") return { t: ts, icon: "mdi:monitor", tone: "on", text: "Screen on", sub };
      if (st === "off") return { t: ts, icon: "mdi:monitor-off", tone: "", text: "Screen off", sub };
      return null;
    }
    if (id === I.plugged) {
      if (dead) return null;
      return st === "on" ? { t: ts, icon: "mdi:power-plug", tone: "ok", text: "Charger connected", sub }
        : { t: ts, icon: "mdi:power-plug-off", tone: "warn", text: "Charger disconnected", sub };
    }
    if (id === I.fg) {
      const app = appInfo(st);
      if (!app) return null;
      return { t: ts, icon: app.icon, tone: app.fully ? "" : "attn", text: `${app.name} in front`, sub };
    }
    if (id === I.battery) return null;
    if (id === t.plug) {
      if (dead) return null;
      return { t: ts, icon: st === "on" ? "mdi:power-plug" : "mdi:power-plug-off", tone: st === "on" ? "ok" : "warn", text: `Charger power ${st}`, sub };
    }
    if (id.startsWith("button.")) {
      if (dead) return null;
      const name = id.slice(id.indexOf(t.prefix) + t.prefix.length + 1);
      const map = {
        restart_device: ["mdi:power-cycle", "Tablet restarted", "bad"], restart_browser: ["mdi:restart", "Browser restarted", "warn"],
        load_start_url: ["mdi:refresh", "Page reloaded", ""], clear_browser_cache: ["mdi:broom", "Cache cleared", ""],
        bring_to_foreground: ["mdi:flip-to-front", "Fully brought to the front", ""], send_to_background: ["mdi:flip-to-back", "Fully sent to the background", "attn"],
      }[name];
      if (!map) return null;
      return { t: ts, icon: map[0], tone: map[2], text: map[1], sub };
    }
    if (!id && r.domain === "fully_kiosk" && r.message) {
      return { t: ts, icon: "mdi:gesture-tap", tone: "", text: `${r.name || "Tablet"} ${r.message}`, sub };
    }
    if (r.domain === "fully_kiosk" && r.message && r.name) {
      return { t: ts, icon: "mdi:gesture-tap", tone: "", text: `${r.name} ${r.message}`, sub };
    }
    return null;
  };

  /* ================================================================== */
  /* Tablet sheet / dialog                                               */
  /* ================================================================== */
  class TabletSheet extends Base {
    static get properties() {
      return {
        hass: { attribute: false },
        _tab: { state: true }, _page: { state: true }, _closing: { state: true }, _sheetY: { state: true },
        _drag: { state: true }, _toastMsg: { state: true }, _confirm: { state: true },
        _shotTs: { state: true }, _shotState: { state: true }, _shotAt: { state: true },
        _busy: { state: true }, _snap: { state: true }, _dialog: { state: true },
        _ovTs: { state: true }, _ovAt: { state: true },
        _hist: { state: true }, _range: { state: true }, _hover: { state: true },
      };
    }

    constructor() {
      super();
      this._dialog = isDialog();
      this._tab = null; // chosen once hass arrives
      this._page = "controls";
      this._closing = false;
      this._sheetY = 0;
      this._drag = null;
      this._confirm = null;
      this._busy = null;
      this._pend = {};
      this._shotTs = Date.now();
      this._shotState = "loading";
      this._shotAt = null;
      this._ovTs = Date.now();
      this._ovAt = Date.now();
      this._snap = local.ok ? local.snap() : null;
      this._hist = null;
      this._range = settings.historyHours;
      this._hover = null;
    }

    get tablets() { return tabletsOf(this.hass); }
    get single() { return this.tablets.length <= 1; }

    _pickInitialTab() {
      const list = this.tablets;
      if (!list.length) return;
      const lk = resolveLocal(this.hass);
      let saved = null;
      try { saved = localStorage.getItem(TAB_KEY); } catch (e) { /* ignore */ }
      const savedOk = list.some((t) => t.key === saved) || (saved === OVERVIEW && this._dialog && !this.single);
      this._tab = lk || (savedOk ? saved : this._dialog && !this.single ? OVERVIEW : list[0].key);
    }

    willUpdate(changed) {
      if (changed.has("hass") && this.hass && this._tab === null) {
        this._pickInitialTab();
        if (this._wanted) { const w = this._wanted; this._wanted = null; this.openTab(w.tablet, w.page); }
      }
      if (changed.has("_tab") || changed.has("_page") || changed.has("_range")) this._maybeLoadHistory();
    }

    connectedCallback() {
      super.connectedCallback();
      this.setAttribute("layout", this._dialog ? "dialog" : "sheet");
      this._timer = setInterval(() => { const h = getHass(); if (h && h !== this.hass) this.hass = h; }, 250);
      let n = 0;
      this._tick = setInterval(() => {
        n++;
        if (document.hidden || this._closing) return;
        if (local.ok && n % LOCAL_POLL_S === 0) this._snap = local.snap();
        if (n % 5 === 0) this.requestUpdate();
        if (n % settings.shotEveryS === 0 && !this._confirm && this._page === "controls") {
          if (this._tab === OVERVIEW) { this._ovTs = Date.now(); this._ovAt = Date.now(); }
          else if (this._tab !== resolveLocal(this.hass)) {
            const stuck = this._shotState === "loading" && Date.now() - this._shotTs > 20000;
            if (this._shotState !== "loading" || stuck) this._refreshShot();
          }
        }
        if (n % 60 === 0 && this._page === "history") this._maybeLoadHistory(true);
      }, 1000);
      this._mq = window.matchMedia(DIALOG_QUERY);
      this._onMq = (e) => {
        this._dialog = e.matches;
        this.setAttribute("layout", this._dialog ? "dialog" : "sheet");
        if (!this._dialog && this._tab === OVERVIEW) this._tab = resolveLocal(this.hass) || this.tablets[0]?.key || null;
        this._sheetY = 0;
      };
      this._mq.addEventListener?.("change", this._onMq);
      if (local.ok) {
        local.bindEvents();
        this._onLocal = () => (this._snap = local.snap());
        window.addEventListener("fts-local", this._onLocal);
      }
      this._onBms = () => this.requestUpdate();
      window.addEventListener("fk-state-changed", this._onBms);
      this._onKey = (e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        if (this._confirm?.progress) return;
        if (this._confirm) this._cancelConfirm(); else this.close();
      };
      window.addEventListener("keydown", this._onKey, true);
    }

    disconnectedCallback() {
      clearInterval(this._timer);
      clearInterval(this._tick);
      clearTimeout(this._tt);
      this._mq?.removeEventListener?.("change", this._onMq);
      window.removeEventListener("fts-local", this._onLocal);
      window.removeEventListener("fk-state-changed", this._onBms);
      window.removeEventListener("keydown", this._onKey, true);
      super.disconnectedCallback();
    }

    close() {
      if (this._closing) return;
      this._closing = true;
      haptic();
      if (/^#tablets?(-|$)/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
      setTimeout(() => this.remove(), 240);
    }

    openTab(key, page) {
      if (!this.hass || this._tab === null) { this._wanted = { tablet: key, page }; return; }
      if (page === "history" || page === "controls") this._page = page;
      if (key === OVERVIEW) { if (this._dialog && !this.single) this._setTab(OVERVIEW, false); return; }
      const t = key ? findTablet(this.hass, key) : null;
      if (t) this._setTab(t.key, false);
    }

    /* ---------- helpers ---------- */
    _st(id) { return id ? this.hass?.states?.[id] : undefined; }
    _call(domain, service, data, target) {
      return this.hass.callService(domain, service, data, target).then(() => true, (err) => {
        console.warn(TAG, domain, service, err);
        this._toast(err?.message || `${service.replace(/_/g, " ")} failed`);
        return false;
      });
    }
    _toast(msg) {
      this._toastMsg = msg;
      clearTimeout(this._tt);
      this._tt = setTimeout(() => (this._toastMsg = null), 2600);
    }
    _setTab(key, feel = true) {
      if (key === this._tab) return;
      if (feel) haptic("selection");
      this._tab = key;
      this._confirm = null;
      this._hover = null;
      if (key === OVERVIEW) { this._ovTs = Date.now(); this._ovAt = Date.now(); this._page = "controls"; }
      else { this._shotAt = null; this._refreshShot(); }
      try { localStorage.setItem(TAB_KEY, key); } catch (e) { /* ignore */ }
      this.renderRoot?.querySelector(".body")?.scrollTo?.({ top: 0 });
    }
    _setPage(p) {
      if (p === this._page) return;
      haptic("selection");
      this._page = p;
      this._confirm = null;
      this._hover = null;
      this.renderRoot?.querySelector(".body")?.scrollTo?.({ top: 0 });
    }
    _order() {
      const list = this.tablets;
      const me = list.find((t) => t.key === resolveLocal(this.hass));
      return me ? [me, ...list.filter((t) => t !== me)] : list;
    }
    _current() { return this.tablets.find((t) => t.key === this._tab) || null; }
    _battery(t) {
      if (t.key === resolveLocal(this.hass) && this._snap && Number.isFinite(Number(this._snap.battery))) {
        return { level: Number(this._snap.battery), charging: !!this._snap.plugged };
      }
      const I = ids(t.prefix);
      const level = parseFloat(this._st(I.battery)?.state);
      if (isNaN(level)) return null;
      return { level, charging: this._st(I.plugged)?.state === "on" };
    }

    /* held optimistically until the tablet reports back */
    _held(key, real, ttl = 6000) {
      const p = this._pend[key];
      if (p) {
        if (Date.now() - p.ts < ttl && p.v !== real) return p.v;
        delete this._pend[key];
      }
      return real;
    }
    _screenOn(I) { return this._held(`scr:${I.screen}`, this._st(I.screen)?.state === "on"); }
    _localOn() { return this._held("lscr", this._snap?.screenOn !== false, 3000); }
    _status(t) {
      if (t.key === resolveLocal(this.hass) && this._snap) return this._localOn() ? "on" : "off";
      const I = ids(t.prefix);
      const st = this._st(I.screen);
      if (!st || DEAD.includes(st.state)) return "offline";
      return this._screenOn(I) ? "on" : "off";
    }

    /* ---------- history ---------- */
    _maybeLoadHistory(silent = false) {
      if (this._page !== "history" || !this.hass) return;
      const t = this._current();
      if (!t) return;
      const key = `${t.key}:${this._range}`;
      if (this._hist?.key === key && this._hist.loading) return;
      if (!silent && this._hist?.key === key && this._hist.data && Date.now() - this._hist.data.at < 30000) return;
      const keep = this._hist?.key === key ? this._hist.data : null;
      this._hist = { key, loading: true, data: keep, error: null };
      loadHistory(this.hass, t, this._range).then(
        (data) => { if (this._hist?.key === key) this._hist = { key, loading: false, data, error: null }; },
        (err) => { if (this._hist?.key === key) this._hist = { key, loading: false, data: keep, error: err?.message || "Couldn't load history" }; });
    }
    _setRange(h) { if (h !== this._range) { haptic("selection"); this._range = h; this._hover = null; } }

    /* ---------- confirmation ---------- */
    _askPlug(t) {
      const st = this._st(t.plug);
      if (!st || st.state === "unavailable") { haptic("failure"); this._toast("The charger plug isn't reachable right now"); return; }
      const self = t.key === resolveLocal(this.hass);
      this._ask({
        icon: "mdi:power-plug", title: `Power cycle the ${t.name} charger?`,
        text: `The plug switches off for ${settings.plugOffS} seconds, then back on. ${self ? "This tablet" : "The tablet"} keeps running on its battery meanwhile.`,
        go: "Power cycle",
      }, () => this._cyclePlug(t));
    }
    _cyclePlug(t) {
      const key = `${t.key}:plug`;
      this._busy = key;
      this._call("switch", "turn_off", { entity_id: t.plug }).then((ok) => {
        if (!ok) { haptic("failure"); this._busy = null; return; }
        this._toast(`${t.name} charger off for ${settings.plugOffS} seconds`);
        logAction(this.hass, t, "charger power cycled");
        const fallback = this.hass;
        setTimeout(() => {
          const h = getHass() || fallback;
          h.callService("switch", "turn_on", { entity_id: t.plug }).then(
            () => { haptic("success"); this._toast(`${t.name} charger back on`); },
            () => { haptic("failure"); this._toast(`Couldn't turn the ${t.name} charger back on`); });
          if (this._busy === key) this._busy = null;
        }, settings.plugOffS * 1000);
      });
    }
    _plugRow(t) {
      if (!t?.plug) return "";
      const st = this._st(t.plug);
      const on = st?.state === "on";
      const dead = !st || st.state === "unavailable";
      const busy = this._busy === `${t.key}:plug`;
      const sub = busy ? "Power cycling…" : dead ? "Plug unavailable" : on ? "On" : settings.chargerOffNote || "Off";
      return html`
        <div class="plug-row">
          <div class="row-icon ${on && !busy ? "on" : ""}"><ha-icon .icon=${on && !busy ? "mdi:power-plug" : "mdi:power-plug-off"}></ha-icon></div>
          <div class="row-text">
            <span class="row-title">Charger power</span>
            <span class="row-sub">${sub}</span>
          </div>
          <button class="pill-btn" ?disabled=${dead || busy} @click=${() => this._askPlug(t)}>
            <ha-icon class=${busy ? "spin" : ""} .icon=${busy ? "mdi:loading" : "mdi:power-cycle"}></ha-icon>Power cycle</button>
        </div>`;
    }

    _ask(c, run) { haptic("warning"); this._confirm = { ...c, run, tab: this._tab }; }
    _cancelConfirm() { if (this._confirm?.progress) return; haptic("selection"); this._confirm = null; }
    _go() {
      const c = this._confirm;
      if (!c || c.progress) return;
      this._confirm = null;
      haptic("heavy");
      c.run();
    }

    /* ---------- remote (HA) actions ---------- */
    _toggleScreen(t, I) {
      const on = this._screenOn(I);
      haptic("light");
      const k = `scr:${I.screen}`;
      this._pend[k] = { v: !on, ts: Date.now() };
      this.requestUpdate();
      setTimeout(() => this.requestUpdate(), 6100);
      this._call("switch", on ? "turn_off" : "turn_on", { entity_id: I.screen }).then((ok) => {
        if (!ok) { delete this._pend[k]; haptic("failure"); this.requestUpdate(); return; }
        logAction(this.hass, t, `screen turned ${on ? "off" : "on"}`);
        setTimeout(() => (this._tab === OVERVIEW ? (this._ovTs = Date.now()) : this._refreshShot()), 1500);
      });
    }
    _press(t, entity, busyKey, doneMsg, tapFeel = true) {
      const st = this._st(entity);
      if (!st || st.state === "unavailable") { haptic("failure"); this._toast("This tablet isn't reachable right now"); return; }
      if (tapFeel) haptic("light");
      this._busy = busyKey;
      this._call("button", "press", { entity_id: entity }).then((ok) => {
        setTimeout(() => { if (this._busy === busyKey) this._busy = null; }, 1200);
        if (!ok) { haptic("failure"); return; }
        haptic("success");
        this._toast(doneMsg);
        if (!busyKey.endsWith(":reboot")) setTimeout(() => this._refreshShot(), 3500);
      });
    }

    /* ---------- local (native) actions ---------- */
    _snapSoon() { setTimeout(() => (this._snap = local.snap()), 300); }
    _localDo(t, fn, doneMsg, feel = true, ...args) {
      if (!local.has(fn)) { haptic("failure"); this._toast("Fully doesn't allow that on this tablet"); return; }
      if (feel) haptic("light");
      local.call(fn, ...args);
      haptic("success");
      if (doneMsg) { this._toast(doneMsg); logAction(this.hass, t, `${doneMsg.toLowerCase()} (from the tablet)`); }
      this._snapSoon();
    }
    _localScreen(t) {
      const on = this._localOn();
      if (on) {
        this._ask({
          icon: "mdi:monitor-off", title: "Turn off this screen?",
          text: "It stays dark until motion wakes it or it's turned back on from Home Assistant.",
          go: "Turn off",
        }, () => { this._pend.lscr = { v: false, ts: Date.now() }; this._localDo(t, "turnScreenOff", null, false); logAction(this.hass, t, "screen turned off (from the tablet)"); });
      } else {
        this._pend.lscr = { v: true, ts: Date.now() };
        this._localDo(t, "turnScreenOn", null);
        logAction(this.hass, t, "screen turned on (from the tablet)");
      }
    }
    _localBrightness(v) {
      const raw = Math.round((v / 100) * 255);
      local.call("setScreenBrightness", raw);
      window.dispatchEvent(new CustomEvent("brightness_override", { detail: { brightness: raw } }));
      this._snapSoon();
    }
    _wifiSequence(t) {
      this._confirm = { progress: true, icon: "mdi:wifi-refresh", title: "Reconnecting Wi-Fi", text: "Turning Wi-Fi off…", tab: this._tab };
      local.call("disableWifi");
      logAction(this.hass, t, "Wi-Fi reconnected (from the tablet)");
      for (let i = 1; i < 5; i++) {
        setTimeout(() => {
          if (this._confirm?.progress) this._confirm = { ...this._confirm, text: `Waiting ${5 - i} second${5 - i > 1 ? "s" : ""}…` };
        }, i * 1000);
      }
      setTimeout(() => {
        local.call("enableWifi");
        if (this._confirm?.progress) this._confirm = { ...this._confirm, text: "Turning Wi-Fi back on…" };
      }, 5000);
      setTimeout(() => {
        if (!this._confirm?.progress) return;
        this._confirm = null;
        haptic("success");
        this._toast("Wi-Fi is back on and reconnecting");
      }, 6500);
    }

    /* ---------- screenshot ---------- */
    _refreshShot(manual = false) {
      if (manual) haptic("light");
      this._shotTs = Date.now();
      this._shotState = "loading";
    }
    _refreshOverview() { haptic("light"); this._ovTs = Date.now(); this._ovAt = Date.now(); }
    _shotUrl(I, ts = this._shotTs) {
      const pic = this._st(I.shot)?.attributes?.entity_picture;
      if (!pic) return null;
      return `${pic}${pic.includes("?") ? "&" : "?"}_t=${ts}`;
    }
    _onShotLoad = () => { this._shotState = "ok"; this._shotAt = Date.now(); };
    _onShotError = () => { this._shotState = "error"; };

    /* ---------- swipe to close (sheet only) ---------- */
    _hDown = (e) => { if (this._dialog) return; this._sd = { y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); };
    _hMove = (e) => { if (this._sd) this._sheetY = Math.max(0, e.clientY - this._sd.y); };
    _hUp = () => {
      if (!this._sd) return;
      this._sd = null;
      if (this._sheetY > 90) this.close(); else this._sheetY = 0;
    };

    /* ---------- slider (tile-card style) ---------- */
    _shown(key, value) {
      if (this._drag?.key === key) return this._drag.value;
      const p = this._pend[key];
      if (p) {
        if (Date.now() - p.ts < 5000 && Math.abs(p.v - (value ?? -999)) > 1) return p.v;
        delete this._pend[key];
      }
      return value;
    }
    _slider({ key, label, value, min = 0, max = 100, step = 1, disabled = false, onCommit, onInput }) {
      const v = this._shown(key, value);
      const pct = v == null ? 0 : ((v - min) / (max - min)) * 100;
      return html`
        <div class="slider ${disabled ? "disabled" : ""} ${this._drag?.key === key ? "dragging" : ""}"
          role="slider" aria-label=${label} aria-valuemin=${min} aria-valuemax=${max} aria-valuenow=${v ?? min}
          @pointerdown=${(e) => this._sDown(e, { key, min, max, step, disabled, onCommit, onInput, value: v })}
          @pointermove=${(e) => this._sMove(e)}
          @pointerup=${(e) => this._sUp(e)}
          @pointercancel=${() => (this._drag = null)}>
          <div class="fill ${pct <= 0 ? "empty" : ""}" style="--v:${Math.max(0, Math.min(1, pct / 100))}"></div>
        </div>`;
    }
    _sVal(e, d) {
      const r = d.el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const v = Math.round((d.min + f * (d.max - d.min)) / d.step) * d.step;
      return Math.min(d.max, Math.max(d.min, v));
    }
    _sDown(e, o) {
      if (o.disabled) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      this._drag = { ...o, el: e.currentTarget, startX: e.clientX, moved: false, value: o.value ?? o.min };
    }
    _sMove(e) {
      const d = this._drag;
      if (!d) return;
      if (!d.moved && Math.abs(e.clientX - d.startX) < 4) return;
      d.moved = true;
      const v = this._sVal(e, d);
      if (v !== d.value) {
        if (Math.floor(v / 5) !== Math.floor(d.value / 5)) haptic("selection");
        this._drag = { ...d, value: v };
        d.onInput?.(v);
      }
    }
    _sUp(e) {
      const d = this._drag;
      if (!d) return;
      const v = d.moved ? d.value : this._sVal(e, d);
      this._drag = null;
      this._pend[d.key] = { v, ts: Date.now() };
      setTimeout(() => this.requestUpdate(), 5100);
      haptic("light");
      d.onCommit(v);
    }
