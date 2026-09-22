#!/bin/sh
# Home Assistant add-on entrypoint. Options arrive in /data/options.json,
# the Supervisor token in SUPERVISOR_TOKEN. Everything else is read by Python.
set -e
exec python -m cadence
