from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from cadence.config import Options
from cadence.engine.engine import Engine
from cadence.seed import load_seed
from cadence.store import Store


class FakeHA:
    """Stands in for HAClient: a states dict plus a record of service calls."""

    def __init__(self, states: dict | None = None) -> None:
        self.states = states or {}
        self.config = {"time_zone": "America/Vancouver", "latitude": 49.4078, "longitude": -123.4509, "elevation": 20}
        self.connected = asyncio.Event()
        self.connected.set()
        self.calls: list[tuple] = []
        self._listeners = []
        self._conn = []

    def on_state(self, cb):
        self._listeners.append(cb)

    def on_connection(self, cb):
        self._conn.append(cb)

    async def call_service(self, domain, service, *, target=None, data=None, return_response=False):
        self.calls.append((domain, service, target, data))
        if return_response:
            return {"response": {}}
        return {}

    # mirror HAClient helpers
    def state(self, eid):
        s = self.states.get(eid)
        return s.get("state") if s else None

    def attr(self, eid, name, default=None):
        s = self.states.get(eid)
        return (s.get("attributes") or {}).get(name, default) if s else default

    def is_on(self, eid):
        st = self.state(eid)
        if st is None or st in ("unknown", "unavailable"):
            return None
        return st == "on"

    def numeric(self, eid):
        try:
            return float(self.state(eid))
        except (TypeError, ValueError):
            return None

    def entities(self, domain=None):
        return [
            {"entity_id": k, "state": v.get("state"), "name": k, "attributes": v.get("attributes") or {}}
            for k, v in self.states.items()
            if not domain or k.startswith(domain + ".")
        ]

    def set(self, eid, state, _age_s: float = 0, **attrs):
        old = self.states.get(eid)
        ts = (datetime.now(UTC) - timedelta(seconds=_age_s)).isoformat()
        new = {"entity_id": eid, "state": state, "attributes": attrs, "last_changed": ts, "last_updated": ts}
        self.states[eid] = new
        return old, new

    async def fire(self, eid, state, **attrs):
        old, new = self.set(eid, state, **attrs)
        for cb in self._listeners:
            res = cb(eid, old, new)
            if asyncio.iscoroutine(res):
                await res


@pytest.fixture
def store(tmp_path: Path) -> Store:
    s = Store(tmp_path / "t.db")
    yield s
    s.close()


@pytest.fixture
def fake_ha() -> FakeHA:
    ha = FakeHA()
    ha.set("sun.sun", "above_horizon", elevation=30.0)
    ha.set("sensor.lux", "500", device_class="illuminance")
    ha.set("binary_sensor.motion", "off", _age_s=3600)
    ha.set("switch.led_day_sunny", "off")
    ha.set("switch.led_day_cloudy", "off")
    ha.set("switch.led_evening", "off")
    return ha


@pytest.fixture
def engine(store: Store, fake_ha: FakeHA, tmp_path: Path) -> Engine:
    load_seed(store, "starter")
    opts = Options(dry_run=False, data_dir=tmp_path)
    events: list[dict] = []
    eng = Engine(fake_ha, store, opts, events.append)  # type: ignore[arg-type]
    eng.events = events  # type: ignore[attr-defined]
    eng._on_connection(True)
    return eng
