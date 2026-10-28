# Changelog

## 1.0.0 — 2026-10-28

First release as a HACS plugin. Grown out of the `fully-tablet-sheet v5` resource
that ran inline on the Barnabas Landing station tablets.

- Tablets are configured (`tablets:`) or discovered from the Fully Kiosk integration;
  no more hard-coded list.
- One tablet works: no tab row, no Overview.
- History page per tablet: screen on/off timeline, charger bands, app-in-front strip,
  battery curve with hover, stats, activity log from the Home Assistant logbook.
- Actions taken in the sheet are written to the logbook (`log_actions: false` turns it off).
- Chips: status, screen, battery, history, app (launch an Android app on the tablet,
  from the tablet or from a phone), charger, open. Usable standalone (`fully-tablet-chips`)
  or inside `mushroom-chips-card`.
- Hash routes: `#tablets`, `#tablet-<key>`, `#tablet-<key>-history`, `#tablets-history`.
- Tap / hold actions on the button and the chips (`navigate`, `url`, `more-info`,
  `perform-action`, `open-sheet`, `open-history`, `launch-app`).
- The Barnabas battery-conditioning drain window is now a plain `charger_off_note`.
