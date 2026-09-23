# Cadence

Cadence gives a building a daily storyline. The day is split into **chapters** (Coffee Bar,
Breakfast, Daytime, Daytime Meal, Default Evening, Late Night Crowd, Nightlight…). Each chapter has
**variants** picked by what is happening outside — sunny, cloudy or dark from a lux sensor and the
sun's elevation, motion, whether the building is asleep, whether the day is occupied. A variant
activates one or more **Cadence Scenes**, and each Cadence Scene fires RA2 phantom-button scenes,
native Home Assistant scenes (WiZ bulbs and the like) and music actions (Bose CSP zone fades, mute,
source, SpotifyPlus playlists, Sonos players).

Cadence only drives the building while **auto mode** is active: a weekly schedule, an external
Home Assistant entity (a template `binary_sensor` you define), or either of them.

When someone presses a real keypad button, Cadence notices the RA2 LED switches change and **holds**
— it stops re-asserting the schedule until the next chapter begins.

## Installation

1. **Settings → Add-ons → Add-on store → ⋮ → Repositories**, add
   `https://github.com/bwilky/cadence`.
2. Install **Cadence**. Prebuilt images are pulled for aarch64 and amd64.
3. In the add-on **Configuration** tab leave **Dry run** on for now, then **Start**.
4. Open **Cadence** from the sidebar (ingress). Go to **Settings → Starter configurations** and
   import a seed, or build scenes and a template by hand.
