"""Signed, stateless session cookie (ADR 0005, ADR 0018): no server-side
session store, so the User's id, their session epoch and the issued-at
time travel inside the signed payload itself and every request's cookie is
independently verifiable. Revocation bumps the User's epoch, which no
longer matches the one in an older cookie (app.middleware).
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from itsdangerous import BadSignature, URLSafeSerializer
from starlette.responses import Response

from app.config import Settings

SESSION_COOKIE_NAME = "tuktuk_session"

_SALT = "tuk-tuk-session"

# How the session was signed in (issue #586). A Google session is never
# asked to replace a temporary password: that step belongs to the next
# password login (app.middleware.forced_step).
LoginMethod = Literal["password", "google"]

# Returns the current, timezone-aware UTC time. Injected everywhere the
# session lifecycle needs "now", so tests can drive expiry and reissue
# without sleeps or backdated tokens.
Clock = Callable[[], datetime]


def real_clock() -> datetime:
    return datetime.now(UTC)


def _serializer(session_key: str) -> URLSafeSerializer:
    return URLSafeSerializer(session_key, salt=_SALT)


@dataclass(frozen=True)
class SessionClaims:
    """What a verified session cookie says: who, at which epoch, since when."""

    user_id: int
    epoch: int
    issued_at: datetime
    method: LoginMethod = "password"


def issue_session_token(
    session_key: str,
    *,
    user_id: int,
    epoch: int,
    issued_at: datetime,
    method: LoginMethod = "password",
) -> str:
    payload: dict[str, object] = {"uid": user_id, "ep": epoch, "iat": issued_at.timestamp()}
    if method == "google":
        payload["m"] = "google"
    token: str = _serializer(session_key).dumps(payload)
    return token


def set_session_cookie(
    response: Response,
    session_key: str,
    settings: Settings,
    clock: Clock,
    *,
    user_id: int,
    epoch: int,
    issued_at: datetime | None = None,
    method: LoginMethod = "password",
) -> None:
    """Sign and attach `user_id`'s session cookie, at `epoch`, to `response`. Inaccessible to
    JavaScript, sent only to this site, and `Secure` per configuration —
    Task notes render as Markdown, a more interesting scripting surface than
    most apps have, which makes JS-readability of the credential especially
    worth denying.

    `SameSite=Lax`, not `Strict`: the Google Calendar integration's OAuth
    callback (routers/v1/google.py) is a top-level GET navigation initiated
    by accounts.google.com landing back on this site — a cross-site
    context that `Strict` cookies are never sent on, which would make
    SessionAuthMiddleware reject the callback as unauthenticated even for
    an already-logged-in user. `Lax` still withholds the cookie from
    cross-site subresource requests and non-GET requests, which is what
    matters for CSRF.
    """
    token = issue_session_token(
        session_key,
        user_id=user_id,
        epoch=epoch,
        issued_at=issued_at or clock(),
        method=method,
    )
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=settings.auth_session_lifetime_days * 86400,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path="/",
    )


def delete_session_cookie(response: Response, settings: Settings) -> None:
    """Clear the session cookie with the exact attributes it was set with
    (see `set_session_cookie`): a browser matches a deletion on name, path,
    and domain alone, so a mismatched `samesite` here would work by
    accident while reading as if it mattered.
    """
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
    )


def verify_session_token(
    token: str | None, session_key: str, settings: Settings, clock: Clock
) -> SessionClaims | None:
    """Return the token's claims if it is validly signed, names a User and
    an epoch, and is not past the configured session lifetime, else None.
    A cookie from before ADR 0018 names no User, so it is rejected.
    """
    if not token:
        return None
    try:
        payload = _serializer(session_key).loads(token)
    except BadSignature:
        return None
    if not isinstance(payload, dict):
        return None
    iat, user_id, epoch = payload.get("iat"), payload.get("uid"), payload.get("ep")
    # A signed payload only ever holds what issue_session_token wrote, but
    # each claim is still checked for its type before being trusted.
    if not isinstance(iat, int | float):
        return None
    if not isinstance(user_id, int) or not isinstance(epoch, int):
        return None
    issued_at = datetime.fromtimestamp(iat, tz=UTC)
    if clock() - issued_at > timedelta(days=settings.auth_session_lifetime_days):
        return None
    method: LoginMethod = "google" if payload.get("m") == "google" else "password"
    return SessionClaims(user_id=user_id, epoch=epoch, issued_at=issued_at, method=method)


def needs_reissue(issued_at: datetime, settings: Settings, clock: Clock) -> bool:
    """True once the session is older than the reissue threshold, keeping
    the ~30 day window rolling for an active user.

    `auth_session_reissue_threshold_days` is a minimum age before a refresh,
    not a distance from expiry: a session younger than the threshold is left
    alone, and one older than it is refreshed on its next request, however
    long before expiry that falls.
    """
    age = clock() - issued_at
    return age >= timedelta(days=settings.auth_session_reissue_threshold_days)
