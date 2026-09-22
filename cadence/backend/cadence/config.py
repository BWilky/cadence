"""Add-on options and environment.

Inside Home Assistant the Supervisor writes the user's options to /data/options.json and
provides SUPERVISOR_TOKEN. For local development the same values can come from the
environment (HA_URL / HA_TOKEN).
"""

from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Options:
    dry_run: bool = True
    log_level: str = "info"
    external_url: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""
    allowed_emails: list[str] = field(default_factory=list)
    session_secret: str = ""

    # Environment-derived
    data_dir: Path = Path("/data")
    static_dir: Path = Path("/app/static")
    port: int = 8099
    ha_ws_url: str = "ws://supervisor/core/websocket"
    ha_http_url: str = "http://supervisor/core/api"
    ha_token: str = ""
    ingress_ip: str = "172.30.32.2"
    dev_no_auth: bool = False

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret and self.external_url)


def _read_options_file(path: Path) -> dict:
    if path.is_file():
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def load_options() -> Options:
    data_dir = Path(os.environ.get("CADENCE_DATA_DIR", "/data"))
    data_dir.mkdir(parents=True, exist_ok=True)
    raw = _read_options_file(data_dir / "options.json")

    opts = Options(
        dry_run=bool(raw.get("dry_run", True)),
        log_level=str(raw.get("log_level", "info")),
        external_url=str(raw.get("external_url") or "").rstrip("/"),
        google_client_id=str(raw.get("google_client_id") or ""),
        google_client_secret=str(raw.get("google_client_secret") or ""),
        allowed_emails=[e.strip().lower() for e in (raw.get("allowed_emails") or []) if e and e.strip()],
        session_secret=str(raw.get("session_secret") or ""),
        data_dir=data_dir,
        static_dir=Path(os.environ.get("CADENCE_STATIC_DIR", "/app/static")),
        port=int(os.environ.get("CADENCE_PORT", "8099")),
        ingress_ip=os.environ.get("CADENCE_INGRESS_IP", "172.30.32.2"),
        dev_no_auth=os.environ.get("CADENCE_DEV_NO_AUTH", "") == "1",
    )

    # Home Assistant connection: Supervisor proxy inside the add-on, explicit URL for dev.
    sup_token = os.environ.get("SUPERVISOR_TOKEN")
    ha_url = os.environ.get("HA_URL")
    if ha_url:
        base = ha_url.rstrip("/")
        ws_base = base.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
        opts.ha_ws_url = f"{ws_base}/api/websocket"
        opts.ha_http_url = f"{base}/api"
        opts.ha_token = os.environ.get("HA_TOKEN", "")
    elif sup_token:
        opts.ha_token = sup_token

    if not opts.session_secret:
        # Persist a generated secret so logins survive restarts.
        secret_file = data_dir / ".session_secret"
        if secret_file.is_file():
            opts.session_secret = secret_file.read_text().strip()
        else:
            opts.session_secret = secrets.token_urlsafe(48)
            secret_file.write_text(opts.session_secret)
    return opts
