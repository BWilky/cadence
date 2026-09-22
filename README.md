# Cadence

A Home Assistant add-on that gives a building a daily storyline: chapters through the day
(Coffee Bar, Breakfast, Daytime, Daytime Meal, Default Evening, Late Night Crowd, Nightlight),
each with variants chosen by sky (lux + sun), motion, sleep and occupancy. Chapters activate
Lutron RA2 phantom scenes, native Home Assistant scenes and music (Bose CSP zones, SpotifyPlus,
Sonos), track keypad LEDs to see fades finish and to notice hands-on changes, and show it all on a
wall tablet.

Built for [Barnabas Landing](https://barnabaslanding.com)'s station building; configurable for
any Home Assistant install.

## Install

Add this repository to the Home Assistant add-on store:

```
https://github.com/bwilky/cadence
```

then install **Cadence**, start it with **Dry run** on, and open it from the sidebar.
Full documentation lives in [`cadence/DOCS.md`](cadence/DOCS.md).

## Repository layout

```
repository.yaml          add-on repository manifest
cadence/                 the add-on
  config.yaml            add-on manifest (ingress, options, schema)
  Dockerfile             node build of the UI + python runtime
  backend/               FastAPI service, engine, tests
  frontend/              Vite + React planner and tablet UI
.github/workflows/       tests + multi-arch image build to GHCR
```

## Development

Backend (Python 3.11+):

```bash
cd cadence/backend
pip install -e ".[dev]"
ruff check . && pytest
HA_URL=http://homeassistant.local:8123 HA_TOKEN=<long-lived token> CADENCE_DEV_NO_AUTH=1 \
  CADENCE_DATA_DIR=./.data CADENCE_STATIC_DIR=../frontend/dist python -m cadence
```

Frontend (Node 22):

```bash
cd cadence/frontend
npm ci
npm run dev        # http://localhost:5173, proxies /api to the backend on :8199
npm run build      # emits dist/, which the backend serves
```

## Releasing

Bump `version` in `cadence/config.yaml` and `cadence/backend/pyproject.toml`, add a
`CHANGELOG.md` entry, push to `main`. The workflow builds `ghcr.io/bwilky/cadence-{aarch64,amd64}`
tagged with that version; Home Assistant offers the update.
