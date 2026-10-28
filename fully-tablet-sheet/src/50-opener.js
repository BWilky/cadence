
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
