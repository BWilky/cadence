
  /* ================================================================== */
  /* Button card                                                         */
  /* ================================================================== */
  class TabletSheetButton extends Base {
    static get properties() { return { hass: { attribute: false }, _config: { state: true }, _snap: { state: true } }; }
    setConfig(config) {
      configure(config || {});
      this._config = { title: "Tablet Controls", icon: "mdi:tablet-dashboard", ...(config || {}) };
    }
    getCardSize() { return 1; }
    getGridOptions() { return { columns: 6, rows: 1, min_columns: 3, min_rows: 1 }; }
    static getStubConfig() { return { title: "Tablet Controls", icon: "mdi:tablet-dashboard" }; }

    connectedCallback() {
      super.connectedCallback();
      if (!local.ok) return;
      this._snap = local.snap();
      this._poll = setInterval(() => { if (!document.hidden) this._snap = local.snap(); }, 5000);
    }
    disconnectedCallback() { clearInterval(this._poll); super.disconnectedCallback(); }
    firstUpdated() {
      gestures(this.renderRoot.querySelector("ha-card"), {
        onTap: () => { if (!allowedHere(this.hass)) return; haptic("light"); if (!runAction(this, this.hass, this._config.tap_action, this._tablet())) this._open(); },
        onHold: () => { if (!allowedHere(this.hass)) return false; return runAction(this, this.hass, this._config.hold_action, this._tablet()) || (this._open("history"), true); },
      });
    }
    _tablet() { return tabletFor(this.hass, this._config); }
    _open(page) { window.openTabletSheet({ from: this, tablet: this._config.tablet, page: page || this._config.page }); }

    render() {
      if (!this._config) return html``;
      const allowed = allowedHere(this.hass);
      const t = this._tablet();
      const s = this._snap;
      let sub = this._config.subtitle || "Screens, brightness and restarts";
      let icon = this._config.icon;
      let charging = false;
      if (s) {
        sub = Number.isFinite(Number(s.battery)) ? `${Math.round(s.battery)}%, ${s.plugged ? "charging" : "on battery"}` : sub;
        charging = !!s.plugged;
      } else if (t && this.hass && this._config.show_state !== false) {
        const st = stateOf(this.hass, t);
        if (!st.online) sub = `${t.name} offline`;
        else sub = [st.level != null ? `${Math.round(st.level)}%` : null, st.charging ? "charging" : null, st.on ? "screen on" : "screen off"].filter(Boolean).join(", ");
        charging = st.charging;
      }
      if (charging && !this._config.icon) icon = "mdi:tablet-cellphone";
      return html`
        <ha-card class=${allowed ? "tap" : ""} tabindex=${allowed ? "0" : "-1"} role=${allowed ? "button" : "presentation"}>
          <div class="ic ${charging ? "charging" : ""}"><ha-icon .icon=${icon}></ha-icon></div>
          <div class="tx">
            <span class="p">${this._config.title}</span>
            ${sub ? html`<span class="s">${sub}</span>` : ""}
          </div>
        </ha-card>`;
    }

    static get styles() {
      return css`
        :host { display: block; height: 100%; }
        ha-card { height: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 12px; padding: 12px;
          -webkit-tap-highlight-color: transparent; transition: transform .1s ease, background-color .2s ease; user-select: none; }
        ha-card.tap { cursor: pointer; }
        ha-card.tap:active { transform: scale(.98); }
        ha-card:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
        .ic { width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
          color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 18%, transparent); }
        .ic.charging { color: var(--success-color, #43a047); background: color-mix(in srgb, var(--success-color, #43a047) 18%, transparent); }
        .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .p { font-weight: 600; font-size: 14px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .s { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      `;
    }
  }
  if (!customElements.get("fully-tablet-sheet-button")) customElements.define("fully-tablet-sheet-button", TabletSheetButton);

  /* ================================================================== */
  /* Chip (Mushroom-style)                                               */
  /* ================================================================== */
  const COLORS = {
    red: "244, 67, 54", pink: "233, 30, 99", purple: "156, 39, 176", "deep-purple": "103, 58, 183", indigo: "63, 81, 181",
    blue: "33, 150, 243", "light-blue": "3, 169, 244", cyan: "0, 188, 212", teal: "0, 150, 136", green: "76, 175, 80",
    "light-green": "139, 195, 74", lime: "205, 220, 57", yellow: "255, 235, 59", amber: "255, 193, 7", orange: "255, 152, 0",
    "deep-orange": "255, 87, 34", brown: "121, 85, 72", grey: "158, 158, 158", "blue-grey": "96, 125, 139", black: "0, 0, 0", white: "255, 255, 255",
  };
  const rgbOf = (c) => {
    if (!c) return null;
    if (COLORS[c]) return COLORS[c];
    if (/^\d+\s*,\s*\d+\s*,\s*\d+$/.test(c)) return c;
    const m = String(c).match(/^#?([0-9a-f]{6})$/i);
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).join(", ");
    return null;
  };

  const CHIP_KINDS = ["status", "screen", "battery", "history", "app", "open", "charger"];
  class TabletChip extends Base {
    static get properties() { return { hass: { attribute: false }, _config: { state: true }, _tick: { state: true }, _busy: { state: true } }; }
    setConfig(config) {
      const cfg = { chip: "status", ...(config || {}) };
      if (cfg.type && !config?.chip) { // type: custom:fully-tablet-chip-app style aliases
        const m = String(cfg.type).match(/fully-tablet-chip-(\w+)/);
        if (m && CHIP_KINDS.includes(m[1])) cfg.chip = m[1];
      }
      if (cfg.app_package && !config?.chip) cfg.chip = "app";
      if (!CHIP_KINDS.includes(cfg.chip)) throw new Error(`fully-tablet-chip: unknown chip "${cfg.chip}" (use ${CHIP_KINDS.join(", ")})`);
      if (cfg.chip === "app" && !cfg.app_package) throw new Error("fully-tablet-chip: an app chip needs app_package (e.g. com.spotify.music)");
      configure(cfg);
      this._config = cfg;
    }
    getCardSize() { return 1; }
    getGridOptions() { return { columns: 3, rows: 1, min_columns: 2, min_rows: 1 }; }
    static getStubConfig() { return { chip: "status" }; }

    connectedCallback() {
      super.connectedCallback();
      if (local.ok) this._poll = setInterval(() => { if (!document.hidden) this._tick = Date.now(); }, 5000);
    }
    disconnectedCallback() { clearInterval(this._poll); super.disconnectedCallback(); }
    firstUpdated() {
      gestures(this.renderRoot.querySelector(".chip"), {
        onTap: () => this._tap(),
        onHold: () => this._hold(),
      });
    }

    _tablet() { return tabletFor(this.hass, this._config); }
    _tap() {
      const t = this._tablet();
      const c = this._config;
      if (runAction(this, this.hass, c.tap_action, t)) return;
      if (!allowedHere(this.hass) && c.chip !== "app" && c.chip !== "screen") { haptic("failure"); return; }
      haptic("light");
      switch (c.chip) {
        case "screen": {
          if (!t) return;
          const st = stateOf(this.hass, t);
          if (!st.online) { haptic("failure"); return; }
          this._busy = true;
          setScreen(this.hass, t, !st.on).then((ok) => { this._busy = false; haptic(ok ? "success" : "failure"); });
          return;
        }
        case "app": {
          if (!t) { haptic("failure"); return; }
          this._busy = true;
          launchApp(this.hass, t, c.app_package).then((ok) => { this._busy = false; haptic(ok ? "success" : "failure"); });
          return;
        }
        case "charger": {
          if (!t?.plug) { haptic("failure"); return; }
          window.openTabletSheet({ from: this, tablet: t.key, page: "controls" });
          return;
        }
        case "history": window.openTabletSheet({ from: this, tablet: t?.key, page: "history" }); return;
        case "battery": window.openTabletSheet({ from: this, tablet: t?.key, page: "history" }); return;
        case "open": window.openTabletSheet({ from: this, tablet: c.tablet, page: c.page }); return;
        default: window.openTabletSheet({ from: this, tablet: t?.key, page: c.page || "controls" });
      }
    }
    _hold() {
      const t = this._tablet();
      if (runAction(this, this.hass, this._config.hold_action, t)) return true;
      if (!allowedHere(this.hass)) return false;
      if (this._config.chip === "app" && t) { // hold on an app chip brings Fully back to the front
        const I = ids(t.prefix);
        if (t.key === resolveLocal(this.hass) && local.has("bringToForeground")) local.call("bringToForeground");
        else if (this.hass.states?.[I.btn("bring_to_foreground")]) this.hass.callService("button", "press", { entity_id: I.btn("bring_to_foreground") });
        return true;
      }
      window.openTabletSheet({ from: this, tablet: t?.key, page: this._config.chip === "history" ? "controls" : "history" });
      return true;
    }

    render() {
      if (!this._config) return html``;
      const c = this._config;
      const t = this._tablet();
      const st = t && this.hass ? stateOf(this.hass, t) : null;
      let icon = c.icon, color = c.icon_color, text = c.content, tone = "";
      const low = st && st.level != null && st.level < 20 && !st.charging;
      const want = Array.isArray(c.show) ? c.show : ["battery", "screen"];
      switch (c.chip) {
        case "status": {
          icon = icon || (st?.charging ? "mdi:tablet-cellphone" : "mdi:tablet");
          if (!t) { text = text ?? "No tablet"; color = color || "grey"; break; }
          if (!st.online) { text = text ?? `${c.name || t.short} offline`; color = color || "red"; break; }
          const bits = [];
          if (c.name) bits.push(c.name);
          if (want.includes("battery") && st.level != null) bits.push(`${Math.round(st.level)}%`);
          if (want.includes("screen")) bits.push(st.on ? "On" : "Off");
          if (want.includes("app") && st.app && !st.app.fully) bits.push(st.app.name);
          text = text ?? bits.join(" · ");
          color = color || (low ? "red" : st.charging ? "green" : st.on ? "blue" : "grey");
          break;
        }
        case "screen": {
          icon = icon || (st?.on ? "mdi:monitor" : "mdi:monitor-off");
          text = text ?? (!st ? "" : !st.online ? "Offline" : st.on ? (c.name || "Screen on") : (c.name || "Screen off"));
          color = color || (!st?.online ? "red" : st.on ? "blue" : "grey");
          break;
        }
        case "battery": {
          icon = icon || batteryIcon(st?.level, st?.charging);
          text = text ?? (st?.level != null ? `${Math.round(st.level)}%` : "—");
          color = color || (low ? "red" : st?.charging ? "green" : "grey");
          break;
        }
        case "charger": {
          const plug = t?.plug ? this.hass?.states?.[t.plug] : null;
          icon = icon || (plug?.state === "on" ? "mdi:power-plug" : "mdi:power-plug-off");
          text = text ?? (!plug ? "No plug" : plug.state === "on" ? (c.name || "Charger on") : (c.name || "Charger off"));
          color = color || (plug?.state === "on" ? "green" : "amber");
          break;
        }
        case "history": icon = icon || "mdi:chart-timeline-variant"; text = text ?? (c.name || "History"); color = color || "grey"; break;
        case "app": {
          const info = appInfo(c.app_package);
          icon = icon || info?.icon || "mdi:application-outline";
          text = text ?? (c.name || info?.name || c.app_package);
          const inFront = st?.app?.pkg === c.app_package;
          color = color || (inFront ? "green" : "blue");
          if (inFront && c.show_state !== false) tone = "front";
          break;
        }
        default: icon = icon || "mdi:tablet-dashboard"; text = text ?? (c.name || "Tablets"); color = color || "blue";
      }
      const rgb = rgbOf(color);
      const style = rgb ? `--chip-icon-rgb:${rgb};` : "";
      return html`
        <div class="chip ${tone} ${this._busy ? "busy" : ""} ${text ? "" : "icon-only"}" style=${style} role="button" tabindex="0" aria-label=${text || c.chip}>
          <span class="ic"><ha-icon .icon=${this._busy ? "mdi:loading" : icon} class=${this._busy ? "spin" : ""}></ha-icon></span>
          ${text ? html`<span class="tx">${text}</span>` : ""}
        </div>`;
    }

    static get styles() {
      return css`
        :host { display: inline-flex; vertical-align: middle; --chip-h: var(--chip-height, 36px); }
        .chip { display: inline-flex; align-items: center; gap: 6px; height: var(--chip-h); padding: 0 12px 0 10px; border-radius: var(--chip-border-radius, calc(var(--chip-h) / 2));
          background: var(--chip-background, var(--ha-card-background, var(--card-background-color, #fff)));
          border: var(--chip-border-width, var(--ha-card-border-width, 1px)) solid var(--chip-border-color, var(--ha-card-border-color, var(--divider-color, rgba(0,0,0,.12))));
          box-shadow: var(--chip-box-shadow, var(--ha-card-box-shadow, none)); color: var(--primary-text-color);
          font-size: var(--chip-font-size, 14px); font-weight: var(--chip-font-weight, 500); line-height: 1; white-space: nowrap;
          cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent; transition: transform .1s ease, background .15s ease; }
        .chip.icon-only { padding: 0 10px; }
        .chip:active { transform: scale(.96); }
        .chip:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
        .ic { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; color: rgb(var(--chip-icon-rgb, var(--rgb-primary-text-color, 33, 33, 33))); }
        .ic ha-icon { --mdc-icon-size: var(--chip-icon-size, 20px); }
        .tx { max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
        .chip.front .tx { color: rgb(var(--chip-icon-rgb)); }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `;
    }
  }
  if (!customElements.get("fully-tablet-chip")) customElements.define("fully-tablet-chip", TabletChip);
  for (const k of CHIP_KINDS) { // type: custom:fully-tablet-chip-app etc.
    const tag = `fully-tablet-chip-${k}`;
    if (!customElements.get(tag)) customElements.define(tag, class extends TabletChip { setConfig(c) { super.setConfig({ ...(c || {}), chip: k }); } });
  }

  /* ================================================================== */
  /* Chips row card                                                      */
  /* ================================================================== */
  class TabletChips extends Base {
    static get properties() { return { hass: { attribute: false }, _config: { state: true } }; }
    setConfig(config) {
      if (!config || !Array.isArray(config.chips) || !config.chips.length) {
        this._config = { ...(config || {}), chips: [{ chip: "status" }, { chip: "screen" }, { chip: "history" }] };
      } else this._config = config;
      configure(this._config);
      this._els = null;
    }
    getCardSize() { return 1; }
    getGridOptions() { return { columns: "full", rows: 1, min_rows: 1 }; }
    static getStubConfig() { return { chips: [{ chip: "status" }, { chip: "screen" }, { chip: "history" }] }; }

    _buildChips() {
      const base = { tablet: this._config.tablet, show: this._config.show, name: undefined };
      this._els = this._config.chips.map((raw) => {
        const cfg = typeof raw === "string" ? { chip: raw } : { ...raw };
        if (cfg.tablet === undefined && base.tablet) cfg.tablet = base.tablet;
        if (cfg.show === undefined && base.show) cfg.show = base.show;
        const el = document.createElement("fully-tablet-chip");
        try { el.setConfig(cfg); } catch (err) {
          const e = document.createElement("div");
          e.textContent = err.message;
          e.style.cssText = "font-size:12px;color:var(--error-color)";
          return e;
        }
        return el;
      });
    }
    render() {
      if (!this._config) return html``;
      if (!this._els) this._buildChips();
      this._els.forEach((el) => { if ("hass" in el || el.localName === "fully-tablet-chip") el.hass = this.hass; });
      return html`<div class="row ${this._config.alignment || "start"}">${this._els}</div>`;
    }
    static get styles() {
      return css`
        :host { display: block; }
        .row { display: flex; flex-wrap: wrap; gap: var(--chip-spacing, 8px); align-items: center; }
        .row.center { justify-content: center; }
        .row.end { justify-content: flex-end; }
        .row.justify { justify-content: space-between; }
      `;
    }
  }
  if (!customElements.get("fully-tablet-chips")) customElements.define("fully-tablet-chips", TabletChips);

  /* ---------- card picker ---------- */
  window.customCards = window.customCards || [];
  const add = (type, name, description) => { if (!window.customCards.some((c) => c.type === type)) window.customCards.push({ type, name, description, preview: false }); };
  add("fully-tablet-sheet-button", "Fully tablet sheet button", "Tile that opens the Fully Kiosk tablet sheet: screens, brightness, restarts, history.");
  add("fully-tablet-chips", "Fully tablet chips", "A row of Mushroom-style chips for a Fully Kiosk tablet: status, screen, battery, history, app launchers.");
  add("fully-tablet-chip", "Fully tablet chip", "One chip for a Fully Kiosk tablet. Also usable inside mushroom-chips-card as type: custom:fully-tablet-chip.");

  console.info(`%c FULLY-TABLET-SHEET %c v${VERSION} `,
    "background:#3d6fb6;color:#fff;border-radius:4px 0 0 4px;padding:2px 6px",
    "background:#555;color:#fff;border-radius:0 4px 4px 0;padding:2px 6px");
})();
