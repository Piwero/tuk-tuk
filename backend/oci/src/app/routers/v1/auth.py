"""First-run setup, login, session-probe, and change-password endpoints
(ADR 0005, issue #83; ADR 0008, issues #115 and #116; lockout, issue #339)."""

import secrets
from datetime import UTC, datetime

from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import get_app_settings, require_app_settings
from app.auth import password_hasher
from app.db import SessionDep
from app.errors import APIError
from app.login_throttle import LoginThrottle
from app.models import AppSettings
from app.session import Clock, delete_session_cookie, set_session_cookie

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# Lives here, next to the handlers that enforce it (issue #338), not in
# Settings: making this operator-configurable would let a deployment set it
# to 1, which is the state this constant exists to remove. Enforced only at
# the two write points below — never at login, so a password set before
# this minimum existed keeps logging in until its owner changes it.
MIN_PASSWORD_LENGTH = 12

# Consecutive wrong-password attempts (login or change-password's
# current-password check, same counter) before login locks — not
# operator-configurable, same reasoning as the password minimum above.
LOCKOUT_THRESHOLD = 5


def _locked_retry_after(app_settings: AppSettings, now: datetime) -> int | None:
    """Seconds until `app_settings.login_locked_until`, or None if not
    currently locked (null, or in the past). SQLite round-trips a
    timezone-aware DateTime as naive, so it's normalized back to UTC
    before comparing against `now` (also UTC, from app.session.Clock)."""
    locked_until = app_settings.login_locked_until
    if locked_until is None:
        return None
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=UTC)
    if locked_until <= now:
        return None
    return max(1, int((locked_until - now).total_seconds()))


def _too_many_attempts(retry_after: int) -> APIError:
    return APIError(
        429,
        "too_many_attempts",
        "Too many attempts. Try again later.",
        retry_after=retry_after,
    )


async def _record_failure(
    session: AsyncSession, app_settings: AppSettings, clock: Clock, base_seconds: float
) -> None:
    app_settings.login_failed_attempts += 1
    if app_settings.login_failed_attempts >= LOCKOUT_THRESHOLD:
        app_settings.login_locked_until = LoginThrottle.lock_until(
            failure_count=app_settings.login_failed_attempts,
            now=clock(),
            base_seconds=base_seconds,
        )
    await session.commit()


async def _record_success(session: AsyncSession, app_settings: AppSettings) -> None:
    app_settings.login_failed_attempts = 0
    app_settings.login_locked_until = None
    await session.commit()


class LoginRequest(BaseModel):
    password: str


class SetupRequest(BaseModel):
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/setup", status_code=204)
async def setup(
    payload: SetupRequest, request: Request, response: Response, session: SessionDep
) -> None:
    """Sets the initial password (ADR 0008). The settings row itself always
    exists by the time any request reaches here — app.main's lifespan
    bootstraps it before the app serves anything — but its password_hash
    starts out unset, which is exactly what SessionAuthMiddleware gates
    every other route on.

    Rejects once a password already exists: this must never be replayable
    to reset the password without a valid session — that's the
    change-password flow (issue #116), reachable only once already logged
    in.
    """
    app_settings = await require_app_settings(session)
    if app_settings.password_hash is not None:
        raise APIError(404, "not_found", "Setup has already been completed")
    if len(payload.password) < MIN_PASSWORD_LENGTH:
        raise APIError(
            422, "invalid_password", f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
        )

    app_settings.password_hash = password_hasher.hash(payload.password)
    await session.commit()

    set_session_cookie(
        response, app_settings.session_key, request.app.state.settings, request.app.state.clock
    )


@router.post("/login", status_code=204)
async def login(
    payload: LoginRequest, request: Request, response: Response, session: SessionDep
) -> None:
    """Rejects immediately while locked (issue #339) — no password
    verification and no sleep, so a locked caller never holds a
    connection open. On mismatch, escalates the persisted lock; on
    success, clears it.
    """
    settings = request.app.state.settings
    clock = request.app.state.clock

    app_settings = await get_app_settings(session)
    if app_settings is None or app_settings.password_hash is None:
        raise APIError(404, "not_found", "Setup has not been completed")

    retry_after = _locked_retry_after(app_settings, clock())
    if retry_after is not None:
        raise _too_many_attempts(retry_after)

    try:
        password_hasher.verify(app_settings.password_hash, payload.password)
    except VerifyMismatchError:
        await _record_failure(session, app_settings, clock, settings.auth_login_delay_seconds)
        raise APIError(401, "invalid_credentials", "Incorrect password") from None

    await _record_success(session, app_settings)
    set_session_cookie(response, app_settings.session_key, settings, clock)


@router.post("/password", status_code=204)
async def change_password(
    payload: ChangePasswordRequest, request: Request, response: Response, session: SessionDep
) -> None:
    """Changes the password and rotates the session signing key (ADR 0008),
    which invalidates every outstanding session cookie — deliberately
    including the one on this request, since a stale settings row could
    otherwise be read mid-request. A fresh cookie signed with the new key is
    issued below so the device making the change stays logged in; every
    other device's cookie is rejected on its next request.

    Reached only with a valid session (SessionAuthMiddleware; this path is
    not in PUBLIC_PATHS), so the current password itself is what's being
    checked here, not whether the caller is logged in. Feeds the same
    persisted lockout as /login (issue #339's user story 19): a stolen
    session must not let an attacker brute-force the password through
    this endpoint instead.
    """
    settings = request.app.state.settings
    clock = request.app.state.clock

    app_settings = await require_app_settings(session)
    assert app_settings.password_hash is not None  # a session exists only once one is set

    retry_after = _locked_retry_after(app_settings, clock())
    if retry_after is not None:
        raise _too_many_attempts(retry_after)

    try:
        password_hasher.verify(app_settings.password_hash, payload.current_password)
    except VerifyMismatchError:
        await _record_failure(session, app_settings, clock, settings.auth_login_delay_seconds)
        raise APIError(400, "invalid_current_password", "Current password is incorrect") from None

    # The current password was correct, so this resets the lockout
    # regardless of what happens next — an empty new password shouldn't
    # leave a prior bad-guess streak counted against a later, valid attempt.
    await _record_success(session, app_settings)

    if len(payload.new_password) < MIN_PASSWORD_LENGTH:
        raise APIError(
            422, "invalid_password", f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
        )

    app_settings.password_hash = password_hasher.hash(payload.new_password)
    app_settings.session_key = secrets.token_urlsafe(32)
    await session.commit()

    set_session_cookie(response, app_settings.session_key, settings, request.app.state.clock)


@router.get("/session", status_code=204)
async def session_probe() -> None:
    """Reached only when SessionAuthMiddleware has already accepted the
    request's cookie — the frontend uses this to ask "am I logged in?" in
    one cheap request, rather than inferring login state from whether a
    data load happened to succeed.
    """


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response) -> None:
    """Clears the session cookie. There is no server-side session store to
    revoke (ADR 0005) — this is reached only with a currently-valid cookie
    (SessionAuthMiddleware), and deleting it is the whole of "logging out".
    """
    settings = request.app.state.settings
    delete_session_cookie(response, settings)
