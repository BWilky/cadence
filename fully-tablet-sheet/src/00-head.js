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
