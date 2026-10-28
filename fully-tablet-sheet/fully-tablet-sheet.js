/**
 * fully-tablet-sheet — Fully Kiosk Browser tablet controls for Home Assistant
 * ---------------------------------------------------------------------------
 * One resource, four pieces:
 *
 *   fully-tablet-sheet          the sheet itself. Phones (< 768 px) get a bottom
 *                               sheet, tablets and desktops a centred dialog
 *                               with a sidebar. Each tablet has two pages:
 *                               Controls (screenshot, screen, brightness,
 *                               browser actions, charger, restart) and History
 *                               (screen on/off timeline, battery curve, charger
 *                               bands, activity log).
 *   fully-tablet-sheet-button   a tile-style card that opens the sheet.
 *   fully-tablet-chip           a Mushroom-style chip. Kinds: status, screen,
 *                               battery, history, app (launches an Android app
 *                               on the tablet), open.
 *   fully-tablet-chips          a row of those chips (no Mushroom needed; the
 *                               chip also works inside mushroom-chips-card as
 *                               type: custom:fully-tablet-chip).
 *
 * Tablets come from the Home Assistant fully_kiosk integration. Leave `tablets:`
 * out and every Fully Kiosk device is discovered; list them to pick names,
 * order, a charger smart plug and the tablets the sheet may open on. One tablet
 * is fine: the tab row and the Overview disappear.
 *
 * Hybrid control
 *   - On a phone or desktop every tablet goes through the integration.
 *   - Inside Fully Kiosk (PLUS + "Enable JavaScript Interface") the sheet works
 *     out which tablet it is on (MAC, then Fully device ID, then IP, then device
 *     name, matched against the HA device registry). That tablet is driven
 *     natively through window.fully; the others still go through HA.
 *
 * Open it from anywhere:
 *   - a chip or the button card
 *   - a hash:  #tablets  #tablet-<key>  #tablet-<key>-history  #tablets-history
 *              (any tile/button with tap_action: navigate, navigation_path: "#tablets")
 *   - JS:      window.openTabletSheet({ tablet: "kitchen", page: "history" })
 *              window.dispatchEvent(new CustomEvent("tablet-sheet-open", { detail: { tablet: "kitchen" } }))
 *
 * Battery management hooks (optional, for a Fully-side script): reads
 * window.fk_tablet_state (+ "fk-state-changed"), sends "brightness_override"
 * { brightness: 0-255 } after a manual brightness change and
 * "pauseadaptivebrightness" for the pause button.
 *
 * Plain JS, no build step: Lit comes from the HA frontend at runtime.
 * Source: https://github.com/BWilky/fully-tablet-sheet
 */
