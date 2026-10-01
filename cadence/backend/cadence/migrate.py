"""Shape changes to stored settings.

Version 0 → 1: occupancy evidence (calendar keywords, the occupied sensor) used to pick between a
guest-day and a vacant-day template. Those become template rules; the vacant-day template becomes
the default (what runs when no rule matches).
"""

from __future__ import annotations

import logging

from .models import RuleCondition, Settings, TemplateRule
from .store import Store

log = logging.getLogger(__name__)

KIND_SETTINGS = "settings"
CURRENT = 1


def migrate_settings(store: Store) -> bool:
    """Bring the stored settings document up to the current schema. Returns True if anything changed."""
    raw = store.get(KIND_SETTINGS, "main")
    if raw is None:
        return False
    version = int(raw.get("schema_version") or 0)
    if version >= CURRENT:
        return False
    if version < 1:
        raw = _v0_to_v1(raw)
    raw["schema_version"] = CURRENT
    store.put(KIND_SETTINGS, "main", Settings(**raw).model_dump())
    log.info("settings migrated to schema %s", CURRENT)
    return True


def _v0_to_v1(raw: dict) -> dict:
    out = dict(raw)
    rules = list(out.get("rules") or [])
    default = out.get("default_template_id")
    vacant = out.pop("vacant_template_id", None)
    keywords = [k for k in (out.pop("calendar_keywords", None) or []) if str(k).strip()]
    occupied_entity = out.pop("occupied_entity", None)
    calendars = out.get("calendars") or []
    if calendars or occupied_entity:
        # Days with evidence of guests ran the guest template; everything else ran the vacant one (or nothing).
        if calendars:
            rules.append(
                TemplateRule(
                    id="guests_on_calendar",
                    name="Guests on the calendar",
                    template_id=default,
                    conditions=[RuleCondition(kind="calendar", match="contains", terms=keywords)],
                    set_occupied=True,
                ).model_dump()
            )
        if occupied_entity:
            rules.append(
                TemplateRule(
                    id="occupied_sensor",
                    name="Occupied sensor",
                    template_id=default,
                    conditions=[RuleCondition(kind="entity", entity_id=occupied_entity, state="on")],
                    set_occupied=True,
                ).model_dump()
            )
        out["default_template_id"] = vacant
    out["rules"] = rules
    return out
