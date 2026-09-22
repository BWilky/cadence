"""FastAPI application: API + WebSocket + the built web UI, behind ingress/Google auth."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response

from . import __version__
from .api import auth as auth_mod
from .api import routes, ws
from .config import load_options
from .engine.engine import Engine
from .ha.client import HAClient
from .seed import ensure_starter
from .store import Store

log = logging.getLogger(__name__)

opts = load_options()
broadcaster = ws.Broadcaster()
store = Store(opts.data_dir / "cadence.db")
ha = HAClient(opts.ha_ws_url, opts.ha_token, opts.ha_http_url)
engine = Engine(ha, store, opts, broadcaster.emit)
auth = auth_mod.Auth(opts)


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_starter(store)
    ha.start()
    engine.start()
    log.info("Cadence %s up — dry run %s, google login %s", __version__, engine.is_dry_run(), opts.google_enabled)
    try:
        yield
    finally:
        await engine.stop()
        await ha.stop()
        store.close()


app = FastAPI(title="Cadence", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None)


# ------------------------------------------------------------------------- auth gate
@app.middleware("http")
async def auth_gate(request: Request, call_next):
    path = request.url.path
    if path == "/api/health" or path.startswith("/auth/"):
        return await call_next(request)
    user = auth.user_for(request)
    if user is None:
        if path.startswith("/api/"):
            return JSONResponse({"detail": "not authenticated"}, status_code=401)
        # Human hitting the external port without a session → login page
        return RedirectResponse("/auth/login", status_code=302)
    request.state.user = user
    return await call_next(request)


app.include_router(auth_mod.build_router(auth))
app.include_router(routes.build_router(engine))


@app.websocket("/api/ws")
async def websocket(sock: WebSocket) -> None:
    # Starlette's HTTP middleware doesn't see WebSockets, so check here too.
    user = auth.user_for(sock)  # type: ignore[arg-type]
    if user is None:
        await sock.close(code=4401)
        return
    initial = engine.last_status.model_dump() if engine.last_status else None
    await ws.serve(sock, broadcaster, initial)


# ------------------------------------------------------------------------- static UI
STATIC = Path(opts.static_dir)


def _index_html(request: Request) -> HTMLResponse:
    index = STATIC / "index.html"
    if not index.is_file():
        return HTMLResponse(
            "<h1>Cadence</h1><p>The web UI has not been built. Run <code>npm run build</code> in cadence/frontend.</p>",
            status_code=503,
        )
    ingress = request.headers.get("x-ingress-path", "").rstrip("/")
    base = ingress + "/" if ingress else "/"
    user = getattr(request.state, "user", None)
    boot = {
        "basePath": base,
        "version": __version__,
        "user": {"name": user.name, "via": user.via} if user else None,
        "googleLogin": opts.google_enabled,
    }
    import json

    html = index.read_text()
    html = html.replace("<head>", f'<head><base href="{base}"><script>window.__CADENCE__={json.dumps(boot)}</script>', 1)
    return HTMLResponse(html)


@app.get("/", include_in_schema=False)
async def index(request: Request) -> Response:
    return _index_html(request)


@app.get("/{path:path}", include_in_schema=False)
async def static_or_index(path: str, request: Request) -> Response:
    if path.startswith("api/"):
        return JSONResponse({"detail": "not found"}, status_code=404)
    candidate = (STATIC / path).resolve()
    if STATIC.exists() and str(candidate).startswith(str(STATIC.resolve())) and candidate.is_file():
        headers = {"Cache-Control": "public, max-age=31536000, immutable"} if path.startswith("assets/") else {}
        return FileResponse(candidate, headers=headers)
    return _index_html(request)