5. Watch the **Activity** tab for a day: every chapter change is logged with the exact service
   calls it *would* make. When it reads right, turn **Dry run** off in the add-on configuration
   (and in Cadence's own Settings → Safety) to go live.

## Add-on options

| Option | Meaning |
| --- | --- |
| `dry_run` | Log actions instead of calling Home Assistant services. A hard guard: Cadence's own Settings cannot override it. |
| `log_level` | Backend log verbosity. |
| `external_url` | Public URL that reaches the exposed port, e.g. `https://cadence.example.com`. Enables the Google-login planner. |
| `google_client_id` / `google_client_secret` | OAuth client from Google Cloud Console. Authorised redirect URI: `<external_url>/auth/google/callback`. |
| `allowed_emails` | Google accounts allowed to sign in on the external URL. Everyone else is refused after sign-in. |
| `session_secret` | Signs login cookies; generated and stored on first start if empty. |

Ingress (the sidebar panel) never needs any of the Google options — Home Assistant has already
signed the user in. To use the external URL, also enable the **8099/tcp** port in the Network
section and put a reverse proxy with TLS in front of it.

## Concepts

### Cadence Scenes

A Cadence Scene is a named look. It contains:

- **Home Assistant scenes** — anything from `scene.*`. For RA2 phantom buttons choose the keypad
  **LED switch** (`switch.kp_…`) that lights when that scene is active. Cadence uses it to see when
  a 30-minute fade has finished and to detect hands-on changes.
- **Music actions** — fade a player's volume over N minutes, set volume, mute/unmute, select a
  source, start a playlist URI, play/pause/stop, or any custom `media_player`-style service.
- **Extra service calls** — anything else.

Use **Test now** in the scene editor to fire it immediately (dry run respected).

### Chapters and variants

A chapter starts:

- at a **clock time**,
- relative to the **sun** (sunrise, sunset, civil dawn/dusk, or a sun elevation such as −5° while
  setting) with an offset and a fallback time,
- when **motion** is seen, no earlier than a time and no later than another,
- when the building **falls asleep** (your asleep `binary_sensor` turns on), with the same window.

Variants are checked top to bottom; the first whose conditions match wins. A variant with no
conditions is the fallback. Conditions: sky ∈ {sunny, cloudy, dark}, light/dark, motion/quiet,
occupied/vacant, asleep/awake.

If **Switch variant mid-chapter** is on, a change of sky or motion swaps the variant while the
chapter runs (playlist starts are skipped on swaps unless you turn that off).

### Templates and day plans

One **default template** describes the ordinary day. In the **Planner** each day is a row; click
a day to give it another template, move chapter starts, force a variant, set auto mode for that
date, mark it occupied, and leave a note. Days with calendar events matching your keywords are
marked occupied automatically.

### Right-click in the Planner

Right-click a day's track for a context menu. On empty space (the hour band above the chapters)
it offers **Add chapter here (this day only)**. On a chapter it offers: edit for this day, force a
variant, move the start to the clicked time, duplicate or add a new chapter at that time, apply now
(today), skip for this day, or remove (day-only chapters). Day-only chapters live on that date's
plan and are drawn with a double border and a ◆ marker.

### Music

Music actions belong to Cadence Scenes, so they follow the chapters. Each track shows a subtle
strip along the bottom: a tinted band while something is playing (from a Spotify/play action to
the next pause/stop), a line following the target zone volume (fades ramp it), and a dot at each
chapter that changes the music.

- **Play on Spotify** searches playlists, albums and artists through the SpotifyPlus integration
  and plays the chosen context on a Spotify Connect device (or the active one), optionally
  shuffled. Set the SpotifyPlus player under **Settings → Music** or let Cadence detect it.
- **Fade volume** ramps a player to a percent over N minutes, starting from the current level or
  from zero. **Set volume**, **Mute**, **Unmute** and **Select source** cover the Bose CSP zones;
  the *Bose zones ▾* menu in the scene editor adds an action for every zone at once.

### Sky

`dark` when the sun is below **Dark below sun °** *or* the lux reading is under **Dark below lux**.
`sunny` above **Sunny above lux**, `cloudy` in between. Hysteresis widens each threshold so a
passing cloud doesn't flap the lights, and a dwell time stops sunny↔cloudy changes faster than N
minutes. If the lux sensor is stale or missing, the sun alone decides.

### Manual hold

A keypad LED changing when Cadence didn't expect it (outside the grace window that covers each
chapter's fade) starts a hold. The tablet shows *Changed by hand · resumes at the next chapter*.
**Resume schedule** on the tablet, or **Resume automation now** on the Now page, ends it early.

## Helper sensors you will want

Cadence reads plain Home Assistant entities. Two template sensors cover the common needs. Create
them under **Settings → Devices & services → Helpers → Template**, or in YAML:

```yaml
template:
  - binary_sensor:
      # Auto mode source: the site is in use.
      - name: "Cadence Auto"
        unique_id: cadence_auto
        state: >
          {{ is_state('input_boolean.propertyoccupied', 'on') }}

      # Building asleep: no motion in the common areas for 30 minutes, evenings only.
      - name: "Station Asleep"
        unique_id: station_asleep
        delay_on:
          minutes: 30
        state: >
          {% set quiet = is_state('binary_sensor.station_motion_common_floor', 'off') %}
          {% set late = now().hour >= 21 or now().hour < 5 %}
          {{ quiet and late }}
```

Point **Settings → Auto mode → External auto entity** at `binary_sensor.cadence_auto` and
**Building senses → Building asleep** at `binary_sensor.station_asleep`.

## Tablet view

The **Tablet** tab (`…/#/tablet`) is the wall display: the building photo with zone glows that
follow real light-group brightness, the current chapter and variant, the next chapter, sky and
motion, and a scrollable timeline of the day. Tap a chapter to start it now or to pick a variant.
Add it to a Fully Kiosk dashboard as a Webpage card pointing at the Cadence ingress URL followed
by `#/tablet`, or set Fully Kiosk's start URL to it.

## Calendar

Add the **Google Calendar** integration in Home Assistant, then pick its `calendar.*` entities in
Cadence's **Settings → Calendar**. Events appear on the planner rows; titles containing any of the
keywords mark the day occupied.

## Local development

```bash
cd cadence/backend && pip install -e ".[dev]" && pytest
HA_URL=http://homeassistant.local:8123 HA_TOKEN=<token> CADENCE_DEV_NO_AUTH=1 \
  CADENCE_DATA_DIR=./.data CADENCE_STATIC_DIR=../frontend/dist python -m cadence
cd ../frontend && npm ci && npm run dev   # proxies /api to :8199
```
