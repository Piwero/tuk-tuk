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
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select

from app.app_settings import require_app_settings
from app.calendar_source import (
    CalendarSource,
    CalendarSourceError,
    GoogleOAuthClient,
    TerminalCalendarSourceError,
    TransientCalendarSourceError,
)
from app.config import Settings
from app.crypto import decrypt_credential, encrypt_credential
from app.current_user import CurrentUserDep
from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.google_identity import new_pkce_verifier, pkce_challenge, shared_google_client
from app.models import GoogleAccount, GoogleCalendar, UserSettings
from app.oauth_transaction import (
    Transaction,
    clear_transaction_cookie,
    invalid_state,
    new_transaction,
    read_transaction,
    set_transaction_cookie,
)
from app.schemas import reject_explicit_null
from app.user_settings import (
    CurrentUserSettings,
    account_client,
    calendar_available,
    google_oauth_client,
    new_connection_client,
)

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


class GoogleStatus(BaseModel):
    # Whether Calendar can be connected at all: through the deployment's
    # shared client or the User's own.
    configured: bool
    # The deployment's shared client is configured (issue #586): no
    # Google Cloud setup of the User's own is needed.
    shared_client: bool = False
    # The client secret's value is never reported, only whether one is
    # stored — the settings-read response this shape backs must never
    # disclose it (ADR 0008 / issue #117).
    client_id: str | None = None
    client_secret_set: bool = False


class GoogleCredentialsUpdate(BaseModel):
    client_id: str = Field(min_length=1, max_length=255)
    # Omitted (rather than sent empty) to keep the currently-stored secret
    # unchanged — the write-only masked-placeholder field in Settings only
    # sends a value when the operator chose to overwrite it.
    client_secret: str | None = Field(default=None, min_length=1)


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