(async () => {
  if (window.__fullyTabletSheet) return;
  window.__fullyTabletSheet = true;
  const VERSION = "1.0.0";
  const TAG = "[fully-tablet-sheet]";

  /* ---------- Lit from the HA frontend ---------- */
  const HOSTS = ["ha-panel-lovelace", "hc-lovelace", "hui-view", "ha-panel-config"];
  await Promise.race(HOSTS.map((n) => customElements.whenDefined(n)));
  const findBase = () => {
    for (const n of HOSTS) {
      let k = customElements.get(n);
      while (k && k !== HTMLElement) {
        const p = k.prototype;
        if (p && Object.getOwnPropertyDescriptor(p, "html") && Object.getOwnPropertyDescriptor(p, "css")) return k;
        k = Object.getPrototypeOf(k);
      }
    }
    const k = customElements.get("ha-panel-lovelace") || customElements.get("hc-lovelace");
    return k ? Object.getPrototypeOf(k) : null;
  };
  const Base = findBase();
  if (!Base?.prototype?.html) { console.error(TAG, "could not find Lit in the Home Assistant frontend"); return; }
  const html = Base.prototype.html;
  const css = Base.prototype.css;

  /* ================================================================== */
  /* Configuration + tablet registry                                     */
  /* ================================================================== */
  const DEAD = ["unavailable", "unknown"];
  const OVERVIEW = "overview";
  const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  const settings = {
    tablets: null,          // configured list (normalised) or null = discover
    allowOn: null,          // keys the sheet may open on inside Fully; null = all
    plugOffS: 5,
    chargerOffNote: null,   // text under "Charger power" when the plug is off
    apps: {},               // extra package -> [name, icon]
    logActions: true,       // write sheet actions to the HA logbook
    historyHours: 24,
    shotEveryS: 15,
  };

  /* "Galaxy Tab Office" -> "Office", "TabletKitchen" -> "TabletKitchen" */
  const shortName = (name) => {
    if (name.length <= 12) return name;
    const words = name.split(/\s+/);
    const rest = words.filter((w) => !/^(tablet|galaxy|tab|lenovo|samsung|fire|kiosk|fully)$/i.test(w));
    return (rest.length ? rest : words)[0];
  };
  const normTablet = (raw, i) => {
    if (!raw) return null;
    if (typeof raw === "string") raw = { prefix: raw };
    let prefix = raw.prefix || raw.entity_prefix;
    const ent = raw.screen_entity || raw.entity;
    if (!prefix && ent && /^switch\..+_screen$/.test(ent)) prefix = ent.slice(7, -7);
    if (!prefix) { console.warn(TAG, "tablet without prefix ignored", raw); return null; }
    const name = raw.name || prefix.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const key = slug(raw.key || raw.name || prefix) || `tablet_${i}`;
    return { key, name, short: raw.short || shortName(name), prefix, plug: raw.plug || raw.charger || null, icon: raw.icon || null };
  };

  const configure = (cfg = {}) => {
    if (Array.isArray(cfg.tablets) && cfg.tablets.length) {
      settings.tablets = cfg.tablets.map(normTablet).filter(Boolean);
      discoverCache = null;
    }
    if (Array.isArray(cfg.allow_on)) settings.allowOn = cfg.allow_on.map(slug);
    if (Number.isFinite(Number(cfg.plug_off_seconds))) settings.plugOffS = Math.max(1, Number(cfg.plug_off_seconds));
    if (typeof cfg.charger_off_note === "string") settings.chargerOffNote = cfg.charger_off_note;
    if (cfg.apps && typeof cfg.apps === "object") {
      for (const [pkg, v] of Object.entries(cfg.apps)) {
        if (typeof v === "string") settings.apps[pkg] = [v, "mdi:application-outline"];
        else if (v && typeof v === "object") settings.apps[pkg] = [v.name || pkg, v.icon || "mdi:application-outline"];
      }
    }
    if (typeof cfg.log_actions === "boolean") settings.logActions = cfg.log_actions;
    if (Number.isFinite(Number(cfg.history_hours))) settings.historyHours = Number(cfg.history_hours);
    if (Number.isFinite(Number(cfg.screenshot_seconds))) settings.shotEveryS = Math.max(5, Number(cfg.screenshot_seconds));
  };

  /* Discovery: every fully_kiosk device = a switch.<prefix>_screen entity */
  let discoverCache = null;
  const discover = (hass) => {
    if (settings.tablets) return settings.tablets;
    const reg = hass?.entities;
    if (!reg) return discoverCache?.list || [];
    if (discoverCache && discoverCache.reg === reg) return discoverCache.list;
    const list = [];
    for (const id of Object.keys(reg)) {
      const e = reg[id];
      if (e?.platform !== "fully_kiosk" || !id.startsWith("switch.") || !id.endsWith("_screen")) continue;
      const prefix = id.slice(7, -7);
      const dev = hass.devices?.[e.device_id];
      const name = dev?.name_by_user || dev?.name || prefix;
      list.push(normTablet({ prefix, name, key: prefix }, list.length));
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    discoverCache = { reg, list };
    return list;
  };
  const tabletsOf = (hass) => discover(hass);
  const findTablet = (hass, ref) => {
    const list = tabletsOf(hass);
    if (!ref) return null;
    const r = String(ref).toLowerCase();
    return list.find((t) => t.key === r || t.prefix === r || t.name.toLowerCase() === r || slug(r) === t.key) || null;
  };

  const ids = (p) => ({
    shot: `image.${p}_screenshot`,
    screen: `switch.${p}_screen`,
    bright: `number.${p}_screen_brightness`,
    battery: `sensor.${p}_battery`,
    plugged: `binary_sensor.${p}_plugged_in`,
    page: `sensor.${p}_current_page`,
    orient: `sensor.${p}_screen_orientation`,
    reboot: `button.${p}_restart_device`,
    fg: `sensor.${p}_foreground_app`,
    btn: (name) => `button.${p}_${name}`,
  });
  const deviceIdOf = (hass, t) => hass?.entities?.[`switch.${t.prefix}_screen`]?.device_id || null;

  /* ---------- small helpers ---------- */
  const LOCAL_POLL_S = 3;
  const TAB_KEY = "fully-tablet-sheet:tab";
  const DIALOG_QUERY = "(min-width: 768px)";
  const isDialog = () => window.matchMedia(DIALOG_QUERY).matches;
  const getHass = () => document.querySelector("home-assistant")?.hass;
  const inApp = () => !!(window.externalApp || window.webkit?.messageHandlers?.externalBus);
  const haptic = (type = "light") => {
    const e = new Event("haptic", { bubbles: true, composed: true });
    e.detail = type;
    window.dispatchEvent(e);
    if (!inApp() && navigator.vibrate) {
      try { navigator.vibrate(["heavy", "warning", "failure"].includes(type) ? [18, 40, 18] : 10); } catch (err) { /* ignore */ }
    }
  };
  const ago = (ts) => {
    if (!ts) return "";
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 5) return "just now";
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  };
  const batteryIcon = (level, charging) => {
    if (level == null || isNaN(level)) return "mdi:battery-unknown";
    if (level >= 95) return charging ? "mdi:battery-charging-100" : "mdi:battery";
    const step = Math.max(10, Math.round(level / 10) * 10);
    return `mdi:battery${charging ? "-charging" : ""}-${step}`;
  };
  const pagePath = (url) => { try { const u = new URL(url); return u.pathname + u.hash; } catch (e) { return url || ""; } };
  const gb = (bytes) => { const n = Number(bytes); return Number.isFinite(n) ? `${(n / 1073741824).toFixed(1)} GB` : null; };
  const fmtDur = (ms) => {
    const m = Math.round(ms / 60000);
    if (m < 1) return "under a minute";
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    if (h < 24) return r ? `${h}h ${r}m` : `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  };
  const fmtTime = (ts, withDay = false) => {
    const d = new Date(ts);
    const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return withDay ? `${d.toLocaleDateString([], { weekday: "short" })} ${t}` : t;
  };

  /* Which app is in front (sensor.<tablet>_foreground_app reports the Android package name) */
  const APP_NAMES = {
    "com.android.settings": ["Settings", "mdi:cog-outline"],
    "com.android.systemui": ["Lock or system screen", "mdi:cellphone-lock"],
    "com.spotify.music": ["Spotify", "mdi:spotify"],
    "com.google.android.youtube": ["YouTube", "mdi:youtube"],
    "com.google.android.apps.youtube.music": ["YouTube Music", "mdi:youtube"],
    "com.android.chrome": ["Chrome", "mdi:google-chrome"],
    "com.sec.android.app.sbrowser": ["Samsung Internet", "mdi:web"],
    "com.android.vending": ["Play Store", "mdi:google-play"],
    "com.sec.android.app.camera": ["Camera", "mdi:camera-outline"],
    "com.sec.android.gallery3d": ["Gallery", "mdi:image-outline"],
    "com.samsung.android.app.galaxyfinder": ["Search", "mdi:magnify"],
    "com.disney.disneyplus": ["Disney+", "mdi:television-play"],
    "com.netflix.mediaclient": ["Netflix", "mdi:netflix"],
    "com.plexapp.android": ["Plex", "mdi:plex"],
    "com.sonos.acr2": ["Sonos", "mdi:speaker"],
    "io.homeassistant.companion.android": ["Home Assistant app", "mdi:home-assistant"],
  };
  const appInfo = (pkg) => {
    if (!pkg || DEAD.includes(pkg)) return null;
    if (/fully/i.test(pkg)) return { pkg, name: "Fully Kiosk", icon: "mdi:tablet-dashboard", fully: true };
    if (/launcher|trebuchet|\.home$/i.test(pkg)) return { pkg, name: "Home screen", icon: "mdi:home-outline" };
    const known = settings.apps[pkg] || APP_NAMES[pkg];
    if (known) return { pkg, name: known[0], icon: known[1] };
    const skip = ["com", "org", "net", "io", "android", "app", "apps", "google", "sec", "samsung", "lenovo"];
    const seg = pkg.split(".").filter((x) => x && !skip.includes(x.toLowerCase())).pop() || pkg;
    return { pkg, name: seg.charAt(0).toUpperCase() + seg.slice(1), icon: "mdi:application-outline" };
  };

  /* ================================================================== */
  /* Local Fully Kiosk JavaScript interface                              */
  /* ================================================================== */
  const local = {
    get ok() { return typeof window.fully !== "undefined" && !!window.fully; },
    has(name) { return this.ok && typeof window.fully[name] === "function"; },
    call(name, ...args) {
      if (!this.has(name)) return undefined;
      try { return window.fully[name](...args); } catch (err) { console.warn(TAG, `fully.${name}() failed`, err); return undefined; }
    },
    snap() {
      return {
        battery: this.call("getBatteryLevel"),
        plugged: this.call("isPlugged"),
        brightness: this.call("getScreenBrightness"),
        screenOn: this.call("getScreenOn"),
        volume: this.call("getAudioVolume", 3),
        ip: this.call("getIp4Address"),
        model: this.call("getDeviceModel"),
        android: this.call("getAndroidVersion"),
        fullyVersion: this.call("getFullyVersion"),
        ssid: this.call("getWifiSsid"),
        signal: this.call("getWifiSignalLevel"),
        storageFree: this.call("getInternalStorageFreeSpace"),
        storageTotal: this.call("getInternalStorageTotalSpace"),
      };
    },
    // fully.bind() eval's a string, so one global shim re-emits as a DOM event.
    bindEvents() {
      if (!this.has("bind") || window.__ftsBound) return;
      window.__ftsBound = true;
      window.__ftsEmit = () => window.dispatchEvent(new Event("fts-local"));
      for (const ev of ["screenOn", "screenOff", "pluggedAC", "pluggedUSB", "pluggedWireless",
        "unplugged", "onBatteryLevelChanged", "onScreensaverStart", "onScreensaverStop"]) {
        this.call("bind", ev, "__ftsEmit();");
      }
    },
  };

  /* Which tablet is this? undefined = not worked out yet, null = no match / not Fully. */
  const normMac = (v) => {
    if (typeof v !== "string") return "";
    let mac = v.trim().toLowerCase().replace(/-/g, ":");
    if (!mac.includes(":") && /^[0-9a-f]{12}$/.test(mac)) mac = mac.match(/.{2}/g).join(":");
    return mac;
  };
  let localKey;
  let localFor = null; // the tablet list the answer was computed for
  const resolveLocal = (hass) => {
    if (!local.ok) return null;
    const list = tabletsOf(hass);
    if (localKey !== undefined && localFor === list) return localKey;
    if (!hass?.entities || !hass?.devices || !list.length) return undefined;
    let mac = normMac(local.call("getMacAddress"));
    if (mac === "02:00:00:00:00:00") mac = "";
    const fid = local.call("getDeviceId");
    let ip = local.call("getIp4Address");
    if (ip === "0.0.0.0") ip = "";
    const dname = String(local.call("getDeviceName") || "").trim().toLowerCase();
    const regs = list.map((t) => ({ t, reg: hass.devices[hass.entities[`switch.${t.prefix}_screen`]?.device_id] }));
    const tests = [
      ({ reg }) => !!mac && (reg?.connections || []).some(([k, v]) => k === "mac" && normMac(v) === mac),
      ({ reg }) => !!fid && (reg?.identifiers || []).some(([d, v]) => d === "fully_kiosk" && v === fid),
      ({ reg }) => { if (!ip || !reg?.configuration_url) return false; try { return new URL(reg.configuration_url).hostname === ip; } catch (e) { return false; } },
      ({ t, reg }) => !!dname && [t.name, reg?.name, reg?.name_by_user].some((n) => n && n.trim().toLowerCase() === dname),
    ];
    localFor = list;
    for (const test of tests) {
      const hit = regs.find(test);
      if (hit) return (localKey = hit.t.key);
    }
    return (localKey = null);
  };
  const allowedHere = (hass) => {
    if (!local.ok || !settings.allowOn) return true;
    const k = resolveLocal(hass);
    return !!k && settings.allowOn.includes(k);
  };

  /* Battery management (window.fk_tablet_state, published by a Fully-side script) */
  const bmsState = () => window.fk_tablet_state;
  const bmsDisplay = (b) => {
    if (!b) return { text: "Waiting for status", tone: "" };
    if (b.isPreservationMode) return { text: b.isPreservationAwake ? "Preservation mode, awake" : "Preservation mode, screen off", tone: "bad" };
    if (b.isBatteryManagementMode) return { text: b.isDimmed ? "Saving battery, dimmed" : "Saving battery", tone: "warn" };
    return { text: "Normal", tone: "ok" };
  };

  const THEME_VARS = [
    "--primary-text-color", "--secondary-text-color", "--primary-color", "--accent-color",
    "--card-background-color", "--ha-card-background", "--secondary-background-color",
    "--divider-color", "--rgb-primary-text-color", "--rgb-primary-color", "--disabled-color",
    "--ha-card-border-radius", "--error-color", "--success-color", "--warning-color",
  ];

  /* ---------- shared actions (used by the sheet and the chips) ---------- */
  const logAction = (hass, t, message) => {
    if (!settings.logActions || !hass) return;
    hass.callService("logbook", "log", {
      name: `${t.name} tablet`, message, entity_id: `switch.${t.prefix}_screen`, domain: "fully_kiosk",
    }).catch(() => { /* logbook may be off */ });
  };
  const launchApp = (hass, t, pkg) => {
    if (!pkg) return Promise.resolve(false);
    if (t.key === resolveLocal(hass) && local.has("startApplication")) {
      local.call("startApplication", pkg);
      logAction(hass, t, `opened ${appInfo(pkg)?.name || pkg} (from the tablet)`);
      return Promise.resolve(true);
    }
    const device_id = deviceIdOf(hass, t);
    if (!device_id) return Promise.resolve(false);
    return hass.callService("fully_kiosk", "start_application", { application: pkg }, { device_id })
      .then(() => { logAction(hass, t, `opened ${appInfo(pkg)?.name || pkg}`); return true; }, (err) => { console.warn(TAG, "start_application", err); return false; });
  };
  const setScreen = (hass, t, on) => {
    if (t.key === resolveLocal(hass) && (local.has("turnScreenOn") || local.has("turnScreenOff"))) {
      local.call(on ? "turnScreenOn" : "turnScreenOff");
      logAction(hass, t, `screen turned ${on ? "on" : "off"} (from the tablet)`);
      return Promise.resolve(true);
    }
    return hass.callService("switch", on ? "turn_on" : "turn_off", { entity_id: `switch.${t.prefix}_screen` })
      .then(() => { logAction(hass, t, `screen turned ${on ? "on" : "off"}`); return true; }, () => false);
  };
  const navigate = (path) => {
    history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  };

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

    /* ================================================================ */
    /* Render                                                            */
    /* ================================================================ */
    render() {
      if (!this.hass || this._tab === null) return html``;
      const order = this._order();
      if (!order.length) return this._renderEmpty();
      const stats = order.map((x) => this._status(x));
      const offline = stats.filter((s) => s === "offline").length;
      const onCount = stats.filter((s) => s === "on").length;
      const chip = this.single
        ? html`<span class="chip ${stats[0] === "on" ? "on" : stats[0] === "offline" ? "warn" : ""}">${stats[0] === "offline" ? "Offline" : `Screen ${stats[0]}`}</span>`
        : offline
          ? html`<span class="chip warn">${offline} offline</span>`
          : html`<span class="chip ${onCount ? "on" : ""}">${onCount} of ${order.length} on</span>`;
      return this._dialog ? this._renderDialog(order, stats, chip) : this._renderSheet(order, stats, chip);
    }

    _renderEmpty() {
      return html`
        <div class="backdrop ${this._closing ? "closing" : ""}" @click=${() => this.close()}></div>
        <div class="${this._dialog ? "dialog" : "sheet"} ${this._closing ? "closing" : ""}" role="dialog" aria-label="Tablets">
          <div class="content" style="padding:24px">
            <header class="content-head" style="padding:0 0 10px"><h2>Tablets</h2>
              <button class="close" @click=${() => this.close()} aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button></header>
            <div class="section offline-box">
              <ha-icon icon="mdi:tablet-off"></ha-icon>
              <div class="row-text">
                <span class="row-title">No Fully Kiosk tablets found</span>
                <span class="row-sub">Add the Fully Kiosk Browser integration, or list your tablets under <code>tablets:</code> in the card config.</span>
              </div>
            </div>
          </div>
        </div>`;
    }

    _pageSwitch() {
      return html`
        <div class="seg" role="tablist">
          <button class="seg-btn ${this._page === "controls" ? "on" : ""}" role="tab" aria-selected=${this._page === "controls" ? "true" : "false"}
            @click=${() => this._setPage("controls")}><ha-icon icon="mdi:tune-variant"></ha-icon>Controls</button>
          <button class="seg-btn ${this._page === "history" ? "on" : ""}" role="tab" aria-selected=${this._page === "history" ? "true" : "false"}
            @click=${() => this._setPage("history")}><ha-icon icon="mdi:chart-timeline-variant"></ha-icon>History</button>
        </div>`;
    }

    _tabletPage(t, status) {
      if (this._page === "history") return this._historyBody(t);
      return t.key === resolveLocal(this.hass) ? this._localBody(t) : this._tabBody(t, status);
    }

    /* ---------- phone: bottom sheet with tabs ---------- */
    _renderSheet(order, stats, chip) {
      const t = order.find((x) => x.key === this._tab) || order[0];
      const style = this._sheetY > 0 ? `transform:translateY(${this._sheetY}px);transition:none;` : "";
      const lk = resolveLocal(this.hass);
      return html`
        <div class="backdrop ${this._closing ? "closing" : ""}" @click=${() => this.close()}></div>
        <div class="sheet ${this._closing ? "closing" : ""}" style=${style} role="dialog" aria-label="Tablets">
          <div class="header" @pointerdown=${this._hDown} @pointermove=${this._hMove}
               @pointerup=${this._hUp} @pointercancel=${this._hUp}>
            <div class="grabber"></div>
            <div class="title-row">
              <ha-icon .icon=${this.single ? (t.icon || "mdi:tablet") : "mdi:tablet-dashboard"}></ha-icon>
              <span class="title">${this.single ? t.name : "Tablets"}</span>
              ${this.single && t.key === lk ? html`<span class="chip"><ha-icon icon="mdi:map-marker"></ha-icon>This tablet</span>` : chip}
              <button class="close" @pointerdown=${(e) => e.stopPropagation()}
                @click=${() => this.close()} aria-label="Close">
                <ha-icon icon="mdi:close"></ha-icon>
              </button>
            </div>
            ${this.single ? "" : html`
            <div class="tabs" role="tablist" @pointerdown=${(e) => e.stopPropagation()}>
              ${order.map((x, i) => {
                const me = x.key === lk;
                return html`
                  <button class="tab ${x.key === t.key ? "on" : ""}" role="tab"
                    aria-selected=${x.key === t.key ? "true" : "false"}
                    title=${me ? `${x.name} · this tablet` : `${x.name} · ${stats[i] === "offline" ? "offline" : `screen ${stats[i]}`}`}
                    @click=${() => this._setTab(x.key)}>
                    ${me ? html`<ha-icon class="here" icon="mdi:map-marker"></ha-icon>` : html`<span class="dot ${stats[i]}"></span>`}${x.short}</button>`;
              })}
            </div>`}
            <div @pointerdown=${(e) => e.stopPropagation()}>${this._pageSwitch()}</div>
          </div>
          <div class="body">${this._tabletPage(t, stats[order.indexOf(t)])}</div>
          ${this._confirm && (this._confirm.tab === t.key || this._confirm.tab === this._tab) ? this._confirmDialog() : ""}
          ${this._toastMsg ? html`<div class="toast">${this._toastMsg}</div>` : ""}
        </div>
      `;
    }

    /* ---------- tablet / desktop: centred dialog with a sidebar ---------- */
    _renderDialog(order, stats, chip) {
      const ov = this._tab === OVERVIEW && !this.single;
      const t = ov ? null : order.find((x) => x.key === this._tab) || order[0];
      const lk = resolveLocal(this.hass);
      const isLocal = !!t && t.key === lk;
      return html`
        <div class="backdrop ${this._closing ? "closing" : ""}" @click=${() => this.close()}></div>
        <div class="dialog ${this._closing ? "closing" : ""}" role="dialog" aria-label="Tablets">
          <aside class="side">
            <div class="side-head">
              <span class="side-title">${this.single ? "Tablet" : "Tablets"}</span>
              ${chip}
            </div>
            <nav role="tablist">
              ${this.single ? "" : html`
              <button class="nav-item ${ov ? "on" : ""}" role="tab" aria-selected=${ov ? "true" : "false"}
                @click=${() => this._setTab(OVERVIEW)}>
                <ha-icon icon="mdi:view-grid-outline"></ha-icon><span class="nav-name">Overview</span></button>`}
              ${order.map((x, i) => {
                const sel = !ov && x.key === t.key;
                const me = x.key === lk;
                const bat = this._battery(x);
                const low = bat && bat.level < 20 && !bat.charging;
                return html`
                  <button class="nav-item ${sel ? "on" : ""}" role="tab" aria-selected=${sel ? "true" : "false"}
                    aria-label="${x.name}${me ? ", this tablet" : ""}, ${stats[i] === "offline" ? "offline" : `screen ${stats[i]}`}${bat ? `, battery ${Math.round(bat.level)}%` : ""}"
                    @click=${() => this._setTab(x.key)}>
                    <span class="nav-dot"><span class="dot ${stats[i]}"></span></span>
                    <span class="nav-name">${x.name}</span>
                    ${me ? html`<ha-icon class="here" icon="mdi:map-marker" title="This tablet"></ha-icon>` : ""}
                    ${bat ? html`<span class="nav-bat ${low ? "warn" : bat.charging ? "ok" : ""}">
                      ${bat.charging ? html`<ha-icon icon="mdi:lightning-bolt"></ha-icon>` : ""}${Math.round(bat.level)}%</span>` : ""}
                  </button>`;
              })}
              ${this.single ? html`
                <div class="nav-sep"></div>
                <button class="nav-item ${this._page === "controls" ? "on" : ""}" role="tab" @click=${() => this._setPage("controls")}>
                  <ha-icon icon="mdi:tune-variant"></ha-icon><span class="nav-name">Controls</span></button>
                <button class="nav-item ${this._page === "history" ? "on" : ""}" role="tab" @click=${() => this._setPage("history")}>
                  <ha-icon icon="mdi:chart-timeline-variant"></ha-icon><span class="nav-name">History</span></button>` : ""}
            </nav>
            ${this._sideBattery()}
          </aside>
          <main class="content">
            <header class="content-head">
              <h2>${ov ? "Overview" : t.name}</h2>
              ${isLocal ? html`<span class="chip"><ha-icon icon="mdi:map-marker"></ha-icon>This tablet</span>` : ""}
              ${ov ? html`<span class="count">Updated ${ago(this._ovAt)}</span>
                <button class="icon-btn sm soft" @click=${() => this._refreshOverview()} aria-label="Refresh screenshots">
                  <ha-icon icon="mdi:refresh"></ha-icon></button>` : this.single ? "" : this._pageSwitch()}
              <button class="close" @click=${() => this.close()} aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button>
            </header>
            <div class="body">
              ${ov ? this._overview(order, stats) : this._tabletPage(t, stats[order.indexOf(t)])}
            </div>
          </main>
          ${this._confirm && this._confirm.tab === this._tab ? this._confirmDialog() : ""}
          ${this._toastMsg ? html`<div class="toast">${this._toastMsg}</div>` : ""}
        </div>
      `;
    }

    /* Bottom of the sidebar: this tablet's battery (only inside Fully) */
    _sideBattery() {
      const lk = resolveLocal(this.hass);
      if (!lk) return html`<div class="side-spacer"></div>`;
      const s = this._snap || {};
      const level = Number(s.battery);
      const known = s.battery != null && Number.isFinite(level);
      const charging = !!s.plugged;
      const b = bmsState();
      const d = bmsDisplay(b);
      const tone = known && level < 20 && !charging ? "bad" : b && d.tone !== "ok" ? d.tone : charging ? "ok" : "";
      return html`
        <div class="side-spacer"></div>
        <button class="mini" @click=${() => { this._setTab(lk); this._setPage("controls"); }} aria-label="This tablet's battery: ${known ? `${Math.round(level)}%` : "unknown"}">
          <span class="mini-ic tone-${tone}"><ha-icon .icon=${batteryIcon(known ? level : null, charging)}></ha-icon></span>
          <div class="mini-text">
            <span>${known ? `${Math.round(level)}%` : "Battery"}<small class="mini-tag"> · this tablet</small></span>
            <small>${charging ? "Charging" : "On battery"}${b !== undefined ? ` · ${d.text}` : ""}</small>
          </div>
        </button>`;
    }

    /* ---------- overview ---------- */
    _overview(order, stats) {
      return html`<div class="ov-grid">${order.map((t, i) => this._ovCard(t, stats[i]))}</div>`;
    }
    _ovCard(t, status) {
      const I = ids(t.prefix);
      const online = status !== "offline";
      const on = status === "on";
      const me = t.key === resolveLocal(this.hass);
      const url = online ? this._shotUrl(I, this._ovTs) : null;
      const bat = this._battery(t);
      const low = bat && bat.level < 20 && !bat.charging;
      const app = online && !me ? appInfo(this._st(I.fg)?.state) : null;
      const away = app && !app.fully;
      const toggle = me && this._snap
        ? this._toggle(this._localOn(), !(local.has("turnScreenOff") || local.has("turnScreenOn")), () => this._localScreen(t))
        : this._toggle(on, !online || !this._st(I.screen), () => this._toggleScreen(t, I));
      return html`
        <div class="section ovc ${online ? "" : "off"}">
          <button class="ov-shot" @click=${() => this._setTab(t.key)} aria-label="Open ${t.name}">
            ${url ? html`<img src=${url} alt="Screenshot of the ${t.name} tablet" loading="lazy" decoding="async"
                @error=${(e) => (e.target.style.visibility = "hidden")} @load=${(e) => (e.target.style.visibility = "visible")} />`
              : html`<div class="ov"><ha-icon .icon=${online ? "mdi:image-off-outline" : "mdi:tablet-off"}></ha-icon>${online ? "No screenshot" : "Offline"}</div>`}
            ${online && !on ? html`<span class="badge"><ha-icon icon="mdi:monitor-off"></ha-icon>Screen off</span>` : ""}
          </button>
          <div class="row">
            <span class="dot ${status}"></span>
            <div class="row-text">
              <span class="row-title">${t.name}${me ? html`<ha-icon class="here-sm" icon="mdi:map-marker"></ha-icon>` : ""}</span>
              <span class="row-sub">${!online ? "Offline" : on ? "Screen on" : "Screen off"}${away
                ? html` · <span class="attn-t" title=${app.pkg}>${app.name} in front</span>` : ""}${bat
                ? html` · <span class=${low ? "warn-t" : ""}>${Math.round(bat.level)}%${bat.charging ? ", charging" : ""}</span>` : ""}</span>
            </div>
            <button class="icon-btn sm soft" @click=${() => { this._setTab(t.key); this._setPage("history"); }} aria-label="History for ${t.name}">
              <ha-icon icon="mdi:chart-timeline-variant"></ha-icon></button>
            ${toggle}
          </div>
        </div>`;
    }

    /* ---------- remote tablet: controls ---------- */
    _tabBody(t, status) {
      const I = ids(t.prefix);
      const online = status !== "offline";
      const on = status === "on";
      return html`<div class="tab-body ${this._dialog ? "cols" : ""}">
        ${online ? "" : html`
          <div class="section offline-box full">
            <ha-icon icon="mdi:tablet-off"></ha-icon>
            <div class="row-text">
              <span class="row-title">${t.name} tablet is offline</span>
              <span class="row-sub">Home Assistant can't reach Fully on it. Check that it has power and Wi-Fi.</span>
            </div>
          </div>`}
        ${this._dialog ? html`
          <div class="col">${this._shotSection(t, I, online, on)}${this._screenSection(t, I, online, on)}</div>
          <div class="col">${this._browserSection(t, I, online)}${this._powerSection(t, I, online)}</div>`
        : html`
          ${this._shotSection(t, I, online, on)}
          ${this._screenSection(t, I, online, on)}
          ${this._actions(t, I, online)}`}
      </div>`;
    }

    _shotSection(t, I, online, on) {
      const url = online ? this._shotUrl(I) : null;
      const orient = Number(this._st(I.orient)?.state);
      const portrait = orient === 0 || orient === 180;
      const loading = online && this._shotState === "loading";
      let overlay = "";
      if (!online) overlay = html`<div class="ov"><ha-icon icon="mdi:tablet-off"></ha-icon>No screenshot while offline</div>`;
      else if (!url) overlay = html`<div class="ov"><ha-icon icon="mdi:image-off-outline"></ha-icon>No screenshot entity for this tablet</div>`;
      else if (this._shotState === "error") overlay = html`<div class="ov"><ha-icon icon="mdi:image-off-outline"></ha-icon>
          Couldn't get a screenshot<small>Check that screenshots are allowed in Fully's Remote Administration settings. Tap to try again.</small></div>`;
      else if (loading && !this._shotAt) overlay = html`<div class="ov soft"><ha-icon class="spin" icon="mdi:loading"></ha-icon></div>`;
      return html`
        <div class="section s-shot">
          <div class="sec-head">
            <ha-icon icon="mdi:cellphone-screenshot"></ha-icon><span>Screen view</span>
            <span class="count">${online && this._shotAt ? `Updated ${ago(this._shotAt)}` : ""}</span>
            <button class="icon-btn sm soft" ?disabled=${!online || !url}
              @click=${() => this._refreshShot(true)} aria-label="Refresh screenshot">
              <ha-icon class=${loading ? "spin" : ""} icon="mdi:refresh"></ha-icon></button>
          </div>
          <button class="shot ${portrait ? "portrait" : ""}" ?disabled=${!online || !url}
            @click=${() => this._refreshShot(true)} aria-label="Refresh screenshot">
            ${url ? html`<img src=${url} alt="Screenshot of the ${t.name} tablet"
              @load=${this._onShotLoad} @error=${this._onShotError} />` : ""}
            ${online && !on && url ? html`<span class="badge"><ha-icon icon="mdi:monitor-off"></ha-icon>Screen off</span>` : ""}
            ${overlay}
          </button>
        </div>
      `;
    }

    _screenSection(t, I, online, on) {
      const scr = this._st(I.screen);
      const bst = this._st(I.bright);
      const level = parseFloat(this._st(I.battery)?.state);
      const charging = this._st(I.plugged)?.state === "on";
      const page = this._st(I.page)?.state;
      const app = online ? appInfo(this._st(I.fg)?.state) : null;
      let bright = "";
      if (bst) {
        const max = Number(bst.attributes?.max) || 255;
        const min = Number(bst.attributes?.min) || 0;
        const raw = parseFloat(bst.state);
        const pct = isNaN(raw) ? null : Math.round(((raw - min) / (max - min)) * 100);
        const key = `bright:${t.key}`;
        const shown = this._shown(key, pct);
        bright = this._sliderRow("Brightness", shown != null ? `${shown}%` : "Not set", "mdi:brightness-5", "mdi:brightness-7",
          this._slider({
            key, label: "Brightness", value: pct, disabled: !online || bst.state === "unavailable",
            onCommit: (v) => this._call("number", "set_value", { entity_id: I.bright, value: Math.round(min + (v / 100) * (max - min)) })
              .then((ok) => ok && logAction(this.hass, t, `brightness set to ${v}%`)),
          }));
      }
      return html`
        <div class="section">
          <div class="row">
            <div class="row-icon ${on ? "on" : ""}"><ha-icon .icon=${on ? "mdi:monitor" : "mdi:monitor-off"}></ha-icon></div>
            <div class="row-text">
              <span class="row-title">Screen</span>
              <span class="row-sub">${!online ? "Unavailable" : on ? "On" : "Off"}</span>
            </div>
            ${this._toggle(on, !online || !scr, () => this._toggleScreen(t, I))}
          </div>
          ${bright}
          ${online ? html`
            <div class="chips">
              ${app ? html`<span class="chip ${app.fully ? "" : "attn"}" title=${app.pkg}>
                <ha-icon .icon=${app.icon}></ha-icon>${app.name} in front</span>` : ""}
              ${!isNaN(level) ? this._batteryChip(level, charging) : ""}
              ${page && !DEAD.includes(page) ? html`<span class="chip page" title=${page}>
                <ha-icon icon="mdi:web"></ha-icon><span class="ell">${pagePath(page)}</span></span>` : ""}
            </div>` : ""}
        </div>
      `;
    }

    _browserItems(t, I, online, forGrid) {
      const has = (name) => !!this._st(I.btn(name));
      const fg = this._st(I.fg)?.state;
      const fullyInFront = !!fg && !DEAD.includes(fg) && /fully/i.test(fg);
      const other = !fullyInFront ? appInfo(fg) : null;
      const front = ["front", "bring_to_foreground", "mdi:flip-to-front", "Bring to front",
        other ? `${other.name} is in front · puts Fully back` : "Puts Fully back on screen", "Bringing Fully to the front"];
      const back = ["back", "send_to_background", "mdi:flip-to-back", "Send to background", "Fully is on screen · shows the Android home screen", "Sending Fully to the background"];
      const items = [
        ["reload", "load_start_url", "mdi:refresh", "Reload page", "Opens the start page again", "Reloading page"],
        ["browser", "restart_browser", "mdi:restart", "Restart browser", "Relaunches Fully Kiosk", "Restarting browser"],
        ["cache", "clear_browser_cache", "mdi:broom", "Clear cache", "Clears the browser cache", "Clearing cache"],
      ].filter(([, name]) => has(name));
      if (forGrid) {
        const fully = fullyInFront && has("send_to_background") ? back : has("bring_to_foreground") ? front : has("send_to_background") ? back : null;
        if (fully) items.push(fully);
      } else {
        if (has("bring_to_foreground")) items.push(front);
        if (has("send_to_background")) items.push(back);
      }
      const run = ([k, name, , , , done]) => {
        const go = (feel) => { this._press(t, I.btn(name), `${t.key}:${k}`, done, feel); logAction(this.hass, t, done.toLowerCase()); };
        if (k === "back") {
          this._ask({
            icon: "mdi:flip-to-back", title: `Send Fully to the background on ${t.name}?`,
            text: "The tablet shows the Android home screen until Fully is brought back to the front.",
            go: "Send to background",
          }, () => go(false));
        } else go(true);
      };
      return items.map((a) => this._actBtn(a[2], a[3], a[4], this._busy === `${t.key}:${a[0]}`, !online, () => run(a)));
    }
    _actions(t, I, online) {
      return html`
        <div class="section">
          <div class="act-grid">${this._browserItems(t, I, online, false)}</div>
          ${this._plugRow(t)}
          ${this._restartBtn(t, I, online)}
        </div>`;
    }
    _restartBtn(t, I, online) {
      if (!this._st(I.btn("restart_device"))) return "";
      return html`
        <button class="act danger ${this._busy === `${t.key}:reboot` ? "busy" : ""}" ?disabled=${!online}
          @click=${() => this._ask({
            icon: "mdi:power-cycle", title: `Restart ${t.name} tablet?`,
            text: "The screen goes dark while it reboots. It's usually back on the dashboard within a couple of minutes.",
            go: "Restart",
          }, () => { this._press(t, I.reboot, `${t.key}:reboot`, `Restarting ${t.name} tablet`, false); logAction(this.hass, t, "restart requested"); })}>
          <ha-icon icon="mdi:power-cycle"></ha-icon>Restart tablet
        </button>`;
    }
    _browserSection(t, I, online) {
      const items = this._browserItems(t, I, online, true);
      if (!items.length) return "";
      return html`
        <div class="section">
          <div class="sec-head"><ha-icon icon="mdi:web"></ha-icon><span>Browser</span></div>
          <div class="act-grid">${items}</div>
        </div>`;
    }
    _powerSection(t, I, online) {
      const plug = this._plugRow(t);
      const restart = this._restartBtn(t, I, online);
      if (!plug && !restart) return "";
      return html`
        <div class="section power">
          <div class="sec-head"><ha-icon icon="mdi:power-plug-outline"></ha-icon><span>Power</span></div>
          ${plug}
          ${restart}
        </div>`;
    }

    /* ---------- this tablet (native) ---------- */
    _localBody(t) {
      const s = this._snap || {};
      if (this._dialog) {
        return html`<div class="tab-body cols">
          ${this._bmsSection()}
          <div class="col">${this._localScreenSection(t, s)}${this._infoSection(s)}</div>
          <div class="col">${this._localActions(t, "browser")}${this._localActions(t, "power")}</div>
        </div>`;
      }
      return html`<div class="tab-body">
        ${this._bmsSection()}
        ${this._localScreenSection(t, s)}
        ${this._localActions(t)}
        ${this._infoSection(s)}
      </div>`;
    }

    _bmsSection() {
      const b = bmsState();
      if (b === undefined) return "";
      const d = bmsDisplay(b);
      return html`
        <div class="section full">
          <div class="row">
            <div class="row-icon tone-${d.tone}"><ha-icon icon="mdi:battery-heart-variant"></ha-icon></div>
            <div class="row-text">
              <span class="row-title">Battery management</span>
              <span class="row-sub">${d.text}</span>
            </div>
            <button class="pill-btn" @click=${() => {
              haptic("light");
              window.dispatchEvent(new CustomEvent("pauseadaptivebrightness"));
              haptic("success");
              this._toast("Adaptive brightness paused");
            }}>Pause auto-dimming</button>
          </div>
        </div>`;
    }

    _localScreenSection(t, s) {
      const on = this._localOn();
      const canScreen = local.has("turnScreenOff") || local.has("turnScreenOn");
      const bPct = Number.isFinite(Number(s.brightness)) ? Math.round((Number(s.brightness) / 255) * 100) : null;
      const bShown = this._shown("lbright", bPct);
      const vol = Number.isFinite(Number(s.volume)) ? Math.round(Number(s.volume)) : null;
      const vShown = this._shown("lvol", vol);
      const level = Number(s.battery);
      return html`
        <div class="section">
          <div class="row">
            <div class="row-icon ${on ? "on" : ""}"><ha-icon .icon=${on ? "mdi:monitor" : "mdi:monitor-off"}></ha-icon></div>
            <div class="row-text">
              <span class="row-title">Screen</span>
              <span class="row-sub">${on ? "On" : "Off"}, controlled directly on this tablet</span>
            </div>
            ${canScreen ? this._toggle(on, false, () => this._localScreen(t)) : ""}
          </div>
          ${local.has("setScreenBrightness") ? this._sliderRow("Brightness", bShown != null ? `${bShown}%` : "", "mdi:brightness-5", "mdi:brightness-7",
            this._slider({
              key: "lbright", label: "Brightness", value: bPct,
              onInput: (v) => local.call("setScreenBrightness", Math.round((v / 100) * 255)),
              onCommit: (v) => this._localBrightness(v),
            })) : ""}
          ${local.has("setAudioVolume") ? this._sliderRow("Volume", vShown != null ? `${vShown}%` : "", "mdi:volume-low", "mdi:volume-high",
            this._slider({
              key: "lvol", label: "Volume", value: vol,
              onCommit: (v) => { local.call("setAudioVolume", v, 3); this._snapSoon(); },
            })) : ""}
          <div class="chips">
            ${Number.isFinite(level) ? this._batteryChip(level, !!s.plugged) : ""}
            ${s.ssid ? html`<span class="chip"><ha-icon icon="mdi:wifi"></ha-icon>${s.ssid}</span>` : ""}
          </div>
        </div>
      `;
    }

    _localActions(t, part) {
      const items = [
        { fn: "loadStartUrl", icon: "mdi:refresh", title: "Reload page", sub: "Opens the start page again", done: "Reloading page" },
        { fn: "clearCache", icon: "mdi:broom", title: "Clear cache", sub: "Clears the browser cache", done: "Cache cleared" },
        { fn: "restartApp", icon: "mdi:restart", title: "Restart browser", sub: "Relaunches Fully Kiosk", done: "Restarting browser",
          confirm: { icon: "mdi:restart", title: "Restart the browser on this tablet?", text: "Fully closes and reopens, so this sheet closes too.", go: "Restart browser" } },
        { fn: "disableWifi", needs: "enableWifi", icon: "mdi:wifi-refresh", title: "Reconnect Wi-Fi", sub: "Off for 5 seconds, then on",
          confirm: { icon: "mdi:wifi-refresh", title: "Reconnect Wi-Fi on this tablet?", text: "Wi-Fi turns off for 5 seconds, then back on. The dashboard reconnects on its own.", go: "Reconnect" },
          run: () => this._wifiSequence(t) },
        { fn: "bringToBackground", icon: "mdi:flip-to-back", title: "Send to background", sub: "Shows the Android home screen", done: "Sending Fully to the background",
          confirm: { icon: "mdi:flip-to-back", title: "Send Fully to the background?", text: "This tablet shows the Android home screen until Fully is brought back to the front from Home Assistant.", go: "Send to background" } },
      ].filter((a) => local.has(a.fn) && (!a.needs || local.has(a.needs)));
      const run = (a) => {
        const go = (feel) => (a.run ? a.run() : this._localDo(t, a.fn, a.done, feel));
        if (a.confirm) this._ask(a.confirm, () => go(false)); else go(true);
      };
      const btn = (a) => this._actBtn(a.icon, a.title, a.sub, false, false, () => run(a));
      const reboot = local.has("reboot") ? html`
            <button class="act danger" @click=${() => this._ask({
              icon: "mdi:power-cycle", title: "Restart this tablet?",
              text: "The screen goes dark while it reboots. It's usually back on the dashboard within a couple of minutes.",
              go: "Restart",
            }, () => this._localDo(t, "reboot", "Restarting this tablet", false))}>
              <ha-icon icon="mdi:power-cycle"></ha-icon>Restart tablet
            </button>` : "";
      if (part === "browser") {
        const b = items.filter((a) => a.fn !== "disableWifi");
        return b.length ? html`
          <div class="section">
            <div class="sec-head"><ha-icon icon="mdi:web"></ha-icon><span>Browser</span></div>
            <div class="act-grid">${b.map(btn)}</div>
          </div>` : "";
      }
      if (part === "power") {
        const wifi = items.find((a) => a.fn === "disableWifi");
        return html`
          <div class="section power">
            <div class="sec-head"><ha-icon icon="mdi:power-plug-outline"></ha-icon><span>Power</span></div>
            ${this._plugRow(t)}
            ${wifi ? html`<div class="act-grid one">${btn(wifi)}</div>` : ""}
            ${reboot}
          </div>`;
      }
      return html`
        <div class="section">
          <div class="act-grid">${items.map(btn)}</div>
          ${this._plugRow(t)}
          ${reboot}
        </div>
      `;
    }

    _infoSection(s) {
      const free = gb(s.storageFree), total = gb(s.storageTotal);
      const rows = [
        ["Model", s.model],
        ["Android", s.android],
        ["Fully version", s.fullyVersion],
        ["Wi-Fi", s.ssid ? `${s.ssid}${Number.isFinite(Number(s.signal)) ? `, ${s.signal} dBm` : ""}` : null],
        ["IP address", s.ip],
        ["Storage free", free ? `${free}${total ? ` of ${total}` : ""}` : null],
      ].filter(([, v]) => v !== undefined && v !== null && v !== "");
      if (!rows.length) return "";
      return html`
        <details class="section info full">
          <summary><ha-icon icon="mdi:information-outline"></ha-icon><span>Tablet details</span>
            <ha-icon class="chev" icon="mdi:chevron-down"></ha-icon></summary>
          <div class="info-grid">${rows.map(([k, v]) => html`<span class="k">${k}</span><span class="v">${v}</span>`)}</div>
        </details>`;
    }

    /* ---------- shared bits ---------- */
    _toggle(on, disabled, onClick) {
      return html`<button class="toggle ${on ? "on" : ""}" role="switch" aria-checked=${on ? "true" : "false"}
        aria-label="Screen" ?disabled=${disabled} @click=${onClick}><span class="knob"></span></button>`;
    }
    _sliderRow(label, val, lowIcon, highIcon, slider) {
      return html`
        <div class="vol-head"><span class="lbl">${label}</span><span class="val">${val}</span></div>
        <div class="vol-row">
          <ha-icon class="sun" .icon=${lowIcon}></ha-icon>${slider}<ha-icon class="sun" .icon=${highIcon}></ha-icon>
        </div>`;
    }
    _batteryChip(level, charging) {
      return html`<span class="chip ${level < 20 && !charging ? "warn" : ""}">
        <ha-icon .icon=${batteryIcon(level, charging)}></ha-icon>${Math.round(level)}%${charging ? ", charging" : ""}</span>`;
    }
    _actBtn(icon, title, sub, busy, disabled, onClick) {
      return html`
        <button class="act ${busy ? "busy" : ""}" ?disabled=${disabled} @click=${onClick}>
          <ha-icon .icon=${icon}></ha-icon>
          <span class="act-title">${title}</span>
          <span class="act-sub">${sub}</span>
        </button>`;
    }

    _confirmDialog() {
      const c = this._confirm;
      return html`
        <div class="cf-scrim" @click=${() => this._cancelConfirm()}></div>
        <div class="cf" role="alertdialog" aria-label=${c.title}>
          <div class="cf-icon ${c.progress ? "calm" : ""}">
            <ha-icon class=${c.progress ? "spin" : ""} .icon=${c.progress ? "mdi:loading" : c.icon || "mdi:alert"}></ha-icon></div>
          <div class="cf-title">${c.title}</div>
          <div class="cf-text">${c.text}</div>
          ${c.progress ? "" : html`
            <div class="cf-btns">
              <button class="cf-cancel" @click=${() => this._cancelConfirm()}>Cancel</button>
              <button class="cf-go" @click=${() => this._go()}>${c.go || "Confirm"}</button>
            </div>`}
        </div>
      `;
    }

    /* ================================================================ */
    /* History page                                                      */
    /* ================================================================ */
    _historyBody(t) {
      const h = this._hist;
      const d = h?.data;
      const loading = !!h?.loading;
      return html`<div class="tab-body hist ${this._dialog ? "cols" : ""}">
        <div class="section full range-row">
          <div class="seg ranges" role="tablist">
            ${RANGES.map(([label, hours]) => html`
              <button class="seg-btn ${this._range === hours ? "on" : ""}" role="tab" aria-selected=${this._range === hours ? "true" : "false"}
                @click=${() => this._setRange(hours)}>${label}</button>`)}
          </div>
          <span class="count">${d ? `Updated ${ago(d.at)}` : ""}</span>
          <button class="icon-btn sm soft" ?disabled=${loading} @click=${() => { haptic("light"); this._maybeLoadHistory(true); }} aria-label="Refresh history">
            <ha-icon class=${loading ? "spin" : ""} icon="mdi:refresh"></ha-icon></button>
        </div>
        ${!d && loading ? html`<div class="section full center"><ha-icon class="spin" icon="mdi:loading"></ha-icon><span class="row-sub">Loading history…</span></div>` : ""}
        ${!d && h?.error ? html`<div class="section offline-box full"><ha-icon icon="mdi:alert-circle-outline"></ha-icon>
          <div class="row-text"><span class="row-title">Couldn't load history</span><span class="row-sub">${h.error}</span></div></div>` : ""}
        ${d ? html`
          ${this._statsSection(t, d)}
          <div class="col">${this._timelineSection(t, d)}${this._batterySection(t, d)}</div>
          <div class="col">${this._logSection(t, d)}</div>` : ""}
      </div>`;
    }

    _statsSection(t, d) {
      const s = d.stats;
      const span = Math.max(1, d.end - d.start);
      const known = span - s.deadMs;
      const onPct = known > 0 ? Math.round((s.onMs / known) * 100) : 0;
      const tiles = [
        ["mdi:monitor", "Screen on", fmtDur(s.onMs), `${onPct}% of the time`, "on"],
        ["mdi:gesture-tap", "Woke up", `${s.onCount}×`, s.onCount ? `every ${fmtDur(span / s.onCount)} on average` : "not once", ""],
        ["mdi:power-plug", "On charger", fmtDur(s.chargeMs), s.unplugCount ? `unplugged ${s.unplugCount}×` : "never unplugged", s.chargeMs > known * 0.9 ? "ok" : s.unplugCount ? "warn" : ""],
        ["mdi:battery-medium", "Battery", s.batMin != null ? `${Math.round(s.batMin)}–${Math.round(s.batMax)}%` : "—", s.batMin != null && s.batMin < 20 ? "dipped below 20%" : "range", s.batMin != null && s.batMin < 20 ? "warn" : ""],
      ];
      if (s.dropCount) tiles.push(["mdi:lan-disconnect", "Lost contact", `${s.dropCount}×`, `offline ${fmtDur(s.deadMs)} in total`, "bad"]);
      return html`
        <div class="section full stats">
          ${tiles.map(([icon, label, value, sub, tone]) => html`
            <div class="stat">
              <div class="row-icon sm tone-${tone} ${tone === "on" ? "on" : ""}"><ha-icon .icon=${icon}></ha-icon></div>
              <div class="stat-text">
                <span class="stat-label">${label}</span>
                <span class="stat-value">${value}</span>
                <span class="stat-sub">${sub}</span>
              </div>
            </div>`)}
        </div>`;
    }

    _ticks(d) {
      const span = d.end - d.start;
      const stepH = span <= 6 * 3600e3 ? 1 : span <= 24 * 3600e3 ? 4 : span <= 48 * 3600e3 ? 8 : 24;
      const out = [];
      const first = new Date(d.start);
      first.setMinutes(0, 0, 0);
      first.setHours(Math.ceil(first.getHours() / stepH) * stepH);
      for (let ts = first.getTime(); ts <= d.end; ts += stepH * 3600e3) {
        const dt = new Date(ts);
        const label = stepH >= 24 ? dt.toLocaleDateString([], { weekday: "short" })
          : dt.toLocaleTimeString([], { hour: "numeric" }).replace(":00", "").replace(/\s/g, "");
        out.push({ x: ((ts - d.start) / span) * 100, label });
      }
      return out;
    }
    _axis(d) {
      return html`<div class="axis">${this._ticks(d).map((k) => html`<span style="left:${k.x}%">${k.label}</span>`)}</div>`;
    }

    /* One <path> per state so nothing needs a nested template inside the <svg> (Lit would parse it as HTML). */
    _rects(segs, start, end, kinds) {
      const span = Math.max(1, end - start);
      const d = {};
      for (const k of kinds) d[k] = "";
      for (const g of segs) {
        const kind = kinds.includes(g.s) ? g.s : g.s === "on" ? "on" : g.s === "off" ? "off" : "dead";
        if (!(kind in d)) continue;
        const x = (((g.from - start) / span) * 1000).toFixed(2);
        const w = Math.max(0.5, ((g.to - g.from) / span) * 1000).toFixed(2);
        d[kind] += `M${x} 0h${w}v24h-${w}Z`;
      }
      return d;
    }
    _strip(segs, start, end, cls) {
      const d = this._rects(segs, start, end, ["on", "off", "dead"]);
      return html`
        <svg class="strip ${cls}" viewBox="0 0 1000 24" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <pattern id="p-${cls}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="4" height="8" fill="currentColor" opacity=".35"></rect>
            </pattern>
          </defs>
          <path class="on" d=${d.on}></path>
          <path class="off" d=${d.off}></path>
          <path class="dead" fill="url(#p-${cls})" d=${d.dead}></path>
        </svg>`;
    }

    _timelineSection(t, d) {
      const apps = d.fg.map((g) => ({ ...g, s: g.s && !DEAD.includes(g.s) ? (/fully/i.test(g.s) ? "on" : "attn") : "dead" }));
      const appD = this._rects(apps, d.start, d.end, ["on", "attn"]);
      const span = Math.max(1, d.end - d.start);
      return html`
        <div class="section">
          <div class="sec-head"><ha-icon icon="mdi:monitor"></ha-icon><span>Screen</span>
            <span class="count">${fmtTime(d.start, span > 26 * 3600e3)} → now</span></div>
          <div class="chart" @pointermove=${(e) => this._hoverAt(e, d)} @pointerleave=${() => (this._hover = null)}>
            <div class="strip-label">Screen</div>
            ${this._strip(d.screen, d.start, d.end, "scr")}
            <div class="strip-label">Charger</div>
            ${this._strip(d.plugged, d.start, d.end, "plug")}
            <div class="strip-label">In front</div>
            <svg class="strip app" viewBox="0 0 1000 24" preserveAspectRatio="none" aria-hidden="true">
              <path class="on" d=${appD.on}></path>
              <path class="attn" d=${appD.attn}></path>
            </svg>
            ${this._axis(d)}
            ${this._hoverLine(d)}
          </div>
          <div class="legend">
            <span><i class="sw on"></i>On / charging / Fully</span>
            <span><i class="sw off"></i>Off / on battery</span>
            <span><i class="sw attn"></i>Other app in front</span>
            <span><i class="sw dead"></i>No contact</span>
          </div>
        </div>`;
    }

    _batterySection(t, d) {
      const W = 1000, H = 220, span = Math.max(1, d.end - d.start);
      const pts = d.battery;
      const X = (ts) => ((ts - d.start) / span) * W;
      const Y = (v) => H - (v / 100) * H;
      let path = "", area = "";
      if (pts.length) {
        const first = pts[0];
        const startV = first.t > d.start ? first.v : null;
        const seq = [];
        if (first.t > d.start && startV != null) seq.push({ t: d.start, v: startV });
        seq.push(...pts);
        seq.push({ t: d.end, v: seq[seq.length - 1].v });
        path = seq.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
        area = `${path} L${W},${H} L${X(seq[0].t).toFixed(1)},${H} Z`;
      }
      let bands = "";
      for (const g of d.plugged) if (g.s === "on") { const x = X(g.from).toFixed(1), w = Math.max(0.5, X(g.to) - X(g.from)).toFixed(1); bands += `M${x} 0h${w}v${H}h-${w}Z`; }
      const last = pts.length ? pts[pts.length - 1].v : null;
      return html`
        <div class="section">
          <div class="sec-head"><ha-icon icon="mdi:battery-charging"></ha-icon><span>Battery</span>
            <span class="count">${last != null ? `${Math.round(last)}% now` : ""}</span></div>
          <div class="chart bat" @pointermove=${(e) => this._hoverAt(e, d)} @pointerleave=${() => (this._hover = null)}>
            <div class="ylab"><span>100%</span><span>50%</span><span>0%</span></div>
            <div class="plot">
              <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
                <line class="grid" x1="0" x2=${W} y1=${H / 2} y2=${H / 2}></line>
                <line class="grid" x1="0" x2=${W} y1=${H * 0.8} y2=${H * 0.8}></line>
                <path class="band" d=${bands}></path>
                <path class="area" d=${area}></path>
                <path class="line" d=${path}></path>
              </svg>
              ${pts.length ? "" : html`<div class="ov soft"><span class="row-sub">No battery readings in this range</span></div>`}
            </div>
            ${this._axis(d)}
            ${this._hoverLine(d)}
          </div>
        </div>`;
    }

    _hoverAt(e, d) {
      const box = e.currentTarget.querySelector(".plot") || e.currentTarget.querySelector(".strip");
      if (!box) return;
      const r = box.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const ts = d.start + f * (d.end - d.start);
      const at = (segs) => segs.find((g) => ts >= g.from && ts < g.to)?.s;
      const bat = [...d.battery].reverse().find((p) => p.t <= ts)?.v;
      const scr = at(d.screen), plug = at(d.plugged), app = appInfo(at(d.fg));
      this._hover = { f, ts, bat, scr, plug, app };
    }
    _hoverLine(d) {
      const h = this._hover;
      if (!h) return "";
      const bits = [];
      if (h.bat != null) bits.push(`${Math.round(h.bat)}%`);
      if (h.scr) bits.push(DEAD.includes(h.scr) ? "no contact" : `screen ${h.scr}`);
      if (h.plug === "on") bits.push("charging");
      if (h.app && !h.app.fully) bits.push(h.app.name);
      const span = d.end - d.start;
      return html`
        <div class="xline" style="--f:${h.f}"></div>
        <div class="tip ${h.f > 0.6 ? "left" : ""}" style="--f:${h.f}">
          <b>${fmtTime(h.ts, span > 26 * 3600e3)}</b>${bits.length ? html`<span>${bits.join(" · ")}</span>` : ""}
        </div>`;
    }

    _logSection(t, d) {
      const all = d.log;
      const max = this._logMax || 40;
      const rows = all.slice(0, max);
      return html`
        <div class="section log">
          <div class="sec-head"><ha-icon icon="mdi:format-list-bulleted"></ha-icon><span>Activity</span>
            <span class="count">${all.length} event${all.length === 1 ? "" : "s"}</span></div>
          ${rows.length ? html`
            <ul class="log-list">
              ${rows.map((r) => html`
                <li>
                  <span class="log-ic tone-${r.tone}"><ha-icon .icon=${r.icon}></ha-icon></span>
                  <span class="log-text"><span class="log-title">${r.text}</span><span class="log-sub">${r.sub}</span></span>
                </li>`)}
            </ul>
            ${all.length > max ? html`<button class="pill-btn wide" @click=${() => { this._logMax = max + 60; this.requestUpdate(); }}>Show ${Math.min(60, all.length - max)} more</button>` : ""}`
          : html`<div class="row-sub">Nothing recorded in this range. Screen, charger, app and restart events show up here, plus actions taken from this sheet.</div>`}
        </div>`;
    }

    static get styles() {
      return css`
        :host {
          position: fixed; inset: 0; z-index: 10000; display: block;
          color: var(--primary-text-color, #e1e1e1);
          --bg: var(--ha-card-background, var(--card-background-color, #1c1c1c));
          --soft: rgba(var(--rgb-primary-text-color, 225, 225, 225), 0.07);
          --soft2: rgba(var(--rgb-primary-text-color, 225, 225, 225), 0.12);
          --accent: var(--primary-color, #03a9f4);
          --danger: var(--error-color, #db4437);
          --ok: var(--success-color, #43a047);
          --warn: var(--warning-color, #ffa600);
          -webkit-tap-highlight-color: transparent;
        }
        * { box-sizing: border-box; }
        button { font: inherit; color: inherit; -webkit-tap-highlight-color: transparent; }
        button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        code { font-size: 12px; background: var(--soft2); padding: 1px 5px; border-radius: 4px; }
        .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); animation: fade-in .24s ease; }
        .backdrop.closing { animation: fade-out .24s ease forwards; }
        .sheet {
          position: fixed; left: 0; right: 0; bottom: 0; margin: 0 auto; max-width: 520px;
          max-height: 90vh; max-height: 90dvh; display: flex; flex-direction: column; background: var(--bg);
          border-radius: 18px 18px 0 0; box-shadow: 0 -8px 32px rgba(0,0,0,.35);
          animation: slide-up .28s cubic-bezier(.25,1,.4,1); transition: transform .2s ease;
          padding-bottom: env(safe-area-inset-bottom, 0);
        }
        .sheet.closing { animation: slide-down .24s ease forwards; }
        @keyframes slide-up { from { transform: translateY(100%); } to { transform: none; } }
        @keyframes slide-down { from { transform: none; } to { transform: translateY(110%); } }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fade-out { from { opacity: 1; } to { opacity: 0; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .sheet, .dialog, .backdrop, .cf, .cf-scrim { animation-duration: .01s !important; }
          .spin, .act.busy ha-icon { animation: none !important; }
        }

        .header { padding: 6px 16px 12px; cursor: grab; touch-action: none; flex-shrink: 0; }
        .grabber { width: 40px; height: 4px; border-radius: 2px; background: var(--divider-color, rgba(120,120,120,.4)); margin: 6px auto 12px; }
        .title-row { display: flex; align-items: center; gap: 8px; }
        .title-row > ha-icon { color: var(--secondary-text-color); }
        .title { flex: 1; min-width: 0; font-size: 18px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .close { width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer; display: flex;
          align-items: center; justify-content: center; background: var(--soft2); color: var(--secondary-text-color); flex-shrink: 0; }
        .close:active { transform: scale(.94); }

        /* tabs (phone) + segmented page switch */
        .tabs, .seg { display: flex; background: var(--soft); border-radius: 12px; padding: 3px; gap: 3px; margin-top: 12px; cursor: default; }
        .tab, .seg-btn { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 6px; border: none; background: transparent;
          padding: 9px 4px; border-radius: 10px; color: var(--secondary-text-color); font-weight: 500; cursor: pointer;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
        .tab.on, .seg-btn.on { background: var(--bg); color: var(--primary-text-color); box-shadow: 0 1px 3px rgba(0,0,0,.25); }
        .seg-btn ha-icon { --mdc-icon-size: 18px; }
        .seg-btn.on ha-icon { color: var(--accent); }
        .content-head .seg { margin: 0; width: 240px; flex-shrink: 0; }
        .content-head .seg-btn { padding: 7px 4px; font-size: 13px; }
        .tab .here { --mdc-icon-size: 15px; color: var(--accent); flex-shrink: 0; }
        .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--disabled-color, #8a8a8a); }
        .dot.on { background: var(--ok); }
        .dot.offline { background: var(--danger); }

        /* ---- tablet / desktop: centred dialog with sidebar ---- */
        .dialog { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(1060px, 94vw); height: min(86vh, 880px);
          display: flex; background: var(--bg); border-radius: 22px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.4);
          animation: dlg-in .22s cubic-bezier(.25,1,.4,1); }
        .dialog.closing { animation: dlg-out .2s ease forwards; }
        @keyframes dlg-in { from { opacity: 0; transform: translate(-50%, -48%) scale(.97); } to { opacity: 1; transform: translate(-50%, -50%); } }
        @keyframes dlg-out { to { opacity: 0; transform: translate(-50%, -48%) scale(.97); } }
        .side { width: 236px; flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; padding: 22px 14px 16px;
          background: var(--secondary-background-color, rgba(120,120,120,.08)); }
        .side-head { display: flex; align-items: center; gap: 8px; padding: 0 8px 14px; }
        .side-title { flex: 1; font-size: 22px; font-weight: 600; }
        nav { display: flex; flex-direction: column; gap: 4px; }
        .nav-sep { height: 1px; background: var(--divider-color, rgba(120,120,120,.3)); margin: 8px 10px; }
        .nav-item { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: none; border-radius: 12px; background: transparent;
          text-align: left; font-weight: 500; font-size: 15px; color: var(--secondary-text-color); cursor: pointer; min-width: 0; }
        .nav-item ha-icon { --mdc-icon-size: 20px; flex-shrink: 0; }
        .nav-item.on { background: var(--bg); color: var(--primary-text-color); box-shadow: 0 1px 3px rgba(0,0,0,.15); }
        .nav-item.on > ha-icon { color: var(--accent); }
        .nav-dot { width: 20px; display: flex; justify-content: center; flex-shrink: 0; }
        .nav-dot .dot { width: 9px; height: 9px; }
        .nav-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .nav-item .here { --mdc-icon-size: 15px; color: var(--accent); margin-left: -6px; }
        .nav-bat { display: inline-flex; align-items: center; gap: 1px; font-size: 12px; font-weight: 500; color: var(--secondary-text-color);
          font-variant-numeric: tabular-nums; flex-shrink: 0; }
        .nav-bat ha-icon { --mdc-icon-size: 13px; }
        .nav-bat.ok ha-icon { color: var(--ok); }
        .nav-bat.warn { color: var(--danger); }
        .side-spacer { flex: 1; }
        .mini { display: flex; align-items: center; gap: 10px; padding: 8px; border: none; border-radius: 14px; background: var(--bg);
          cursor: pointer; text-align: left; width: 100%; }
        .mini:active { transform: scale(.98); }
        .mini-ic { width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
          background: var(--soft2); color: var(--secondary-text-color); }
        .mini-ic ha-icon { --mdc-icon-size: 22px; }
        .mini-ic.tone-ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 15%, transparent); }
        .mini-ic.tone-warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 18%, transparent); }
        .mini-ic.tone-bad { color: var(--danger); background: color-mix(in srgb, var(--danger) 15%, transparent); }
        .mini-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .mini-text > span, .mini-text > small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mini-text > span { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
        .mini-text .mini-tag { font-size: 11px; font-weight: 500; color: var(--secondary-text-color); }
        .mini-text > small { font-size: 11px; color: var(--secondary-text-color); }
        .content { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
        .content-head { display: flex; align-items: center; gap: 10px; padding: 20px 20px 10px; flex-shrink: 0; }
        .content-head h2 { flex: 1; margin: 0; font-size: 21px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .content-head .count { margin-left: 0; }
        :host([layout="dialog"]) .body { padding: 4px 20px 24px; }
        :host([layout="dialog"]) .tab-body { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 14px; align-items: start; }
        :host([layout="dialog"]) .tab-body > .full { grid-column: 1 / -1; }
        :host([layout="dialog"]) .tab-body > .s-shot { grid-row: span 2; }
        :host([layout="dialog"]) .tab-body.cols { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); align-items: stretch; }
        :host([layout="dialog"]) .tab-body.cols > .col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
        :host([layout="dialog"]) .tab-body.cols > .col > .section:last-child { flex: 1; }
        :host([layout="dialog"]) .tab-body.cols .power > .act.danger { margin-top: auto; }
        :host([layout="dialog"]) .tab-body.cols .act-grid > .act:last-child:nth-child(odd) { grid-column: auto; }
        :host([layout="dialog"]) .tab-body.hist { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); }
        .act-grid.one { grid-template-columns: minmax(0, 1fr); }
        :host([layout="dialog"]) .cf-scrim { border-radius: 22px; }
        :host([layout="dialog"]) .cf { top: 50%; bottom: auto; left: 50%; right: auto; width: min(440px, 90%); transform: translate(-50%, -50%);
          animation: fade-in .18s ease; }

        /* overview */
        .ov-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
        .ovc { gap: 10px; padding: 10px; }
        .ovc.off .ov-shot { opacity: .6; }
        .ov-shot { position: relative; display: block; width: 100%; aspect-ratio: 16 / 10; padding: 0; border: none; border-radius: 10px;
          overflow: hidden; background: #000; cursor: pointer; }
        .ov-shot img { width: 100%; height: 100%; object-fit: contain; display: block; }
        .ov-shot:active img { opacity: .85; }
        .ovc .row { padding: 0 4px 2px; gap: 10px; }
        .ovc .dot { width: 9px; height: 9px; }
        .ovc .row-title { display: flex; align-items: center; gap: 4px; }
        .here-sm { --mdc-icon-size: 15px; color: var(--accent); }
        .warn-t { color: var(--danger); }

        .body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 16px 24px;
          display: flex; flex-direction: column; gap: 14px; }
        .tab-body { display: contents; }
        :host([layout="sheet"]) .tab-body.hist > .col { display: contents; }
        .section { background: var(--secondary-background-color, rgba(120,120,120,.08)); border-radius: 14px;
          padding: 14px; display: flex; flex-direction: column; gap: 12px; }
        .section.center { align-items: center; justify-content: center; padding: 28px; gap: 8px; }
        .section.center ha-icon { --mdc-icon-size: 28px; color: var(--secondary-text-color); }

        .chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 999px; border: none;
          font-size: 12px; background: var(--soft); color: var(--secondary-text-color); white-space: nowrap; min-width: 0; }
        .chip ha-icon { --mdc-icon-size: 15px; flex-shrink: 0; }
        .chip.on { color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); }
        .chip.warn { color: var(--danger); background: color-mix(in srgb, var(--danger) 14%, transparent); }
        .chip.page { max-width: 100%; }
        .chip.attn { color: color-mix(in srgb, var(--warn) 60%, var(--primary-text-color)); background: color-mix(in srgb, var(--warn) 18%, transparent); }
        .attn-t { color: color-mix(in srgb, var(--warn) 65%, var(--primary-text-color)); font-weight: 600; }
        .chip .ell { overflow: hidden; text-overflow: ellipsis; }
        .chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .chips:empty { display: none; }

        .sec-head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
        .sec-head > ha-icon { color: var(--secondary-text-color); --mdc-icon-size: 20px; }
        .count { margin-left: auto; font-size: 12px; font-weight: 500; color: var(--secondary-text-color); white-space: nowrap; }

        .icon-btn { width: 42px; height: 42px; border: none; border-radius: 50%; background: transparent; cursor: pointer;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .icon-btn:active { background: var(--soft2); }
        .icon-btn.soft { background: var(--soft); }
        .icon-btn.sm { width: 34px; height: 34px; }
        .icon-btn.sm ha-icon { --mdc-icon-size: 20px; }
        .icon-btn:disabled { opacity: .4; cursor: default; }
        .spin { animation: spin 1s linear infinite; }
        .plug-row { display: flex; align-items: center; gap: 12px; }
        .pill-btn { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; border: none; border-radius: 999px; padding: 8px 14px;
          font-size: 13px; font-weight: 500; background: var(--soft2); cursor: pointer; white-space: nowrap; }
        .pill-btn ha-icon { --mdc-icon-size: 16px; }
        .pill-btn:disabled { opacity: .45; cursor: default; }
        .pill-btn:active { background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--accent); }
        .pill-btn.wide { justify-content: center; }

        /* screenshot */
        .shot { position: relative; display: block; width: 100%; aspect-ratio: 16 / 10; padding: 0; border: none;
          border-radius: 12px; overflow: hidden; background: #000; cursor: pointer; }
        .shot.portrait { aspect-ratio: 10 / 16; width: auto; max-width: 100%; height: min(55vh, 520px); margin: 0 auto; }
        .shot:disabled { cursor: default; }
        .shot img { width: 100%; height: 100%; object-fit: contain; display: block; }
        .shot:not(:disabled):active img { opacity: .85; }
        .ov { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 6px; padding: 16px; text-align: center; font-size: 13px; color: rgba(255,255,255,.88); background: rgba(0,0,0,.6); }
        .ov.soft { background: transparent; color: inherit; }
        .ov ha-icon { --mdc-icon-size: 30px; }
        .ov small { font-size: 12px; color: rgba(255,255,255,.65); max-width: 280px; line-height: 1.35; }
        .badge { position: absolute; left: 8px; top: 8px; display: flex; align-items: center; gap: 4px; padding: 3px 9px;
          border-radius: 999px; background: rgba(0,0,0,.65); color: #fff; font-size: 11px; }
        .badge ha-icon { --mdc-icon-size: 14px; }

        /* rows + toggle */
        .row { display: flex; align-items: center; gap: 12px; }
        .row-icon { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center;
          background: var(--soft2); color: var(--secondary-text-color); flex-shrink: 0; transition: background .2s, color .2s; }
        .row-icon.sm { width: 36px; height: 36px; border-radius: 10px; }
        .row-icon.on { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
        .row-icon.tone-ok { background: color-mix(in srgb, var(--ok) 15%, transparent); color: var(--ok); }
        .row-icon.tone-warn { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
        .row-icon.tone-bad { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
        .row-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .row-title { font-weight: 600; font-size: 15px; }
        .row-sub { font-size: 13px; color: var(--secondary-text-color); }
        .ovc .row-title, .ovc .row-sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .toggle { position: relative; width: 52px; height: 32px; border-radius: 16px; border: none; padding: 0; flex-shrink: 0;
          background: var(--soft2); cursor: pointer; transition: background .2s ease; }
        .toggle .knob { position: absolute; top: 3px; left: 3px; width: 26px; height: 26px; border-radius: 50%; background: #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .22s cubic-bezier(.25,1,.4,1); }
        .toggle.on { background: var(--accent); }
        .toggle.on .knob { transform: translateX(20px); }
        .toggle:disabled { opacity: .4; cursor: default; }

        .vol-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: -6px; }
        .lbl { font-size: 14px; }
        .val { font-size: 13px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
        .vol-row { display: flex; align-items: center; gap: 10px; }
        .sun { color: var(--secondary-text-color); --mdc-icon-size: 20px; flex-shrink: 0; }

        /* slider — matches the tile card brightness feature */
        .slider { position: relative; flex: 1 1 auto; min-width: 0; height: 42px; border-radius: 12px; overflow: hidden;
          isolation: isolate; cursor: pointer; touch-action: pan-y; user-select: none; --c: var(--accent); }
        .slider::before { content: ""; position: absolute; inset: 0; background: var(--c); opacity: .2; }
        .slider .fill { --h: 4px; --m: calc(42px / 8); --min: calc(var(--h) + var(--m) * 2);
          position: absolute; top: 0; bottom: 0; left: 0;
          width: calc(var(--min) + (100% - var(--min)) * var(--v, 0));
          background: var(--c); border-radius: 0 12px 12px 0; transition: width 180ms ease-in-out; }
        .slider.dragging .fill { transition: none; }
        .slider .fill::after { content: ""; position: absolute; top: 0; bottom: 0; margin: auto 0; right: var(--m);
          width: var(--h); height: 50%; border-radius: 4px; background: #fff; }
        .slider .fill.empty { display: none; }
        .slider.disabled { opacity: .4; cursor: default; }

        /* actions */
        .act-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        .act-grid > .act:last-child:nth-child(odd) { grid-column: 1 / -1; }
        .act { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; padding: 12px;
          border: none; border-radius: 12px; background: var(--soft); cursor: pointer; text-align: left;
          transition: transform .1s ease, background .15s ease; }
        .act > ha-icon { color: var(--accent); margin-bottom: 6px; }
        .act-title { font-weight: 600; font-size: 14px; }
        .act-sub { font-size: 12px; color: var(--secondary-text-color); line-height: 1.3; }
        .act:not(:disabled):active { background: var(--soft2); transform: scale(.98); }
        .act:disabled { opacity: .4; cursor: default; }
        .act.busy > ha-icon { animation: spin 1s linear infinite; }
        .act.danger { flex-direction: row; align-items: center; justify-content: center; gap: 8px; padding: 13px;
          color: var(--danger); font-weight: 600; background: color-mix(in srgb, var(--danger) 12%, transparent); }
        .act.danger > ha-icon { color: inherit; margin: 0; }

        .offline-box { flex-direction: row; align-items: center; gap: 12px;
          background: color-mix(in srgb, var(--danger) 10%, var(--secondary-background-color, transparent)); }
        .offline-box > ha-icon { color: var(--danger); flex-shrink: 0; }

        /* tablet details */
        details.info { gap: 0; }
        details.info summary { display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; list-style: none; }
        details.info summary::-webkit-details-marker { display: none; }
        details.info summary > ha-icon { color: var(--secondary-text-color); --mdc-icon-size: 20px; }
        details.info summary .chev { margin-left: auto; transition: transform .2s ease; }
        details.info[open] summary .chev { transform: rotate(180deg); }
        .info-grid { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 16px; font-size: 13px; padding-top: 12px; }
        .info-grid .k { color: var(--secondary-text-color); }
        .info-grid .v { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        /* ---- history ---- */
        .range-row { flex-direction: row; align-items: center; gap: 10px; padding: 8px 10px; }
        .range-row .seg { margin: 0; flex: 1; max-width: 320px; }
        .range-row .seg-btn { padding: 7px 4px; font-size: 13px; }
        .stats { flex-direction: row; flex-wrap: wrap; gap: 10px; padding: 12px; }
        .stat { display: flex; align-items: center; gap: 10px; flex: 1 1 150px; min-width: 0; }
        .stat-text { display: flex; flex-direction: column; min-width: 0; }
        .stat-label { font-size: 11px; font-weight: 500; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .04em; }
        .stat-value { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.2; }
        .stat-sub { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .chart { position: relative; display: flex; flex-direction: column; gap: 4px; touch-action: pan-y; }
        .strip-label { font-size: 11px; color: var(--secondary-text-color); margin-top: 4px; }
        .strip { display: block; width: 100%; height: 22px; border-radius: 6px; overflow: hidden; background: var(--soft); color: var(--danger); }
        .strip path.on { fill: var(--accent); }
        .strip path.off { fill: transparent; }
        .strip.plug path.on { fill: var(--ok); }
        .strip.app path.on { fill: var(--accent); opacity: .55; }
        .strip.app path.attn { fill: var(--warn); }
        .axis { position: relative; height: 16px; font-size: 11px; color: var(--secondary-text-color); margin-top: 2px; }
        .axis span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
        .axis span:first-child { transform: none; }
        .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11px; color: var(--secondary-text-color); }
        .legend span { display: inline-flex; align-items: center; gap: 5px; }
        .sw { width: 12px; height: 8px; border-radius: 2px; display: inline-block; background: var(--soft2); }
        .sw.on { background: var(--accent); }
        .sw.off { background: var(--soft2); }
        .sw.attn { background: var(--warn); }
        .sw.dead { background: repeating-linear-gradient(45deg, var(--danger) 0 2px, transparent 2px 5px); }
        .chart.bat { flex-direction: row; flex-wrap: wrap; align-items: stretch; gap: 0 6px; }
        .chart.bat .ylab { display: flex; flex-direction: column; justify-content: space-between; font-size: 11px; color: var(--secondary-text-color);
          height: 150px; text-align: right; width: 34px; }
        .chart.bat .plot { position: relative; flex: 1; min-width: 0; height: 150px; border-radius: 8px; overflow: hidden; background: var(--soft); }
        .chart.bat .plot svg { display: block; width: 100%; height: 100%; }
        .chart.bat .axis { flex-basis: 100%; margin-left: 40px; }
        .chart.bat .grid { stroke: var(--divider-color, rgba(120,120,120,.35)); stroke-width: 1; vector-effect: non-scaling-stroke; }
        .chart.bat .band { fill: var(--ok); opacity: .14; }
        .chart.bat .area { fill: var(--accent); opacity: .12; }
        .chart.bat .line { fill: none; stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
        .chart.bat .ov { position: absolute; inset: 0; }
        .xline { position: absolute; top: 0; bottom: 16px; width: 1px; background: var(--primary-text-color); opacity: .5; pointer-events: none;
          left: calc(100% * var(--f, 0)); }
        .chart.bat .xline { left: calc(40px + (100% - 40px) * var(--f, 0)); }
        .tip { position: absolute; top: 4px; left: calc(100% * var(--f, 0)); transform: translateX(8px); padding: 6px 9px; border-radius: 8px; background: var(--bg);
          box-shadow: 0 4px 16px rgba(0,0,0,.3); font-size: 12px; display: flex; flex-direction: column; gap: 2px; pointer-events: none; z-index: 2;
          white-space: nowrap; }
        .chart.bat .tip { left: calc(40px + (100% - 40px) * var(--f, 0)); }
        .tip.left { transform: translateX(calc(-100% - 8px)); }
        .tip span { color: var(--secondary-text-color); }
        .log { gap: 8px; }
        .log-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
        .log-list li { display: flex; align-items: center; gap: 10px; padding: 6px 4px; border-radius: 10px; }
        .log-ic { width: 32px; height: 32px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          background: var(--soft); color: var(--secondary-text-color); }
        .log-ic ha-icon { --mdc-icon-size: 18px; }
        .log-ic.tone-on { color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); }
        .log-ic.tone-ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 15%, transparent); }
        .log-ic.tone-warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 18%, transparent); }
        .log-ic.tone-bad { color: var(--danger); background: color-mix(in srgb, var(--danger) 15%, transparent); }
        .log-ic.tone-attn { color: color-mix(in srgb, var(--warn) 60%, var(--primary-text-color)); background: color-mix(in srgb, var(--warn) 18%, transparent); }
        .log-text { display: flex; flex-direction: column; min-width: 0; }
        .log-title { font-size: 14px; font-weight: 500; }
        .log-sub { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* confirmation / progress */
        .cf-scrim { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,.45);
          border-radius: 18px 18px 0 0; animation: fade-in .18s ease; }
        .cf { position: absolute; left: 12px; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); z-index: 21;
          max-width: 480px; margin: 0 auto;
          display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px 16px 16px; text-align: center;
          background: var(--bg); border-radius: 18px; box-shadow: 0 12px 36px rgba(0,0,0,.4);
          animation: cf-up .22s cubic-bezier(.25,1,.4,1); }
        @keyframes cf-up { from { opacity: 0; transform: translateY(20px) scale(.97); } to { opacity: 1; transform: none; } }
        .cf-icon { width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          color: var(--danger); background: color-mix(in srgb, var(--danger) 15%, transparent); }
        .cf-icon.calm { color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); }
        .cf-icon ha-icon { --mdc-icon-size: 28px; }
        .cf-title { margin-top: 4px; font-size: 17px; font-weight: 600; }
        .cf-text { max-width: 340px; font-size: 13px; line-height: 1.4; color: var(--secondary-text-color); }
        .cf-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; margin-top: 8px; }
        .cf-btns button { border: none; border-radius: 12px; padding: 13px; font-weight: 600; cursor: pointer; }
        .cf-btns button:active { filter: brightness(.92); }
        .cf-cancel { background: var(--soft2); }
        .cf-go { background: var(--danger); color: #fff !important; }

        .toast { position: absolute; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
          z-index: 30; max-width: calc(100% - 32px); padding: 10px 16px; border-radius: 12px; background: rgba(30,30,30,.92); color: #fff;
          font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,.35); animation: fade-in .2s ease; pointer-events: none;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        @media (max-width: 360px) {
          .tab { font-size: 13px; gap: 4px; }
          .act-sub { display: none; }
        }
      `;
    }
  }
  if (!customElements.get("fully-tablet-sheet")) customElements.define("fully-tablet-sheet", TabletSheet);

  /* ================================================================== */
  /* Opener, hash routes, idle close                                     */
  /* ================================================================== */
  window.openTabletSheet = ({ tablet, page, from } = {}) => {
    const hass = getHass();
    if (!allowedHere(hass)) {
      haptic("failure");
      console.info(TAG, "not opened: this tablet isn't on the allow list");
      return null;
    }
    const existing = document.body.querySelector("fully-tablet-sheet");
    if (existing && !existing._closing) {
      if (tablet || page) existing.openTab(tablet, page);
      return existing;
    }
    existing?.remove();
    const el = document.createElement("fully-tablet-sheet");
    el.hass = hass;
    const src = from || document.querySelector("home-assistant");
    if (src) {
      const cs = getComputedStyle(src);
      THEME_VARS.forEach((v) => { const val = cs.getPropertyValue(v); if (val && val.trim()) el.style.setProperty(v, val.trim()); });
      el.style.fontFamily = cs.fontFamily;
    }
    document.body.appendChild(el);
    if (tablet || page) el.openTab(tablet, page);
    return el;
  };
  window.addEventListener("tablet-sheet-open", (e) => window.openTabletSheet(e.detail || {}));
  window.fullyTabletSheet = { version: VERSION, configure, open: (o) => window.openTabletSheet(o), tablets: () => tabletsOf(getHass()), settings };

  /* #tablets · #tablets-history · #tablet-<key> · #tablet-<key>-history */
  const routeHash = () => {
    const m = location.hash.match(/^#tablets?(?:-([a-z0-9_]+?))?(-history)?$/i);
    if (!m) return;
    const hass = getHass();
    if (!hass) { setTimeout(routeHash, 300); return; }
    let tablet = m[1] && m[1] !== "history" ? m[1] : null;
    const page = m[2] || m[1] === "history" ? "history" : "controls";
    if (!tablet && local.ok) tablet = resolveLocal(hass) || null;
    window.openTabletSheet({ tablet: tablet || (page === "history" ? tabletsOf(hass)[0]?.key : OVERVIEW), page });
  };
  window.addEventListener("location-changed", routeHash);
  window.addEventListener("hashchange", routeHash);
  window.addEventListener("popstate", () => { if (!/^#tablets?(-|$)/.test(location.hash)) document.querySelectorAll("fully-tablet-sheet").forEach((s) => !s._closing && s.close()); });
  setTimeout(routeHash, 500);

  /* Idle close — a little longer than other sheets so you can watch the screenshot */
  (() => {
    const IDLE_PHONE_S = 60, IDLE_TABLET_S = 120, TABLET_MIN_SIDE = 600;
    const idleMs = () => (Math.min(window.screen.width, window.screen.height) >= TABLET_MIN_SIDE ? IDLE_TABLET_S : IDLE_PHONE_S) * 1000;
    let last = Date.now();
    const bump = () => (last = Date.now());
    for (const ev of ["pointerdown", "pointermove", "touchstart", "touchmove", "keydown", "wheel", "input"]) {
      window.addEventListener(ev, bump, { capture: true, passive: true });
    }
    const closeInstant = () => document.querySelectorAll("fully-tablet-sheet").forEach((s) => s.remove());
    document.addEventListener("visibilitychange", () => document.hidden && closeInstant());
    window.addEventListener("pagehide", closeInstant);
    let wasOpen = false;
    setInterval(() => {
      if (document.hidden) return;
      const open = [...document.querySelectorAll("fully-tablet-sheet")].filter((s) => !s._closing);
      if (!open.length) { wasOpen = false; return; }
      if (!wasOpen) { wasOpen = true; bump(); return; }
      if (open.some((s) => s._confirm)) return;
      if (Date.now() - last < idleMs()) return;
      open.forEach((s) => s.close());
      wasOpen = false;
    }, 1000);
  })();

  /* ================================================================== */
  /* Dashboard actions shared by the button and the chips               */
  /* ================================================================== */
  const runAction = (el, hass, action, t) => {
    if (!action || action.action === "none") return false;
    const a = action.action;
    if (a === "navigate" && action.navigation_path) { navigate(action.navigation_path); return true; }
    if (a === "url" && action.url_path) { window.open(action.url_path, "_blank", "noopener"); return true; }
    if (a === "more-info") {
      const entityId = action.entity || (t ? `switch.${t.prefix}_screen` : null);
      if (entityId) el.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId } }));
      return true;
    }
    if (a === "perform-action" || a === "call-service") {
      const svc = action.perform_action || action.service;
      if (!svc) return false;
      const [domain, service] = svc.split(".");
      hass.callService(domain, service, action.data || action.service_data || {}, action.target).catch((err) => console.warn(TAG, svc, err));
      return true;
    }
    if (a === "open-sheet") { window.openTabletSheet({ tablet: action.tablet || t?.key, page: action.page, from: el }); return true; }
    if (a === "open-history") { window.openTabletSheet({ tablet: action.tablet || t?.key, page: "history", from: el }); return true; }
    if (a === "launch-app" && action.app_package && t) { launchApp(hass, t, action.app_package); return true; }
    return false;
  };

  /* Tap / hold / double-tap without pulling in HA's action handler */
  const gestures = (host, { onTap, onHold, onDouble }) => {
    let holdT = null, held = false, lastTap = 0, dblT = null;
    const down = (e) => {
      if (e.button != null && e.button !== 0) return;
      held = false;
      clearTimeout(holdT);
      holdT = setTimeout(() => { held = true; if (onHold?.()) haptic("medium"); }, 500);
    };
    const up = () => { clearTimeout(holdT); };
    const cancel = () => { clearTimeout(holdT); held = true; };
    const click = (e) => {
      if (held) { held = false; e.preventDefault(); return; }
      if (onDouble) {
        const now = Date.now();
        if (now - lastTap < 250) { clearTimeout(dblT); lastTap = 0; onDouble(); return; }
        lastTap = now;
        clearTimeout(dblT);
        dblT = setTimeout(() => { lastTap = 0; onTap?.(); }, 250);
        return;
      }
      onTap?.();
    };
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", cancel);
    host.addEventListener("pointerleave", cancel);
    host.addEventListener("click", click);
    host.addEventListener("contextmenu", (e) => { if (onHold) e.preventDefault(); });
    host.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap?.(); } });
  };

  /* Pick the tablet a card talks about: config.tablet, else this tablet (inside Fully), else the first one */
  const tabletFor = (hass, cfg) => {
    if (!hass) return null;
    if (cfg?.tablet) return findTablet(hass, cfg.tablet);
    const lk = resolveLocal(hass);
    return (lk && findTablet(hass, lk)) || tabletsOf(hass)[0] || null;
  };
  const stateOf = (hass, t) => {
    const I = ids(t.prefix);
    const lk = resolveLocal(hass);
    const me = t.key === lk && local.ok;
    const snap = me ? local.snap() : null;
    const scr = hass.states?.[I.screen];
    const online = me ? true : !!scr && !DEAD.includes(scr.state);
    const on = me ? snap?.screenOn !== false : scr?.state === "on";
    const level = me && Number.isFinite(Number(snap?.battery)) ? Number(snap.battery) : parseFloat(hass.states?.[I.battery]?.state);
    const charging = me ? !!snap?.plugged : hass.states?.[I.plugged]?.state === "on";
    const app = me ? null : appInfo(hass.states?.[I.fg]?.state);
    return { I, me, online, on, level: Number.isFinite(level) ? level : null, charging, app };
  };

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
