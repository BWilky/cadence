# Changelog

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
