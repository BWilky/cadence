# Cadence card

A Lovelace card for phones and wall tablets that shows Cadence's **auto mode**: whether Cadence
is driving the building and why, the current chapter and variant, what comes next, a hand-made
hold, and the whole day as a ribbon with the auto-mode band underneath. It also lets people
switch auto mode for today, resume after a hold, or start a chapter.

- **Tablets and desktop** (768 px and wider) get a centred dialog with a sidebar: Now, Today and
  This screen.
- **Phones** get a bottom sheet with a grabber and swipe-down to close. Chapters open a sub-sheet.

It lives in this repository because it reads the entities the Cadence app publishes, so the two
change together. A separate repository is only needed to install it through HACS.

## Install

1. Copy `cadence-card.js` to `/config/www/cadence-card.js` on the Home Assistant host.
2. **Settings → Dashboards → ⋮ → Resources → Add resource**: URL `/local/cadence-card.js?v=1.0.0`,
   type *JavaScript module*. Bump the `?v=` after every update, because `/local/` is cached for 31 days.
3. Create the command script (below) so non-admin screens can control Cadence.

The card needs Cadence **0.5.0** or later, which publishes `sensor.cadence_status`. On older
versions only admin accounts see data, read through the app's ingress API.

## Open it

| How | Example |
| --- | --- |
| Tile card | `type: custom:cadence-card` |
| Any button or tile | `tap_action: {action: navigate, navigation_path: "#cadence"}` |
| Straight to a page | `#cadence-today`, `#cadence-screen` (`#pop-up-cadence` also works) |
| JavaScript | `window.openCadenceSheet({ tab: "today" })` |
| Event | `window.dispatchEvent(new CustomEvent("cadence-sheet-open"))` |

### Tile options

| Option | Default | Meaning |
| --- | --- | --- |
| `name` | chapter name | Title on the tile |
| `icon` | follows the state | Icon on the tile |
| `ribbon` | `false` | Show today's ribbon under the tile |
| `vertical` | `false` | Icon above the text |
| `tab` | last used | Page to open: `now`, `today` or `screen` |
| `entity` | `sensor.cadence_status` | Status entity, if renamed |
| `popup` | see below | Pop-up defaults for screens showing this dashboard |

```yaml
type: custom:cadence-card
ribbon: true
popup:
  auto: true
  hold: true
  chapter: false
```

## Pop-ups

Each screen can open the card on its own. The settings live on the screen itself, under
**This screen** (the gear on phones), so a wall tablet and a phone can behave differently.

| Trigger | Tablets | Phones |
| --- | --- | --- |
| `ask`: Home Assistant asks | on | on |
| `auto`: auto mode turns on or off | on | off |
| `hold`: someone changes things by hand | on | off |
| `chapter`: a new chapter starts | off | off |

A pop-up says why it opened and closes after two minutes on a tablet, or one minute on a phone,
without a touch.

To ask from an automation, send Cadence the `show` command. `screens` is `all`, `tablets` or
`phones`, and `tab` picks the page:

```yaml
action: script.cadence_command
data:
  command: show
  tab: today
  screens: tablets
```

Pressing `input_button.cadence_show`, if you create one, also counts as asking. To open it on
chosen browsers only, Browser Mod can run `window.openCadenceSheet()` with
`browser_mod.javascript`.

## Command script

The card sends commands as a `cadence_command` event. Only admins may fire events from the
browser, so the card calls this script when it exists. Create it under **Settings → Automations
& scenes → Scripts** in YAML mode:

```yaml
alias: Cadence command
mode: queued
max: 10
fields:
  command:
    required: true
    selector:
      select:
        options: [auto, resume, apply, recompute, show]
  mode:
    selector:
      select:
        options: ["on", "off", schedule]
  chapter_id:
    selector:
      text: {}
  variant_key:
    selector:
      text: {}
  tab:
    selector:
      select:
        options: [now, today, screen]
  screens:
    selector:
      select:
        options: [all, tablets, phones]
sequence:
  - event: cadence_command
    event_data:
      command: "{{ command }}"
      mode: "{{ mode | default('') }}"
      chapter_id: "{{ chapter_id | default('') }}"
      variant_key: "{{ variant_key | default('') }}"
      tab: "{{ tab | default('') }}"
      screens: "{{ screens | default('all') }}"
```

| Command | Data | Effect |
| --- | --- | --- |
| `auto` | `mode: on`, `off` or `schedule` | Force auto mode for today, or follow the schedule again |
| `resume` | | End a hand-made hold |
| `apply` | `chapter_id`, optional `variant_key` | Start a chapter now |
| `recompute` | | Re-evaluate right away |
| `show` | optional `tab`, `screens` | Pop the card up on screens |

## Testing locally

The card renders against any page that defines `ha-panel-lovelace` as a Lit element and puts a
`hass` object on `<home-assistant>`. The backend test suite builds the exact attributes Cadence
publishes, which makes good mock data.
