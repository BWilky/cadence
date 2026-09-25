# Changelog

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
