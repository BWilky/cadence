"""Two doors into Cadence.

1. Home Assistant ingress — the Supervisor proxies requests from 172.30.32.2 and adds
   X-Ingress-Path plus X-Remote-User-* headers. Those requests are already authenticated by HA.
2. The optional external port — protected by Google sign-in against an allowlist of emails.
   Implemented directly against Google's OAuth2 / OpenID endpoints (no extra dependencies).
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer

from ..config import Options

SESSION_COOKIE = "cadence_session"
STATE_COOKIE = "cadence_oauth_state"
SESSION_MAX_AGE = 30 * 24 * 3600

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"


@dataclass
class User:
    id: str
    name: str
    via: str  # "ingress" | "google" | "dev"
    email: str | None = None
    admin: bool = True


class Auth:
    def __init__(self, opts: Options) -> None:
        self.opts = opts
        self.serializer = URLSafeTimedSerializer(opts.session_secret, salt="cadence-session")

    # ---------------------------------------------------------------- identify
    def user_for(self, request: Request) -> User | None:
        if self.opts.dev_no_auth:
            return User(id="dev", name="Developer", via="dev")
        client_ip = request.client.host if request.client else ""
        if client_ip == self.opts.ingress_ip and "x-ingress-path" in request.headers:
            return User(
                id=request.headers.get("x-remote-user-id", "ha"),
                name=request.headers.get("x-remote-user-display-name") or request.headers.get("x-remote-user-name") or "Home Assistant user",
                via="ingress",
            )
        cookie = request.cookies.get(SESSION_COOKIE)
        if cookie:
            try:
                data = self.serializer.loads(cookie, max_age=SESSION_MAX_AGE)
            except BadSignature:
                return None
            email = (data.get("email") or "").lower()
            if email and email in self.opts.allowed_emails:
                return User(id=email, name=data.get("name") or email, via="google", email=email)
        return None

    def session_cookie(self, email: str, name: str) -> str:
        return self.serializer.dumps({"email": email, "name": name})

    @property
    def secure_cookies(self) -> bool:
        return self.opts.external_url.startswith("https://")

    # ---------------------------------------------------------------- google flow
    def redirect_uri(self) -> str:
        return f"{self.opts.external_url}/auth/google/callback"

    def login_url(self, state: str) -> str:
        q = {
            "client_id": self.opts.google_client_id,
            "redirect_uri": self.redirect_uri(),
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "prompt": "select_account",
            "access_type": "online",
        }
        return f"{GOOGLE_AUTH}?{urlencode(q)}"

    async def exchange(self, code: str) -> dict:
        async with httpx.AsyncClient(timeout=15) as client:
            tok = await client.post(
                GOOGLE_TOKEN,
                data={
                    "code": code,
                    "client_id": self.opts.google_client_id,
                    "client_secret": self.opts.google_client_secret,
                    "redirect_uri": self.redirect_uri(),
                    "grant_type": "authorization_code",
                },
            )
            tok.raise_for_status()
            access = tok.json().get("access_token")
            info = await client.get(GOOGLE_USERINFO, headers={"Authorization": f"Bearer {access}"})
            info.raise_for_status()
            return info.json()


def build_router(auth: Auth) -> APIRouter:
    r = APIRouter(prefix="/auth", tags=["auth"])

    @r.get("/login", response_class=HTMLResponse)
    async def login_page(request: Request, error: str = "") -> HTMLResponse:
        if not auth.opts.google_enabled:
            body = (
                "<h1>Cadence</h1><p>This address is not configured for sign-in.</p>"
                "<p>Open Cadence from the Home Assistant sidebar, or set External URL, Google client ID/secret "
                "and allowed emails in the add-on configuration.</p>"
            )
            return HTMLResponse(_page(body), status_code=403)
        err = f"<p class='err'>{_esc(error)}</p>" if error else ""
        body = (
            "<h1>Cadence</h1><p>Sign in with an approved Google account to plan the day.</p>"
            f"{err}<a class='btn' href='google'>Continue with Google</a>"
        )
        return HTMLResponse(_page(body))

    @r.get("/google")
    async def google_start() -> RedirectResponse:
        if not auth.opts.google_enabled:
            raise HTTPException(403, "Google sign-in not configured")
        state = secrets.token_urlsafe(24)
        resp = RedirectResponse(auth.login_url(state), status_code=302)
        resp.set_cookie(STATE_COOKIE, state, max_age=600, httponly=True, samesite="lax", secure=auth.secure_cookies)
        return resp

    @r.get("/google/callback")
    async def google_callback(request: Request, code: str = "", state: str = "", error: str = "") -> RedirectResponse:
        if error or not code:
            return RedirectResponse(f"login?error={error or 'no code'}", status_code=302)
        if state != request.cookies.get(STATE_COOKIE):
            return RedirectResponse("login?error=state mismatch, try again", status_code=302)
        try:
            info = await auth.exchange(code)
        except httpx.HTTPError as exc:
            return RedirectResponse(f"login?error=google error {exc}", status_code=302)
        email = (info.get("email") or "").lower()
        if not info.get("email_verified", True) or email not in auth.opts.allowed_emails:
            return RedirectResponse(f"login?error={email or 'account'} is not on the allow list", status_code=302)
        resp = RedirectResponse(auth.opts.external_url + "/", status_code=302)
        resp.set_cookie(
            SESSION_COOKIE,
            auth.session_cookie(email, info.get("name") or email),
            max_age=SESSION_MAX_AGE,
            httponly=True,
            samesite="lax",
            secure=auth.secure_cookies,
        )
        resp.delete_cookie(STATE_COOKIE)
        return resp

    @r.get("/logout")
    async def logout() -> RedirectResponse:
        resp = RedirectResponse("login", status_code=302)
        resp.delete_cookie(SESSION_COOKIE)
        return resp

    return r


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _page(body: str) -> str:
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Cadence</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a1020;color:#ede6d6;
  font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif}}
main{{max-width:420px;padding:32px;border:1px solid #26304a;border-radius:16px;background:#141c30}}
h1{{font-weight:500;letter-spacing:.02em;margin:0 0 8px}} p{{color:#b9b3a6}} .err{{color:#e07a6b}}
.btn{{display:inline-block;margin-top:12px;padding:10px 18px;border-radius:10px;background:#f2b24a;color:#0a1020;
  text-decoration:none;font-weight:600}}
</style></head><body><main>{body}</main></body></html>"""
