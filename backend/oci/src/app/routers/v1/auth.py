"""First-run setup, login, the signed-in User's account record, forced
steps, change-password and logout (ADR 0005, ADR 0008, ADR 0018; issues
#83, #115, #116, #339, #410)."""

from datetime import UTC, datetime

from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import require_app_settings
from app.auth import password_hasher
from app.current_user import CurrentUserDep
from app.db import SessionDep
from app.errors import APIError
from app.login_throttle import LoginThrottle
from app.models import User
from app.session import Clock, delete_session_cookie, set_session_cookie
from app.user_settings import user_settings_from_env
from app.users import (
    check_new_password,
    clean_email,
    clean_username,
    create_user,
    ensure_identity_free,
    find_user_by_login,
    install_has_password,
    set_password,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# Consecutive wrong-password attempts (login or change-password's
# current-password check, same per-User counter) before login locks — not
# operator-configurable, same reasoning as app.users.MIN_PASSWORD_LENGTH.
LOCKOUT_THRESHOLD = 5


def _locked_retry_after(user: User, now: datetime) -> int | None:
    """Seconds until `user.login_locked_until`, or None if not
    currently locked (null, or in the past). Normalized to UTC before
    comparing against `now` (also UTC, from app.session.Clock) — a no-op
    for PostgreSQL's aware `timestamptz`, kept as a guard against any
    naive value."""
    locked_until = user.login_locked_until
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
    session: AsyncSession, user: User, clock: Clock, base_seconds: float
) -> None:
    user.login_failed_attempts += 1
    if user.login_failed_attempts >= LOCKOUT_THRESHOLD:
        user.login_locked_until = LoginThrottle.lock_until(
            failure_count=user.login_failed_attempts,
            now=clock(),
            base_seconds=base_seconds,
        )
    await session.commit()


async def _record_success(session: AsyncSession, user: User) -> None:
    user.login_failed_attempts = 0
    user.login_locked_until = None
    await session.commit()


def _password_matches(user: User, password: str) -> bool:
    if user.password_hash is None:
        return False
    try:
        password_hasher.verify(user.password_hash, password)
    except (VerificationError, InvalidHashError):
        return False
    return True


def _sign_in(request: Request, response: Response, session_key: str, user: User) -> None:
    set_session_cookie(
        response,
        session_key,
        request.app.state.settings,
        request.app.state.clock,
        user_id=user.id,
        epoch=user.session_epoch,
    )


class SetupRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    login: str
    password: str


class CompleteRequest(BaseModel):
    """A forced step's answer. `new_password` is always required;
    `username` and `email` only when completing a profile."""

    new_password: str
    username: str | None = None
    email: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class MeResponse(BaseModel):
    id: int
    username: str
    email: str | None
    is_admin: bool
    must_change_password: bool
    must_complete_profile: bool


@router.post("/setup", status_code=204)
async def setup(
    payload: SetupRequest, request: Request, response: Response, session: SessionDep
) -> None:
    """Creates the first Admin on a fresh install and signs them in
    (ADR 0018). Reachable only while no User can log in: once one can,
    this is a 404 and accounts come from the admin API instead.

    An upgraded install whose seeded user #1 never had a password (the
    single-user install ran with AUTH_DISABLED) completes that User here
    instead of creating a second one, so their data stays theirs.
    """
    # Serializes concurrent first-run attempts on the settings row, so two
    # browsers racing through setup cannot both create an Admin.
    app_settings = await require_app_settings(session, for_update=True)
    if await install_has_password(session):
        raise APIError(404, "not_found", "Setup has already been completed")

    username = clean_username(payload.username)
    email = clean_email(payload.email)
    check_new_password(payload.password)
    password_hash = password_hasher.hash(payload.password)

    seeded = await session.scalar(select(User).order_by(User.id).limit(1))
    if seeded is None:
        # The first Admin also takes the one-time integration env import
        # (ADR 0008), as user #1 did when the lifespan created it.
        user = await create_user(
            session,
            User(username=username, email=email, password_hash=password_hash, is_admin=True),
            user_settings_from_env(request.app.state.settings),
        )
    else:
        await ensure_identity_free(session, username, email, except_user=seeded)
        user = seeded
        user.username, user.email, user.is_admin = username, email, True
        user.must_complete_profile = user.must_change_password = False
        set_password(user, password_hash)
    await session.commit()

    _sign_in(request, response, app_settings.session_key, user)


