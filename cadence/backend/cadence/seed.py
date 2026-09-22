"""Seed configurations.

* ``starter`` — a generic day outline with no Home Assistant entity links, so a fresh install has
  something to look at. Loaded automatically on first start.
* ``barnabas`` — the Barnabas Landing station: Cadence Scenes mapped to the RA2 KP_PHANTOMSCENES
  phantom keypad, Bose CSP zones and the SpotifyPlus player. Imported from Settings.
"""

from __future__ import annotations

import json
from importlib import resources

from .models import CadenceScene, Settings, Template
from .store import Store

KIND_SETTINGS = "settings"
KIND_SCENE = "scene"
KIND_TEMPLATE = "template"


def _read(name: str) -> dict:
    ref = resources.files("cadence").joinpath("seed_data").joinpath(f"{name}.json")
    if not ref.is_file():
        raise FileNotFoundError(f"no seed named {name!r}")
    return json.loads(ref.read_text())


def available_seeds() -> list[dict]:
    out = []
    for ref in resources.files("cadence").joinpath("seed_data").iterdir():
        if ref.name.endswith(".json"):
            data = json.loads(ref.read_text())
            out.append({"name": ref.name[:-5], "title": data.get("title", ref.name), "description": data.get("description", "")})
    return sorted(out, key=lambda s: s["name"])


def load_seed(store: Store, name: str, *, replace: bool = False) -> dict:
    data = _read(name)
    scenes = [CadenceScene(**s) for s in data.get("scenes", [])]
    templates = [Template(**t) for t in data.get("templates", [])]
    settings_patch = data.get("settings", {})
    added = {"scenes": 0, "templates": 0}
    for sc in scenes:
        if replace or store.get(KIND_SCENE, sc.id) is None:
            store.put(KIND_SCENE, sc.id, sc.model_dump())
            added["scenes"] += 1
    for t in templates:
        if replace or store.get(KIND_TEMPLATE, t.id) is None:
            store.put(KIND_TEMPLATE, t.id, t.model_dump())
            added["templates"] += 1
    current = store.get(KIND_SETTINGS, "main") or {}
    merged = {**current, **settings_patch} if (replace or not current) else {**settings_patch, **current}
    if not merged.get("default_template_id") and templates:
        merged["default_template_id"] = templates[0].id
    s = Settings(**merged)
    store.put(KIND_SETTINGS, "main", s.model_dump())
    return {"seed": name, **added, "default_template_id": s.default_template_id}


def ensure_starter(store: Store) -> None:
    if store.list(KIND_TEMPLATE):
        return
    load_seed(store, "starter")
