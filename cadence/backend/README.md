# Cadence backend

FastAPI service that runs the chapter engine and serves the planner / tablet UI.
See the repository root README for the full picture.

Local dev:

```bash
cd cadence/backend
pip install -e ".[dev]"
HA_URL=http://homeassistant.local:8123 HA_TOKEN=<long-lived token> CADENCE_DEV_NO_AUTH=1 \
  CADENCE_DATA_DIR=./.data python -m cadence
```