@router.post("/login", status_code=204)
async def login(
    payload: LoginRequest, request: Request, response: Response, session: SessionDep
) -> None:
    """Logs in by username or email, either ignoring case (ADR 0018).

    An unknown login and a wrong password get the same 401, and only the
    named User's lockout counts the failure. Rejects immediately while that
    User is locked (issue #339) — no password verification and no sleep,
    so a locked caller never holds a connection open. A disabled User with
    the right password gets 403 `account_disabled`; a wrong password never
    learns the account is disabled.
    """
    settings = request.app.state.settings
    clock = request.app.state.clock

    if not await install_has_password(session):
        raise APIError(404, "not_found", "Setup has not been completed")
    invalid = APIError(401, "invalid_credentials", "Incorrect login or password")

    user = await find_user_by_login(session, payload.login.strip())
    if user is None:
        raise invalid

    retry_after = _locked_retry_after(user, clock())
    if retry_after is not None:
        raise _too_many_attempts(retry_after)

    if not _password_matches(user, payload.password):
        await _record_failure(session, user, clock, settings.auth_login_delay_seconds)
        raise invalid

    await _record_success(session, user)
    if not user.is_active:
        raise APIError(403, "account_disabled", "This account is disabled")

    app_settings = await require_app_settings(session)
    _sign_in(request, response, app_settings.session_key, user)


@router.get("/me")
async def me(user: CurrentUserDep) -> MeResponse:
    """The signed-in User's own account record, including any forced step
    still pending — reachable while one is (app.middleware)."""
    return MeResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        is_admin=user.is_admin,
        must_change_password=user.must_change_password,
        must_complete_profile=user.must_complete_profile,
    )


@router.post("/complete", status_code=204)
async def complete(
    payload: CompleteRequest,
    request: Request,
    response: Response,
    user: CurrentUserDep,
    session: SessionDep,
) -> None:
    """Completes the pending forced step: a profile to complete (username,
    email and a new password, for the upgraded user #1) or a temporary
    password to replace. Either way the new password must differ from the
    current one, and setting it bumps the epoch: other sessions end, and
    this one gets a fresh cookie.
    """
    if not (user.must_complete_profile or user.must_change_password):
        raise APIError(409, "no_pending_step", "There is no step to complete")

    if user.must_complete_profile:
        if payload.username is None or payload.email is None:
            raise APIError(
                422, "profile_required", "Username and email are required to complete a profile"
            )
        username = clean_username(payload.username)
        email = clean_email(payload.email)
    check_new_password(payload.new_password)
    if _password_matches(user, payload.new_password):
        raise APIError(
            422, "password_unchanged", "Choose a password different from the current one"
        )
    if user.must_complete_profile:
        await ensure_identity_free(session, username, email, except_user=user)
        user.username, user.email = username, email

    user.must_complete_profile = user.must_change_password = False
    set_password(user, password_hasher.hash(payload.new_password))
    await session.commit()

    app_settings = await require_app_settings(session)
    _sign_in(request, response, app_settings.session_key, user)


@router.post("/password", status_code=204)
async def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    response: Response,
    user: CurrentUserDep,
    session: SessionDep,
) -> None:
    """Changes the signed-in User's password and bumps their session epoch
    (ADR 0018), which logs out every other session of theirs and nobody
    else's. A fresh cookie at the new epoch keeps this device logged in.

    Feeds the same per-User lockout as /login (issue #339's user story 19):
    a stolen session must not let an attacker brute-force the password
    through this endpoint instead. A wrong current password is 400, not
    401, so the frontend does not treat it as a lost session.
    """
    settings = request.app.state.settings
    clock = request.app.state.clock

    retry_after = _locked_retry_after(user, clock())
    if retry_after is not None:
        raise _too_many_attempts(retry_after)

    if not _password_matches(user, payload.current_password):
        await _record_failure(session, user, clock, settings.auth_login_delay_seconds)
        raise APIError(400, "invalid_current_password", "Current password is incorrect")

    # The current password was correct, so this resets the lockout
    # regardless of what happens next — an empty new password shouldn't
    # leave a prior bad-guess streak counted against a later, valid attempt.
    await _record_success(session, user)

    check_new_password(payload.new_password)
    set_password(user, password_hasher.hash(payload.new_password))
    await session.commit()

    app_settings = await require_app_settings(session)
    _sign_in(request, response, app_settings.session_key, user)


@router.get("/session", status_code=204)
async def session_probe() -> None:
    """Reached only when SessionAuthMiddleware has already accepted the
    request's cookie — the frontend uses this to ask "am I logged in?" in
    one cheap request, rather than inferring login state from whether a
    data load happened to succeed.
    """


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response) -> None:
    """Clears this device's session cookie. There is no server-side session
    store to revoke (ADR 0005); other devices stay signed in until the
    User's epoch is bumped.
    """
    settings = request.app.state.settings
    delete_session_cookie(response, settings)
