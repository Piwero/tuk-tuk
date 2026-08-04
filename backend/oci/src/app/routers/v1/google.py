"""Google Calendar integration: status probe (issue #103) and connecting /
disconnecting Google accounts (issue #105).

Google Calendar is entirely optional: without the two configured settings,
the app must look like it has no such feature anywhere, so every route
below except `/status` itself 404s when unconfigured rather than exposing a
broken or greyed-out corner.

The consent flow is entirely backend-brokered: the browser navigates here
directly (full-page GET, not fetch), this router performs the redirect to
Google and handles Google's callback, and the client secret never reaches
the browser.
"""

from datetime import datetime
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.calendar_source import CalendarSource, CalendarSourceError
from app.config import Settings
from app.crypto import encrypt_credential
from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.models import GoogleAccount

router = APIRouter(prefix="/api/v1/google", tags=["google"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
# Read-only, sufficient to identify the account (email) and, in later
# tickets, enumerate calendars and read events. Never a write scope (ADR
# 0006): nothing in this integration ever writes to Google.
SCOPE = "openid email https://www.googleapis.com/auth/calendar.readonly"
_STATE_SALT = "google-oauth-state"
# A consent screen visit that's abandoned and replayed later shouldn't mint
# an account with a stale return_to; ten minutes comfortably covers a real
# consent flow without leaving a captured state token valid indefinitely.
_STATE_MAX_AGE_SECONDS = 600


def _invalid_state_error() -> APIError:
    return APIError(400, "invalid_oauth_state", "The OAuth state could not be verified")


class GoogleStatus(BaseModel):
    configured: bool


class GoogleAccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    google_account_id: str
    email: str
    connection_state: str
    created_at: datetime


def google_configured(settings: Settings) -> bool:
    return bool(settings.google_client_id) and bool(settings.google_client_secret)


def require_google_configured(settings: Settings) -> None:
    if not google_configured(settings):
        raise NotFoundError("Google Calendar integration is not configured")


def _state_serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.secret_key, salt=_STATE_SALT)


def _build_state(settings: Settings, return_to: str) -> str:
    token: str = _state_serializer(settings).dumps({"return_to": return_to})
    return token


def _read_return_to(settings: Settings, state: str) -> str:
    """Verifies `state` was minted by this server within the last
    `_STATE_MAX_AGE_SECONDS` (never trusted from the request alone) and
    returns the frontend origin to send the browser back to. Raises on a
    missing, tampered, or expired state — there is then no verified origin
    left to redirect to."""
    try:
        payload = _state_serializer(settings).loads(state, max_age=_STATE_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        raise _invalid_state_error() from None
    return_to = payload.get("return_to") if isinstance(payload, dict) else None
    if not isinstance(return_to, str):
        raise _invalid_state_error()
    return return_to


def _resolve_return_origin(settings: Settings, referer: str | None) -> str:
    """The origin /callback redirects back to. Restricted to a configured
    CORS origin rather than trusting the Referer verbatim, so a signed-but-
    foreign origin can never be smuggled through as an open redirect."""
    if referer:
        parsed = urlparse(referer)
        candidate = f"{parsed.scheme}://{parsed.netloc}"
        if candidate in settings.cors_origins:
            return candidate
    return settings.cors_origins[0] if settings.cors_origins else "/"


def _callback_redirect_uri(request: Request) -> str:
    """The backend's own callback URL, matching the exact per-origin
    redirect URI an operator registers with the Google Cloud OAuth client
    (see the spec's operator prerequisite)."""
    return str(request.url_for("google_callback"))


@router.get("/status")
async def google_status(request: Request) -> GoogleStatus:
    return GoogleStatus(configured=google_configured(request.app.state.settings))


@router.get("/connect")
async def connect(request: Request) -> RedirectResponse:
    settings = request.app.state.settings
    require_google_configured(settings)

    return_to = _resolve_return_origin(settings, request.headers.get("referer"))
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": _callback_redirect_uri(request),
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        # Forces a refresh_token on every connect, including a reconnect of
        # an already-authorized account — without it Google omits
        # refresh_token on a repeat consent.
        "prompt": "consent",
        "state": _build_state(settings, return_to),
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}", status_code=302)


@router.get("/callback", name="google_callback")
async def callback(
    request: Request,
    session: SessionDep,
    code: str | None = None,
    state: str | None = None,
) -> RedirectResponse:
    settings = request.app.state.settings
    require_google_configured(settings)

    if state is None:
        raise _invalid_state_error()
    return_to = _read_return_to(settings, state)

    if code is None:
        return RedirectResponse(f"{return_to}?googleError=1", status_code=302)

    calendar_source: CalendarSource = request.app.state.calendar_source
    try:
        credential = await calendar_source.exchange_code(
            code, redirect_uri=_callback_redirect_uri(request)
        )
    except CalendarSourceError:
        return RedirectResponse(f"{return_to}?googleError=1", status_code=302)

    # `settings.google_encryption_key` is guaranteed present here: the app
    # refuses to start with Google configured but no encryption key set
    # (app.main.create_app).
    assert settings.google_encryption_key is not None
    encrypted = encrypt_credential(credential.refresh_token, key=settings.google_encryption_key)

    existing = await session.scalar(
        select(GoogleAccount).where(GoogleAccount.google_account_id == credential.google_account_id)
    )
    if existing is not None:
        # Reconnecting an already-connected account updates it in place
        # rather than creating a duplicate.
        existing.email = credential.email
        existing.encrypted_refresh_token = encrypted
        existing.connection_state = "connected"
    else:
        session.add(
            GoogleAccount(
                google_account_id=credential.google_account_id,
                email=credential.email,
                encrypted_refresh_token=encrypted,
                connection_state="connected",
            )
        )
    await session.commit()
    return RedirectResponse(f"{return_to}?googleConnected=1", status_code=302)


@router.get("/accounts")
async def list_accounts(request: Request, session: SessionDep) -> list[GoogleAccountRead]:
    require_google_configured(request.app.state.settings)
    rows = await session.scalars(select(GoogleAccount).order_by(GoogleAccount.id))
    return [GoogleAccountRead.model_validate(row) for row in rows]


@router.delete("/accounts/{account_id}", status_code=204)
async def disconnect_account(account_id: int, request: Request, session: SessionDep) -> None:
    require_google_configured(request.app.state.settings)
    account = await session.get(GoogleAccount, account_id)
    if account is None:
        raise NotFoundError(f"Google Account {account_id} not found")
    await session.delete(account)
    await session.commit()
