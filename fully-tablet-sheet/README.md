# Fully Tablet Sheet

Fully Kiosk Browser tablet controls for Home Assistant, in one resource:

| Element | What it is |
|---|---|
| `fully-tablet-sheet` | The sheet. Phones get a bottom sheet, tablets and desktops a centred dialog with a sidebar. Each tablet has **Controls** (screenshot, screen, brightness, browser actions, charger power cycle, restart) and **History** (screen on/off timeline, charger bands, app in front, battery curve, stats, activity log). |
| `fully-tablet-sheet-button` | A tile-style card that opens the sheet. |
| `fully-tablet-chip` | A Mushroom-style chip: `status`, `screen`, `battery`, `history`, `app`, `charger`, `open`. Works inside `mushroom-chips-card` too. |
| `fully-tablet-chips` | A row of those chips, no Mushroom needed. |

Tablets come from the [Fully Kiosk Browser integration](https://www.home-assistant.io/integrations/fully_kiosk/).
Leave `tablets:` out and every Fully device is discovered. One tablet is fine: the tab row and the
Overview disappear.

**Hybrid control.** On a phone or desktop every tablet goes through the integration. Inside Fully
Kiosk (PLUS, with *Enable JavaScript Interface* on) the sheet works out which tablet it is on and
drives that one natively through `window.fully`; the others still go through Home Assistant.

## Install

### HACS (recommended)

1. HACS → three dots → **Custom repositories** → add `https://github.com/BWilky/fully-tablet-sheet`, type **Dashboard**.
2. Search for **Fully Tablet Sheet** and download it. HACS registers the resource for you.
3. Hard-refresh the browser (or **Settings → Reset frontend cache** in the Companion app).

### Manual

Copy `fully-tablet-sheet.js` to `config/www/` and add `/local/fully-tablet-sheet.js?v=1.0.0` as a
**JavaScript module** resource under Settings → Dashboards → Resources. Bump `v=` whenever you
replace the file, otherwise browsers keep the old copy for a month.

## Cards

### Button

```yaml
type: custom:fully-tablet-sheet-button
title: Kitchen tablet          # default "Tablet Controls"
icon: mdi:tablet-dashboard
tablet: kitchen                # optional: which tablet this card is about (key, prefix or name)
page: controls                 # or history
tap_action: { action: open-sheet }     # defaults: tap opens the sheet, hold opens History
hold_action: { action: open-history }
```

### Chips row

```yaml
type: custom:fully-tablet-chips
alignment: start               # start | center | end | justify
tablet: kitchen                # optional default for every chip
chips:
  - chip: status               # "60% · On" — tap: sheet, hold: history
    show: [battery, screen, app]
  - chip: screen               # toggles the screen
  - chip: battery              # tap: history
  - chip: history
  - chip: app                  # launches an Android app on the tablet, from the tablet or a phone
    app_package: com.spotify.music
  - chip: charger              # the smart plug (needs `plug:` on the tablet)
  - chip: open                 # plain opener (Overview when there are several tablets)
```

Every chip takes `name`, `icon`, `icon_color` (Mushroom colour names, `#hex` or `r, g, b`),
`content` (override the text), `tablet`, `tap_action` and `hold_action`.

Inside a Mushroom chips card: `type: custom:fully-tablet-chip` plus the same keys, or the
shorthand types `custom:fully-tablet-chip-app`, `custom:fully-tablet-chip-status` and so on.

### Actions

`tap_action` / `hold_action` on the button and the chips accept:

| action | keys |
|---|---|
| `open-sheet` | `tablet`, `page` |
| `open-history` | `tablet` |
| `launch-app` | `app_package` |
| `navigate` | `navigation_path` |
| `url` | `url_path` |
| `more-info` | `entity` (default: the tablet's screen switch) |
| `perform-action` | `perform_action`, `data`, `target` |
| `none` | |

### Opening the sheet from anywhere

- Any card with `tap_action: {action: navigate, navigation_path: "#tablets"}`.
  Routes: `#tablets`, `#tablets-history`, `#tablet-<key>`, `#tablet-<key>-history`.
- JavaScript: `window.openTabletSheet({ tablet: "kitchen", page: "history" })` or
  `window.dispatchEvent(new CustomEvent("tablet-sheet-open", { detail: { tablet: "kitchen" } }))`.

## Settings

These keys can go on any card (button, chip or chips row); the last one read wins and applies
to the whole page.

```yaml
tablets:                       # omit to discover every Fully Kiosk device
  - name: Kitchen
    short: Kitchen             # tab label on phones
    prefix: tabletkitchen      # entity id stem: switch.<prefix>_screen, sensor.<prefix>_battery ...
    plug: switch.kitchen_tablet_plug   # optional smart plug on the charger
    icon: mdi:tablet
allow_on: [kitchen]            # inside Fully, only these tablets may open the sheet (default: all)
plug_off_seconds: 5            # charger power cycle length
charger_off_note: Off for battery conditioning   # shown under "Charger power" while the plug is off
log_actions: true              # write sheet actions to the Home Assistant logbook
history_hours: 24              # default History range (6, 24, 48 or 168)
screenshot_seconds: 15         # how often the screenshot refreshes
apps:                          # names + icons for packages the sheet doesn't know
  com.example.app: { name: Example, icon: mdi:star }
```

The `key` of a tablet is its slugified name (`Coffee Bar` → `coffee_bar`); discovered tablets use
their entity prefix. Keys are what `tablet:`, `allow_on:` and the hash routes use.

## History

The History page reads the recorder (`history/history_during_period`) and the logbook
(`logbook/get_events`) over the websocket, so it needs nothing beyond the default recorder.
It shows, for 6h / 24h / 48h / 7d:

- stats: screen-on time, wake-ups, time on charger, battery range, lost-contact count
- a screen on/off timeline, a charger timeline and an app-in-front timeline
- the battery curve with charging bands and a hover readout
- an activity log: screen, charger, app, restart and reload events, plus anything the sheet
  itself did (restart requested, brightness set to 40%, opened Spotify, …)

The Fully integration reports "unavailable" whenever it can't reach the tablet for a poll, so
"Lost contact" is a useful health signal for the Wi-Fi on a tablet.

## Battery management hooks

For a Fully-side battery script: the sheet reads `window.fk_tablet_state` (and re-renders on
`fk-state-changed`), dispatches `brightness_override` `{ brightness: 0–255 }` after a manual
brightness change and `pauseadaptivebrightness` for the pause button. Without such a script the
section simply doesn't show.

## Development

Plain JavaScript, no build step beyond concatenation: edit `src/*.js`, run `./build.sh`
(it also runs `node --check`) and commit the built `fully-tablet-sheet.js`. Lit is taken from the
Home Assistant frontend at runtime, so there are no dependencies.
