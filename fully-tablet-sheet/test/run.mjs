import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const browser = await chromium.launch();
const errors = [];
async function page(width, height, prefixes = ["tabletkitchen"], light = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`); });
  p.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  await p.addInitScript((pre) => { window.__prefixes = pre; }, prefixes);
  await p.goto("http://127.0.0.1:8765/harness.html");
  await p.waitForFunction(() => window.__ready && window.fullyTabletSheet, null, { timeout: 8000 }).catch(() => { console.log("LOAD FAILED", errors.join("\n")); process.exit(1); });
  if (light) await p.evaluate(() => document.body.classList.add("light"));
  return p;
}
const shot = (p, name) => p.screenshot({ path: path.join(here, "shots", name + ".png"), fullPage: false });
const addCards = async (p) => p.evaluate(() => {
  const stage = document.getElementById("stage");
  const chips = document.createElement("fully-tablet-chips");
  chips.setConfig({ chips: ["status", "screen", "battery", "history", { chip: "app", app_package: "com.spotify.music" }, { chip: "app", app_package: "com.disney.disneyplus", name: "Disney+" }, { chip: "charger" }, "open"] });
  chips.hass = window.__hass;
  const btn = document.createElement("fully-tablet-sheet-button");
  btn.setConfig({ title: "Tablet Controls", tablets: [{ name: "Kitchen", prefix: "tabletkitchen", plug: "switch.kitchen_tablet_plug" }] });
  btn.hass = window.__hass;
  const chip = document.createElement("fully-tablet-chip");
  chip.setConfig({ chip: "status", show: ["battery", "screen", "app"], name: "Kitchen" });
  chip.hass = window.__hass;
  stage.append(chips, btn, chip);
});

// 1. desktop, single tablet
let p = await page(1280, 900);
await addCards(p);
await p.waitForTimeout(400);
await shot(p, "01-cards-desktop");
await p.evaluate(() => window.openTabletSheet());
await p.waitForTimeout(700);
await shot(p, "02-dialog-controls");
await p.evaluate(() => window.openTabletSheet({ page: "history" }));
await p.waitForTimeout(900);
await p.mouse.move(700, 420);
await p.waitForTimeout(200);
await shot(p, "03-dialog-history");
// click a range chip and the restart confirmation
await p.evaluate(() => { const s = document.querySelector("fully-tablet-sheet"); s._setRange(168); });
await p.waitForTimeout(600);
await shot(p, "04-dialog-history-7d");
await p.evaluate(() => { const s = document.querySelector("fully-tablet-sheet"); s._setPage("controls"); });
await p.waitForTimeout(300);
await p.evaluate(() => { const s = document.querySelector("fully-tablet-sheet"); s.renderRoot.querySelector(".act.danger").click(); });
await p.waitForTimeout(300);
await shot(p, "05-dialog-confirm");
await p.evaluate(() => { const s = document.querySelector("fully-tablet-sheet"); s._go(); });
await p.waitForTimeout(300);
const calls1 = await p.evaluate(() => window.__calls.filter((c) => c.d));
// chips: app launch + screen toggle via tap
await p.evaluate(() => document.querySelector("fully-tablet-sheet")?.close());
await p.waitForTimeout(400);
await p.evaluate(() => { const chips = document.querySelector("fully-tablet-chips"); const els = chips.renderRoot.querySelectorAll("fully-tablet-chip"); els[4].renderRoot.querySelector(".chip").click(); els[1].renderRoot.querySelector(".chip").click(); });
await p.waitForTimeout(400);
const calls2 = await p.evaluate(() => window.__calls.filter((c) => c.d));
// hash route
await p.evaluate(() => { location.hash = "#tablet-kitchen-history"; });
await p.waitForTimeout(900);
const hashOpened = await p.evaluate(() => { const s = document.querySelector("fully-tablet-sheet"); return s ? `${s._tab}/${s._page}` : "none"; });
await p.evaluate(() => document.querySelector("fully-tablet-sheet")?.close());
await p.waitForTimeout(400);
const hashAfter = await p.evaluate(() => location.hash);
await p.context().close();

// 2. phone, single tablet
p = await page(390, 844);
await addCards(p);
await p.waitForTimeout(400);
await shot(p, "06-cards-phone");
await p.evaluate(() => window.openTabletSheet());
await p.waitForTimeout(700);
await shot(p, "07-sheet-controls");
await p.evaluate(() => document.querySelector("fully-tablet-sheet")._setPage("history"));
await p.waitForTimeout(900);
await shot(p, "08-sheet-history");
await p.evaluate(() => document.querySelector("fully-tablet-sheet").renderRoot.querySelector(".body").scrollTo(0, 2000));
await p.waitForTimeout(300);
await shot(p, "09-sheet-history-log");
await p.context().close();

// 3. desktop, three tablets, light theme
p = await page(1280, 900, ["tabletkitchen", "galaxy_office", "galaxy_bar"], true);
await p.evaluate(() => { const b = document.createElement("fully-tablet-sheet-button"); b.setConfig({}); b.hass = window.__hass; document.getElementById("stage").append(b); });
await p.evaluate(() => window.openTabletSheet({ tablet: "overview" }));
await p.waitForTimeout(800);
await shot(p, "10-overview-3-light");
await p.evaluate(() => window.openTabletSheet({ tablet: "galaxy_office" }));
await p.waitForTimeout(700);
await shot(p, "11-office-controls-light");
await p.context().close();

// 4. phone, three tablets
p = await page(390, 844, ["tabletkitchen", "galaxy_office", "galaxy_bar"]);
await p.evaluate(() => window.openTabletSheet({ tablet: "galaxy_bar" }));
await p.waitForTimeout(700);
await shot(p, "12-sheet-3-offline");
await p.context().close();

await browser.close();
console.log("service calls after restart confirm:", JSON.stringify(calls1));
console.log("service calls after chips:", JSON.stringify(calls2));
console.log("hash route opened:", hashOpened, "hash after close:", JSON.stringify(hashAfter));
console.log("console errors/warnings:", errors.length ? "\n" + errors.join("\n") : "none");
