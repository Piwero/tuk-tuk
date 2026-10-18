"""Signed, stateless session cookie (ADR 0005): no server-side session
store, so the issued-at time travels inside the signed payload itself and
every request's cookie is independently verifiable.
"""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from itsdangerous import BadSignature, URLSafeSerializer
from starlette.responses import Response

from app.config import Settings

SESSION_COOKIE_NAME = "tuktuk_session"

_SALT = "tuk-tuk-session"

# Returns the current, timezone-aware UTC time. Injected everywhere the
# session lifecycle needs "now", so tests can drive expiry and reissue
# without sleeps or backdated tokens.
Clock = Callable[[], datetime]


def real_clock() -> datetime:
    return datetime.now(UTC)


def _serializer(session_key: str) -> URLSafeSerializer:
    return URLSafeSerializer(session_key, salt=_SALT)


def issue_session_token(session_key: str, issued_at: datetime) -> str:
    token: str = _serializer(session_key).dumps({"iat": issued_at.timestamp()})
    return token


def set_session_cookie(
    response: Response,
    session_key: str,
    settings: Settings,
    clock: Clock,
    issued_at: datetime | None = None,
) -> None:
    """Sign and attach the session cookie to `response`. Inaccessible to
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
    token = issue_session_token(session_key, issued_at or clock())
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
) -> datetime | None:
    """Return the token's issued-at time if it is validly signed and not
    past the configured session lifetime, else None.
    """
    if not token:
        return None
    try:
        payload = _serializer(session_key).loads(token)
    except BadSignature:
        return None
    iat = payload.get("iat") if isinstance(payload, dict) else None
    if not isinstance(iat, int | float):
        return None
    issued_at = datetime.fromtimestamp(iat, tz=UTC)
    if clock() - issued_at > timedelta(days=settings.auth_session_lifetime_days):
        return None
    return issued_at


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
