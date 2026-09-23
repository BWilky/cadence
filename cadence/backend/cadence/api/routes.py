"""REST API used by the planner and tablet UIs."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from ..engine.engine import KIND_PLAN, KIND_SCENE, KIND_TEMPLATE, Engine
from ..models import CadenceScene, DayPlan, Settings, Template
from ..seed import available_seeds, load_seed


class ApplyBody(BaseModel):
    chapter_id: str | None = None
    variant_key: str | None = None


class AutoBody(BaseModel):
    mode: str  # on | off | none


class SeedBody(BaseModel):
    name: str
    replace: bool = False


def build_router(engine: Engine) -> APIRouter:
    r = APIRouter(prefix="/api", tags=["api"])
    store = engine.store

    @r.get("/health")
    async def health() -> dict:
        return {"ok": True, "ha_connected": engine.ha.connected.is_set(), "dry_run": engine.is_dry_run()}

    @r.get("/me")
    async def me(request: Request) -> dict:
        u = request.state.user
        return {"id": u.id, "name": u.name, "via": u.via, "email": u.email}

    @r.get("/status")
    async def status() -> dict:
        if engine.last_status is None:
            await engine.tick()
        return engine.last_status.model_dump() if engine.last_status else {}

    # ---------------------------------------------------------------- settings
    @r.get("/settings")
    async def get_settings() -> Settings:
        return engine.settings()

    @r.put("/settings")
    async def put_settings(s: Settings) -> Settings:
        engine.save_settings(s)
        return s

    # ---------------------------------------------------------------- scenes
    @r.get("/scenes")
    async def list_scenes() -> list[CadenceScene]:
        return [CadenceScene(**d) for d in store.list(KIND_SCENE)]

    @r.put("/scenes/{scene_id}")
    async def put_scene(scene_id: str, scene: CadenceScene) -> CadenceScene:
        if scene.id != scene_id:
            raise HTTPException(400, "id mismatch")
        store.put(KIND_SCENE, scene_id, scene.model_dump())
        engine.wake()
        return scene

    @r.delete("/scenes/{scene_id}")
    async def delete_scene(scene_id: str) -> dict:
        used = [
            t["name"]
            for t in store.list(KIND_TEMPLATE)
            if any(scene_id in v.get("scene_ids", []) for c in t.get("chapters", []) for v in c.get("variants", []))
        ]
        if used:
            raise HTTPException(409, f"scene is used by template(s): {', '.join(used)}")
        return {"deleted": store.delete(KIND_SCENE, scene_id)}

    @r.post("/scenes/{scene_id}/test")
    async def test_scene(scene_id: str) -> dict:
        raw = store.get(KIND_SCENE, scene_id)
        if not raw:
            raise HTTPException(404, "unknown scene")
        await engine.test_scene(CadenceScene(**raw))
        return {"ok": True, "dry_run": engine.is_dry_run()}

    # ---------------------------------------------------------------- templates
    @r.get("/templates")
    async def list_templates() -> list[Template]:
        return [Template(**d) for d in store.list(KIND_TEMPLATE)]

    @r.put("/templates/{template_id}")
    async def put_template(template_id: str, t: Template) -> Template:
        if t.id != template_id:
            raise HTTPException(400, "id mismatch")
        ids = [c.id for c in t.chapters]
        if len(ids) != len(set(ids)):
            raise HTTPException(400, "duplicate chapter ids")
        store.put(KIND_TEMPLATE, template_id, t.model_dump())
        engine.wake()
        return t

    @r.delete("/templates/{template_id}")
    async def delete_template(template_id: str) -> dict:
        s = engine.settings()
        if s.default_template_id == template_id:
            raise HTTPException(409, "cannot delete the default template")
        return {"deleted": store.delete(KIND_TEMPLATE, template_id)}

    # ---------------------------------------------------------------- day plans
    @r.get("/plans/{day}")
    async def get_plan(day: str) -> DayPlan | None:
        raw = store.get(KIND_PLAN, day)
        return DayPlan(**raw) if raw else None

    @r.put("/plans/{day}")
    async def put_plan(day: str, plan: DayPlan) -> DayPlan:
        if plan.date != day:
            raise HTTPException(400, "date mismatch")
        store.put(KIND_PLAN, day, plan.model_dump())
        engine.wake()
        return plan

    @r.delete("/plans/{day}")
    async def delete_plan(day: str) -> dict:
        ok = store.delete(KIND_PLAN, day)
        engine.wake()
        return {"deleted": ok}

    @r.get("/days")
    async def days(start: str = Query(...), end: str = Query(...)) -> list[dict]:
        try:
            s, e = date.fromisoformat(start), date.fromisoformat(end)
        except ValueError as exc:
            raise HTTPException(400, "bad date") from exc
        if e < s:
            raise HTTPException(400, "end before start")
        if (e - s) > timedelta(days=62):
            raise HTTPException(400, "range too large (max 62 days)")
        return [d.model_dump() for d in await engine.day_views(s, e)]

    # ---------------------------------------------------------------- log
    @r.get("/log")
    async def get_log(limit: int = 200, before: int | None = None) -> list[dict]:
        return store.recent_log(min(limit, 1000), before)

    # ---------------------------------------------------------------- HA lookups
    @r.get("/ha/entities")
    async def entities(domain: str | None = None, search: str = "") -> list[dict]:
        items = engine.ha.entities(domain)
        q = search.lower().strip()
        if q:
            items = [e for e in items if q in e["entity_id"].lower() or q in e["name"].lower()]
        slim = []
        for e in items[:800]:
            a = e["attributes"]
            slim.append(
                {
                    "entity_id": e["entity_id"],
                    "name": e["name"],
                    "state": e["state"],
                    "device_class": a.get("device_class"),
                    "unit": a.get("unit_of_measurement"),
                    "keypad": a.get("keypad"),
                    "scene": a.get("scene"),
                    "source_list": a.get("source_list"),
                }
            )
        return slim

    @r.get("/ha/state/{entity_id}")
    async def entity_state(entity_id: str) -> dict:
        st = engine.ha.states.get(entity_id)
        if not st:
            raise HTTPException(404, "unknown entity")
        return st

    # ---------------------------------------------------------------- spotify
    @r.get("/spotify/search")
    async def spotify_search(q: str = Query(..., min_length=1), type: str = "playlist", limit: int = 12) -> dict:
        try:
            items = await engine.spotify_search(q.strip(), type, limit)
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 — HA / Spotify error
            raise HTTPException(502, f"Spotify search failed: {exc}") from exc
        return {"entity": engine.spotify_entity(), "items": items}

    @r.get("/spotify/devices")
    async def spotify_devices() -> dict:
        eid = engine.spotify_entity()
        st = engine.ha.states.get(eid) if eid else None
        devices = list(((st or {}).get("attributes") or {}).get("source_list") or [])
        return {"entity": eid, "devices": devices}

    # ---------------------------------------------------------------- engine controls
    @r.post("/engine/apply")
    async def apply(body: ApplyBody) -> dict:
        ok = await engine.manual_apply(body.chapter_id, body.variant_key)
        if not ok:
            raise HTTPException(400, "nothing to apply (no template or chapter)")
        return {"ok": True}

    @r.post("/engine/hold/release")
    async def release() -> dict:
        engine.release_hold("released from the panel")
        return {"ok": True}

    @r.post("/engine/auto")
    async def auto(body: AutoBody) -> dict:
        if body.mode not in ("on", "off", "none"):
            raise HTTPException(400, "mode must be on, off or none")
        engine.set_auto_override(body.mode)
        return {"ok": True}

    @r.post("/engine/recompute")
    async def recompute() -> dict:
        engine.wake()
        return {"ok": True}

    # ---------------------------------------------------------------- seeds
    @r.get("/seeds")
    async def seeds() -> list[dict]:
        return available_seeds()

    @r.post("/seeds/import")
    async def seed_import(body: SeedBody) -> dict:
        try:
            summary = load_seed(store, body.name, replace=body.replace)
        except FileNotFoundError as exc:
            raise HTTPException(404, str(exc)) from exc
        engine.save_settings(engine.settings())
        return summary

    return r
