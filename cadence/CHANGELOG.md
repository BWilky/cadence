# Changelog

## 0.5.2

- The planner, Now page and tablet show every time in the building's timezone (the engine's), not
  the browser's. A browser an hour off from the site used to draw every chapter an hour early and
  land drags an hour away from where they were dropped; the first chapter of the day could wrap to
  the previous evening and hide the next chapter's title.

## 0.5.1

- Planner: chapter starts land on quarter hours — dragging a handle keeps the edge exactly under
  the pointer and snaps it to the nearest 15 minutes, as do "Move start to" and the clock-time
  field. The chapter stays where it was dropped while the day saves instead of jumping back to its
  old time. The week grid is taller by default (a quarter hour is one 24px row) with quarter-hour
  guide lines; ctrl+wheel still zooms. Chapters too short to read are drawn one line tall over the
  start of the next chapter, which moves its text down out of the way; edges and drag handles stay
  at their true times.

## 0.5.0

- Cadence publishes its status to Home Assistant as `sensor.cadence_status` (auto, hold, off or
  idle, with today's chapters, auto windows, variant, next chapter, hold and senses as
  attributes) and `sensor.cadence_chapter` (the current chapter's name). Every account can read
  them, so dashboards no longer need the admin-only ingress panel. Only changes at chapter,
  variant and mode boundaries are posted, to keep the recorder quiet; the entities read
  `unavailable` while the app is stopped and come back after a Home Assistant restart.
- Cadence listens for a `cadence_command` event: `auto` (on, off or schedule for today),
  `resume`, `apply` a chapter (optionally a variant), `recompute`, and `show`, which asks screens
  running the Cadence card to pop it up.
- New Lovelace card in `card/`: a tile for any dashboard and a phone sheet / tablet dialog with
  the day ribbon, the auto-mode band, auto mode for today, hold resume and chapter starts. Opens
  from the tile, `#cadence` links, JavaScript, or on its own when auto mode changes, someone
  takes over by hand, a chapter starts or Home Assistant asks.

## 0.4.2

- Zoom the Now page's 24-hour strip with the mouse wheel or a trackpad (pinch, or two-finger
  scroll up to zoom in and down to zoom out), anchored on the cursor; two-finger horizontal
  scrolling pans it; double-click or the reset chip returns to the whole day. Pinch (ctrl +
  wheel) on the week grid changes its hour height.
- Dragging a chapter edge in the week grid now lands exactly where the handle is released,
  and the grid no longer selects text while dragging.
- The tracked egg-info folder is gone from the repository (it shadowed the package version on
  dev checkouts).

## 0.4.1

- The backend reports the version from its package metadata, so the sidebar and startup log
  no longer show a stale number after a release.

## 0.4.0

- New look for the planner pages, matching the Tablets / Audio sheets on the dashboards: a left
  sidebar with icon navigation and a status chip, tinted sections instead of bordered cards,
  icon action tiles, chips, pill buttons, tile-style sliders and toggles, Roboto, Material
  Design icons, light and dark themes mirroring Home Assistant's defaults. daisyUI removed.
- Calendar-style timelines: chapters in the week grid and the 24-hour strip are soft cards
  tinted from the chapter colour with the colour as title ink and the start time beneath;
  conditional, held and carried-over chapters use an outline. One "now" line runs across the
  whole week with a time flag in the hour gutter; today's column is tinted.
- Phones get a top title bar and a bottom tab strip; the day pane opens as a bottom sheet.
- The wall tablet view is unchanged.

## 0.3.0

- Template rules: apply a template to days automatically from the calendar (title / location /
  description contains, exact or regex; all-day or timed; per calendar; or "no event"), days of
  the week, date ranges (absolute or recurring every year), a binary sensor or sensor group, or a
  numeric sensor above / below a value. Rules have a validity window and can set the day's
  occupancy, auto mode and a note. Checked top to bottom, first match wins; the planner flags days
  where more than one rule matched.
- One default template runs on any day no rule or manual choice takes (or nothing). Today's
  default is provisional: sensor rules keep checking until a cut-off time and the first to match
  takes the day, recording the decision on that date so later changes don't flip it.
- Templates have a colour; planner columns are tinted by the template that runs, headed by how it
  was chosen (rule, chosen, default), italic for predicted future days. Day pane shows the
  deciding rule and an Undo; rules editor with a 90-day preview on the Templates page; tablet
  shows the template name.
- Removed the guest-day / vacant-day templates, calendar keywords and occupied-sensor settings;
  existing installs are migrated into equivalent rules on first start.
- A day that runs nothing no longer carries the previous day's last chapter forward.

## 0.2.3

- Fainter drag handles on chapter tiles; only the handle in use shows while dragging.

## 0.2.2

- Week grid: a small gap between chapter tiles, and a pill handle on both edges. The top handle
  moves the chapter's start; the bottom handle moves the next chapter's start (the finish).

## 0.2.1

- Cleaner chapter tiles in the week grid: coloured top bar, time in the chapter colour, pill drag
  handle on hover. Music is no longer drawn on the grid; the day pane lists each chapter's fade
  and music actions instead, grouped across zones.

## 0.2.0

- Planner is now a week view: seven vertical day columns, hours down the page, week paging, a
  month popover with occupancy dots, and a slide-over day pane instead of the side inspector.
- Occupied vs vacant days: guest-day and vacant-day templates; evidence from calendar keywords,
  the occupied sensor (remembered per date) or the + button. Vacant days are drawn faint and run
  the vacant template or nothing.
- Refining a day gives that date its own copy of the chapters (never a template); reset to
  template; copy a day and paste it onto any number of other days.
- Engine refreshes calendar events itself so occupancy works without the planner open.

## 0.1.0

- Initial release: chapter engine (clock / sun / motion / asleep triggers), sky classification
  from lux + sun elevation, Cadence Scenes mapping to RA2 phantom scenes, HA scenes and music
  actions, manual-override hold via keypad LED tracking, dry-run mode, planner UI with per-date
  overrides and calendar overlay, tablet "Light Story" view, ingress + optional Google login.