def require_google_configured(request: Request, user_settings: UserSettings) -> None:
    if not calendar_available(request.app.state.settings, user_settings):
        raise NotFoundError("Google Calendar integration is not configured")


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
    `origin` (see `_resolve_return_origin` and app.oauth_transaction), not
    `request.url_for` — the frontend dev proxy rewrites the Host header to
    the docker-internal backend service name when forwarding, which is
    neither registered with Google nor reachable by the browser."""
    return f"{origin}/api/v1/google/callback"


@router.get("/status")
async def google_status(request: Request, user_settings: CurrentUserSettings) -> GoogleStatus:
    return GoogleStatus(
        configured=calendar_available(request.app.state.settings, user_settings),
        shared_client=shared_google_client(request.app.state.settings) is not None,
        client_id=user_settings.google_client_id,
        client_secret_set=user_settings.encrypted_google_client_secret is not None,
    )


@router.put("/credentials")
async def save_google_credentials(
    payload: GoogleCredentialsUpdate,
    request: Request,
    session: SessionDep,
    user_settings: CurrentUserSettings,
) -> GoogleStatus:
    """Saves the Google OAuth client credentials from Settings (issue #117).
    The secret is write-only: omitting it keeps whatever is already stored,
    so editing just the client ID doesn't force re-entering a secret the
    operator never sees again. Whenever credentials change, every account
    this user connected is flipped to "needs_reconnect" — a refresh token
    is only valid for the OAuth client that minted it, so a credential swap
    would otherwise leave accounts silently broken on their next read.
    Another user's accounts were minted by their own client, so they are
    left alone.
    """
    settings = request.app.state.settings
    assert settings.app_master_key is not None  # app.main refuses to start without it

    if payload.client_secret is not None:
        encrypted_secret = encrypt_credential(payload.client_secret, key=settings.app_master_key)
    elif user_settings.encrypted_google_client_secret is not None:
        encrypted_secret = user_settings.encrypted_google_client_secret
    else:
        raise APIError(422, "client_secret_required", "A client secret is required")

    user_settings.google_client_id = payload.client_id
    user_settings.encrypted_google_client_secret = encrypted_secret
    # Only the accounts this client minted: shared-client ones are untouched.
    for account in await session.scalars(
        select(GoogleAccount).where(GoogleAccount.uses_shared_client.is_(False))
    ):
        account.connection_state = "needs_reconnect"
    await session.commit()

    return GoogleStatus(
        configured=True,
        shared_client=shared_google_client(settings) is not None,
        client_id=payload.client_id,
        client_secret_set=True,
    )


@router.delete("/credentials", status_code=204)
async def remove_google_credentials(
    session: SessionDep, user_settings: CurrentUserSettings
) -> None:
    """Removes this user's own Google client (issue #117): clears their
    stored credentials and disconnects every account it connected. Without
    a shared client (issue #586) that returns them to the same
    "unconfigured, feature invisible" state as a fresh deployment — never a
    greyed-out or broken corner; with one, accounts connected through it
    stay."""
    user_settings.google_client_id = None
    user_settings.encrypted_google_client_secret = None
    for account in await session.scalars(
        select(GoogleAccount).where(GoogleAccount.uses_shared_client.is_(False))
    ):
        await session.delete(account)
    await session.commit()


def _connection_client(
    request: Request, user_settings: UserSettings, shared: bool
) -> GoogleOAuthClient:
    """The client a consent was started with: the shared one, or the
    User's own."""
    settings: Settings = request.app.state.settings
    if shared:
        client = shared_google_client(settings)
        if client is None:
            raise NotFoundError("Google Calendar integration is not configured")
        return client
    assert settings.app_master_key is not None  # app.main refuses to start without it
    return google_oauth_client(user_settings, master_key=settings.app_master_key)


def _account_client_or_reconnect(
    request: Request, user_settings: UserSettings, account: GoogleAccount
) -> GoogleOAuthClient:
    """The client `account` was connected with, which every refresh must
    use. 409 `google_reconnect_required` once that client is gone."""
    client = account_client(account, request.app.state.settings, user_settings)
    if client is None:
        raise APIError(
            409,
            "google_reconnect_required",
            f"{account.email} needs to be reconnected: its OAuth client is gone",
        )
    return client


@router.get("/connect")
async def connect(
    request: Request,
    session: SessionDep,
    user_settings: CurrentUserSettings,
    user: CurrentUserDep,
) -> RedirectResponse:
    """Sends the browser to Google's consent for read-only Calendar access
    (ADR 0006), offline so reads keep working. Optional and separate from
    signing in (issue #586): it defaults to the account the User signs in
    with, still lets them pick any other, and never changes how they sign
    in. New connections use the shared client when one is configured."""
    settings = request.app.state.settings
    require_google_configured(request, user_settings)
    app_settings = await require_app_settings(session)
    client, shared = new_connection_client(settings, user_settings)
    return_to = _resolve_return_origin(settings, request.headers.get("referer"))
    # Bound to this browser and this User: a consent begun elsewhere, or by
    # someone else, can never link a Google account here.
    transaction = new_transaction(
        "calendar",
        return_to,
        new_pkce_verifier(),
        request.app.state.clock(),
        user_id=user.id,
        shared_client=shared,
    )
    params = {
        "client_id": client.client_id,
        "redirect_uri": _callback_redirect_uri(return_to),
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        # `consent` forces a refresh_token on every connect, including a
        # reconnect of an already-authorized account — without it Google
        # omits refresh_token on a repeat consent. `select_account` keeps
        # any other Google account one click away from the hinted one.
        "prompt": "consent select_account",
        "state": transaction.state,
        # PKCE (issue #586): the verifier stays in this browser's cookie.
        "code_challenge": pkce_challenge(transaction.verifier),
        "code_challenge_method": "S256",
    }
    if user.google_subject is not None and user.google_email:
        params["login_hint"] = user.google_email
    response = RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}", status_code=302)
    set_transaction_cookie(response, transaction, app_settings.session_key, settings)
    return response


@router.get("/callback", name="google_callback")
async def callback(
    request: Request,
    session: SessionDep,
    user_settings: CurrentUserSettings,
    user: CurrentUserDep,
    code: str | None = None,
    state: str | None = None,
) -> RedirectResponse:
    """Google's redirect back with Calendar consent. Stores (or refreshes)
    a Google Account: a Calendar connection only, which never becomes a
    way to sign in (issue #586). A declined consent changes nothing."""
    settings = request.app.state.settings
    require_google_configured(request, user_settings)
    app_settings = await require_app_settings(session)

    transaction = read_transaction(
        request, app_settings.session_key, state, {"calendar"}, request.app.state.clock()
    )
    if transaction.user_id != user.id:
        raise invalid_state()
    response = await _finish_connect(request, session, user_settings, transaction, code)
    clear_transaction_cookie(response, settings, "calendar")
    return response


async def _finish_connect(
    request: Request,
    session: SessionDep,
    user_settings: UserSettings,
    transaction: Transaction,
    code: str | None,
) -> RedirectResponse:
    settings = request.app.state.settings
    return_to, shared = transaction.origin, transaction.shared_client

    if code is None:
        return RedirectResponse(f"{return_to}?googleError=1", status_code=302)

    calendar_source: CalendarSource = request.app.state.calendar_source
    try:
        credential = await calendar_source.exchange_code(
            _connection_client(request, user_settings, shared),
            code,
            redirect_uri=_callback_redirect_uri(return_to),
            code_verifier=transaction.verifier,
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
        existing.uses_shared_client = shared
    else:
        session.add(
            GoogleAccount(
                google_account_id=credential.google_account_id,
                email=credential.email,
                encrypted_refresh_token=encrypted,
                connection_state="connected",
                uses_shared_client=shared,
            )
        )
    await session.commit()
    return RedirectResponse(f"{return_to}?googleConnected=1", status_code=302)


@router.get("/accounts")
async def list_accounts(
    request: Request, session: SessionDep, user_settings: CurrentUserSettings
) -> list[GoogleAccountRead]:
    require_google_configured(request, user_settings)
    rows = await session.scalars(select(GoogleAccount).order_by(GoogleAccount.id))
    return [GoogleAccountRead.model_validate(row) for row in rows]


@router.delete("/accounts/{account_id}", status_code=204)
async def disconnect_account(
    account_id: int, request: Request, session: SessionDep, user_settings: CurrentUserSettings
) -> None:
    require_google_configured(request, user_settings)
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
    oauth_client: GoogleOAuthClient,
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
        access_token = (await calendar_source.refresh(oauth_client, refresh_token)).access_token
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
    account_id: int, request: Request, session: SessionDep, user_settings: CurrentUserSettings
) -> list[GoogleCalendarRead]:
    require_google_configured(request, user_settings)
    account = await _get_account_or_404(session, account_id)

    calendars = await _calendars_for(session, account.id)
    if not calendars:
        # First-ever look at this account's calendars: seed from Google.
        calendars = await _sync_calendars(
            session,
            request.app.state.calendar_source,
            request.app.state.settings,
            _account_client_or_reconnect(request, user_settings, account),
            account,
        )
    return [GoogleCalendarRead.model_validate(row) for row in calendars]


@router.post("/accounts/{account_id}/calendars/refresh")
async def refresh_calendars(
    account_id: int, request: Request, session: SessionDep, user_settings: CurrentUserSettings
) -> list[GoogleCalendarRead]:
    require_google_configured(request, user_settings)
    account = await _get_account_or_404(session, account_id)

    calendars = await _sync_calendars(
        session,
        request.app.state.calendar_source,
        request.app.state.settings,
        _account_client_or_reconnect(request, user_settings, account),
        account,
    )
    return [GoogleCalendarRead.model_validate(row) for row in calendars]


@router.patch("/accounts/{account_id}/calendars/{calendar_id}")
async def update_calendar(
    account_id: int,
    calendar_id: int,
    payload: GoogleCalendarUpdate,
    request: Request,
    session: SessionDep,
    user_settings: CurrentUserSettings,
) -> GoogleCalendarRead:
    require_google_configured(request, user_settings)
    await _get_account_or_404(session, account_id)

    calendar = await session.get(GoogleCalendar, calendar_id)
    if calendar is None or calendar.google_account_id != account_id:
        raise NotFoundError(f"Google Calendar {calendar_id} not found")

    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(calendar, field, value)
    await session.commit()
    return GoogleCalendarRead.model_validate(calendar)
