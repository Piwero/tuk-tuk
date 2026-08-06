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
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select

from app.app_settings import require_app_settings
from app.calendar_source import (
    CalendarSource,
    CalendarSourceError,
    TerminalCalendarSourceError,
    TransientCalendarSourceError,
)
from app.config import Settings, google_configured
from app.crypto import decrypt_credential, encrypt_credential
from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.models import GoogleAccount, GoogleCalendar
from app.schemas import reject_explicit_null

router = APIRouter(prefix="/api/v1/google", tags=["google"])

# Mirrors ACCENT_PALETTE in frontend/oci/src/theme.ts. Calendars are coloured
# from tuk-tuk's own palette, never Google's — Google's colours are chosen
# against Google's own interface and clash with this app's theme.
CALENDAR_COLOR_PALETTE = [
    "#4772fa",  # Blue
    "#5b5bd6",  # Indigo
    "#8b5cf6",  # Plum
    "#d6409f",  # Pink
    "#e5484d",  # Red
    "#f76b15",  # Orange
    "#eda812",  # Amber
    "#99d52a",  # Lime
    "#2da44e",  # Green
    "#12a594",  # Teal
    "#00a2c7",  # Cyan
    "#8b8d98",  # Slate
]

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


class GoogleCalendarRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    google_calendar_id: str
    summary: str
    color: str
    enabled: bool


def _reject_off_palette_color(value: object) -> object:
    if value is not None and value not in CALENDAR_COLOR_PALETTE:
        raise ValueError("color must be one of tuk-tuk's own palette values")
    return value


# PATCH fields: absent means "leave unchanged"; neither may be set to null.
# `color` is further restricted to CALENDAR_COLOR_PALETTE — calendars are
# coloured from tuk-tuk's own palette, never an arbitrary value.
class GoogleCalendarUpdate(BaseModel):
    enabled: bool | None = None
    color: str | None = Field(default=None, max_length=32)

    _reject_nulls = field_validator("enabled", "color")(reject_explicit_null)
    _reject_off_palette = field_validator("color")(_reject_off_palette_color)


def require_google_configured(settings: Settings) -> None:
    if not google_configured(settings):
        raise NotFoundError("Google Calendar integration is not configured")


