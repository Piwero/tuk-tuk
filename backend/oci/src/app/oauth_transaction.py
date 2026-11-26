"""The browser-bound OAuth transaction behind every Google sign-in round
trip (issue #586): state, nonce and PKCE verifier, kept in a short-lived,
signed, HttpOnly cookie on the browser that started the round trip.

- `state` ties Google's callback to that browser: a callback carrying
  someone else's state (login CSRF) or arriving without the cookie is
  refused.
- `nonce` ties the ID token to this round trip: a token minted for another
  sign-in is refused (replay).
- The PKCE verifier never leaves the server and that cookie, so a stolen
  authorization code cannot be exchanged by anyone else (interception).

The cookie is cleared as soon as the callback reads it: one transaction,
one callback. Its purpose (login, invitation, link) is fixed when it is
started, and each callback accepts only its own purposes.
"""

import secrets
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Literal
from urllib.parse import urlparse

from itsdangerous import BadSignature, URLSafeSerializer
from starlette.requests import Request
from starlette.responses import Response

from app.config import Settings
from app.errors import APIError

TRANSACTION_COOKIE = "tuktuk_google_oauth"
COOKIE_PATH = "/api/v1/auth/google"
# Calendar consent (app.routers.v1.google) keeps its own cookie, sent only to
# its own routes.
CALENDAR_COOKIE = "tuktuk_google_calendar_oauth"
CALENDAR_COOKIE_PATH = "/api/v1/google"
# Long enough for a real consent screen, short enough that an abandoned
# round trip cannot be finished much later.
TRANSACTION_MAX_AGE_SECONDS = 600
_SALT = "tuk-tuk-google-oauth-transaction"

Purpose = Literal["login", "invitation", "link", "calendar"]


@dataclass(frozen=True)
class Transaction:
    purpose: Purpose
    # When the round trip started, by the app's clock: it expires
    # TRANSACTION_MAX_AGE_SECONDS later.
    started_at: float
    state: str
    nonce: str
    verifier: str
    # The frontend origin to land back on, verified against CORS origins
    # when the round trip started; also the redirect URI's origin.
    origin: str
    # A same-origin path to land on after a login or link.
    next_path: str = "/"
    # For an invitation: which one, and which of its credentials (a resend
    # replaces it, invalidating a round trip begun with the old link).
    invitation_id: int | None = None
    token_hash: str | None = None
    # For a link or a Calendar connection: the signed-in User who started it.
    user_id: int | None = None
    # For a Calendar connection: whether it was started with the shared
    # OAuth client, which the code must then be exchanged with.
    shared_client: bool = False


def new_transaction(
    purpose: Purpose, origin: str, verifier: str, now: datetime, **fields: object
) -> Transaction:
    return Transaction(
        purpose=purpose,
        started_at=now.timestamp(),
        state=secrets.token_urlsafe(32),
        nonce=secrets.token_urlsafe(32),
        verifier=verifier,
        origin=origin,
        **fields,  # type: ignore[arg-type]
    )


def _serializer(session_key: str) -> URLSafeSerializer:
    return URLSafeSerializer(session_key, salt=_SALT)


def invalid_state() -> APIError:
    return APIError(400, "invalid_oauth_state", "The sign-in could not be verified. Start again.")


def _cookie(transaction_purpose: Purpose) -> tuple[str, str]:
    if transaction_purpose == "calendar":
        return CALENDAR_COOKIE, CALENDAR_COOKIE_PATH
    return TRANSACTION_COOKIE, COOKIE_PATH


def set_transaction_cookie(
    response: Response, transaction: Transaction, session_key: str, settings: Settings
) -> None:
    name, path = _cookie(transaction.purpose)
    response.set_cookie(
        name,
        _serializer(session_key).dumps(asdict(transaction)),
        max_age=TRANSACTION_MAX_AGE_SECONDS,
        httponly=True,
        secure=settings.auth_cookie_secure,
        # Lax: Google's callback is a top-level cross-site GET navigation,
        # which Lax cookies are sent on and Strict ones are not.
        samesite="lax",
        path=path,
    )


def clear_transaction_cookie(
    response: Response, settings: Settings, purpose: Purpose = "login"
) -> None:
    name, path = _cookie(purpose)
    response.delete_cookie(
        name,
        path=path,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
    )


def read_transaction(
    request: Request, session_key: str, state: str | None, purposes: set[Purpose], now: datetime
) -> Transaction:
    """The transaction this browser started, provided `state` is its own
    and it is one of `purposes`. Raises 400 `invalid_oauth_state`
    otherwise: missing, tampered, expired, or another browser's."""
    # Every purpose a callback accepts shares one cookie (see `_cookie`).
    cookie = request.cookies.get(_cookie(next(iter(purposes)))[0])
    if not cookie or not state:
        raise invalid_state()
    try:
        payload = _serializer(session_key).loads(cookie)
        transaction = Transaction(**payload)
    except (BadSignature, TypeError):
        raise invalid_state() from None
    expired = now.timestamp() - transaction.started_at > TRANSACTION_MAX_AGE_SECONDS
    if (
        expired
        or transaction.purpose not in purposes
        or not secrets.compare_digest(transaction.state, state)
    ):
        raise invalid_state()
    return transaction


def safe_next_path(next_path: str | None) -> str:
    """A path on this site to land on afterwards. Only an absolute path is
    accepted, never a URL or a protocol-relative `//host`: 400
    `unsafe_return_url` otherwise, rather than an open redirect."""
    if next_path is None or next_path == "":
        return "/"
    if (
        not next_path.startswith("/")
        or next_path.startswith("//")
        or "\\" in next_path
        or any(ord(char) < 0x20 for char in next_path)
    ):
        raise APIError(400, "unsafe_return_url", "The return address must be a path on this site")
    return next_path


def frontend_origin(request: Request, settings: Settings) -> str:
    """The configured frontend origin this request came from (its Origin,
    else its Referer), else the first configured one. Never an origin
    outside CORS_ORIGINS, so a redirect can only land on the app."""
    for header in ("origin", "referer"):
        value = request.headers.get(header)
        if value:
            parsed = urlparse(value)
            candidate = f"{parsed.scheme}://{parsed.netloc}"
            if candidate in settings.cors_origins:
                return candidate
    return settings.cors_origins[0] if settings.cors_origins else ""
