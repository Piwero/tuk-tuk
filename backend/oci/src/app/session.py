"""Signed, stateless session cookie (ADR 0005): no server-side session
store, so the issued-at time travels inside the signed payload itself and
every request's cookie is independently verifiable.
"""

from datetime import UTC, datetime, timedelta

from itsdangerous import BadSignature, URLSafeSerializer
from starlette.responses import Response

from app.config import Settings

SESSION_COOKIE_NAME = "tuktuk_session"

_SALT = "tuk-tuk-session"


def _serializer(settings: Settings) -> URLSafeSerializer:
    return URLSafeSerializer(settings.secret_key, salt=_SALT)


def issue_session_token(settings: Settings, issued_at: datetime) -> str:
    token: str = _serializer(settings).dumps({"iat": issued_at.timestamp()})
    return token


def set_session_cookie(
    response: Response, settings: Settings, issued_at: datetime | None = None
) -> None:
    """Sign and attach the session cookie to `response`. Inaccessible to
    JavaScript, sent only to this site, and `Secure` per configuration —
    Task notes render as Markdown, a more interesting scripting surface than
    most apps have, which makes JS-readability of the credential especially
    worth denying.
    """
    token = issue_session_token(settings, issued_at or datetime.now(UTC))
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=settings.auth_session_lifetime_days * 86400,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="strict",
        path="/",
    )


def verify_session_token(token: str | None, settings: Settings) -> datetime | None:
    """Return the token's issued-at time if it is validly signed and not
    past the configured session lifetime, else None.
    """
    if not token:
        return None
    try:
        payload = _serializer(settings).loads(token)
    except BadSignature:
        return None
    iat = payload.get("iat") if isinstance(payload, dict) else None
    if not isinstance(iat, int | float):
        return None
    issued_at = datetime.fromtimestamp(iat, tz=UTC)
    if datetime.now(UTC) - issued_at > timedelta(days=settings.auth_session_lifetime_days):
        return None
    return issued_at


def needs_reissue(issued_at: datetime, settings: Settings) -> bool:
    """True once the session is within the reissue threshold of expiry,
    keeping the ~30 day window rolling for an active user.
    """
    expires_at = issued_at + timedelta(days=settings.auth_session_lifetime_days)
    reissue_at = expires_at - timedelta(days=settings.auth_session_reissue_threshold_days)
    return datetime.now(UTC) >= reissue_at