def _state_serializer(session_key: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(session_key, salt=_STATE_SALT)


def _build_state(session_key: str, return_to: str) -> str:
    token: str = _state_serializer(session_key).dumps({"return_to": return_to})
    return token


def _read_return_to(session_key: str, state: str) -> str:
    """Verifies `state` was minted by this server within the last
    `_STATE_MAX_AGE_SECONDS` (never trusted from the request alone) and
    returns the frontend origin to send the browser back to. Raises on a
    missing, tampered, or expired state — there is then no verified origin
    left to redirect to."""
    try:
        payload = _state_serializer(session_key).loads(state, max_age=_STATE_MAX_AGE_SECONDS)
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


def _callback_redirect_uri(origin: str) -> str:
    """The backend's own callback URL, matching the exact per-origin
    redirect URI an operator registers with the Google Cloud OAuth client
    (see the spec's operator prerequisite). Built from the verified
    `origin` (see `_resolve_return_origin`/`_read_return_to`), not
    `request.url_for` — the frontend dev proxy rewrites the Host header to
    the docker-internal backend service name when forwarding, which is
    neither registered with Google nor reachable by the browser."""
    return f"{origin}/api/v1/google/callback"


@router.get("/status")
async def google_status(request: Request) -> GoogleStatus:
    return GoogleStatus(configured=google_configured(request.app.state.settings))


@router.get("/connect")
async def connect(request: Request, session: SessionDep) -> RedirectResponse:
    settings = request.app.state.settings
    require_google_configured(settings)
    app_settings = await require_app_settings(session)

    return_to = _resolve_return_origin(settings, request.headers.get("referer"))
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": _callback_redirect_uri(return_to),
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        # Forces a refresh_token on every connect, including a reconnect of
        # an already-authorized account — without it Google omits
        # refresh_token on a repeat consent.
        "prompt": "consent",
        "state": _build_state(app_settings.session_key, return_to),
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
    app_settings = await require_app_settings(session)

    if state is None:
        raise _invalid_state_error()
    return_to = _read_return_to(app_settings.session_key, state)

    if code is None:
        return RedirectResponse(f"{return_to}?googleError=1", status_code=302)

    calendar_source: CalendarSource = request.app.state.calendar_source
    try:
        credential = await calendar_source.exchange_code(
            code, redirect_uri=_callback_redirect_uri(return_to)
        )
    except CalendarSourceError:
        return RedirectResponse(f"{return_to}?googleError=1", status_code=302)

    # `settings.app_master_key` is unconditionally required (app.main
    # refuses to start without it), unlike the Google settings above.
    assert settings.app_master_key is not None
    encrypted = encrypt_credential(credential.refresh_token, key=settings.app_master_key)

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


async def _get_account_or_404(session: SessionDep, account_id: int) -> GoogleAccount:
    account = await session.get(GoogleAccount, account_id)
    if account is None:
        raise NotFoundError(f"Google Account {account_id} not found")
    return account


async def _calendars_for(session: SessionDep, account_id: int) -> list[GoogleCalendar]:
    rows = await session.scalars(
        select(GoogleCalendar)
        .where(GoogleCalendar.google_account_id == account_id)
        .order_by(GoogleCalendar.id)
    )
    return list(rows)


async def _sync_calendars(
    session: SessionDep,
    calendar_source: CalendarSource,
    settings: Settings,
    account: GoogleAccount,
) -> list[GoogleCalendar]:
    """Re-reads Google's calendar list for `account` and upserts it:
    calendars already known keep their locally-chosen `enabled`/`color` and
    only pick up a fresh `summary`; calendars seen for the first time are
    seeded from Google's own `selected` flag and given the next unused
    palette colour. Existing rows are never removed here — a calendar
    dropping out of one fetch is not treated as evidence it's gone for
    good.

    A terminal failure (issue #109) additionally flips `connection_state` to
    "needs_reconnect" before surfacing as an APIError — the same state the
    Events endpoint sets, so Settings and the Calendar banner never
    disagree about which accounts need reconnecting."""
    assert settings.app_master_key is not None
    refresh_token = decrypt_credential(account.encrypted_refresh_token, key=settings.app_master_key)
    try:
        access_token = (await calendar_source.refresh(refresh_token)).access_token
        entries = await calendar_source.list_calendars(access_token)
    except TerminalCalendarSourceError as exc:
        account.connection_state = "needs_reconnect"
        await session.commit()
        raise APIError(
            409,
            "google_reconnect_required",
            f"{account.email} needs to be reconnected: {exc}",
        ) from exc
    except TransientCalendarSourceError as exc:
        raise APIError(
            502, "google_unavailable", f"Google Calendar is temporarily unavailable: {exc}"
        ) from exc

    if account.connection_state == "needs_reconnect":
        # A sync that reaches here just refreshed the token and listed
        # calendars successfully, so a stale "needs_reconnect" from an
        # earlier failure (e.g. the API being disabled, since fixed) no
        # longer describes this account.
        account.connection_state = "connected"

    existing_by_google_id = {
        row.google_calendar_id: row for row in await _calendars_for(session, account.id)
    }
    used_colors = {row.color for row in existing_by_google_id.values()}

    for entry in entries:
        calendar = existing_by_google_id.get(entry.google_calendar_id)
        if calendar is not None:
            calendar.summary = entry.summary
        else:
            color = next(
                (c for c in CALENDAR_COLOR_PALETTE if c not in used_colors),
                CALENDAR_COLOR_PALETTE[len(used_colors) % len(CALENDAR_COLOR_PALETTE)],
            )
            used_colors.add(color)
            session.add(
                GoogleCalendar(
                    google_account_id=account.id,
                    google_calendar_id=entry.google_calendar_id,
                    summary=entry.summary,
                    color=color,
                    enabled=entry.selected,
                )
            )
    await session.commit()
    return await _calendars_for(session, account.id)


@router.get("/accounts/{account_id}/calendars")
async def list_calendars(
    account_id: int, request: Request, session: SessionDep
) -> list[GoogleCalendarRead]:
    require_google_configured(request.app.state.settings)
    account = await _get_account_or_404(session, account_id)

    calendars = await _calendars_for(session, account.id)
    if not calendars:
        # First-ever look at this account's calendars: seed from Google.
        calendars = await _sync_calendars(
            session, request.app.state.calendar_source, request.app.state.settings, account
        )
    return [GoogleCalendarRead.model_validate(row) for row in calendars]


@router.post("/accounts/{account_id}/calendars/refresh")
async def refresh_calendars(
    account_id: int, request: Request, session: SessionDep
) -> list[GoogleCalendarRead]:
    require_google_configured(request.app.state.settings)
    account = await _get_account_or_404(session, account_id)

    calendars = await _sync_calendars(
        session, request.app.state.calendar_source, request.app.state.settings, account
    )
    return [GoogleCalendarRead.model_validate(row) for row in calendars]


@router.patch("/accounts/{account_id}/calendars/{calendar_id}")
async def update_calendar(
    account_id: int,
    calendar_id: int,
    payload: GoogleCalendarUpdate,
    request: Request,
    session: SessionDep,
) -> GoogleCalendarRead:
    require_google_configured(request.app.state.settings)
    await _get_account_or_404(session, account_id)

    calendar = await session.get(GoogleCalendar, calendar_id)
    if calendar is None or calendar.google_account_id != account_id:
        raise NotFoundError(f"Google Calendar {calendar_id} not found")

    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(calendar, field, value)
    await session.commit()
    return GoogleCalendarRead.model_validate(calendar)
