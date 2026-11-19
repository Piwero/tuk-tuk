"""Users (ADR 0018): creating one together with everything a User starts
with, naming the User a request acts as, finding one to log in, and the
password and session-epoch rules every auth path shares."""

import re

from fastapi import Request
from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import APIError
from app.models import TaskList, User, UserSettings

INBOX_NAME = "Inbox"
# The username migration 0035 gives the seeded user #1.
SEED_USERNAME = "admin"

# Lives here, next to the rules every password-setting path shares (issue
# #338), not in Settings: making this operator-configurable would let a
# deployment set it to 1, which is the state this constant exists to
# remove. Enforced only where a password is set (setup, forced step, change,
# an Admin's create or reset) — never at login, so a password set before
# this minimum existed keeps logging in until its owner changes it.
MIN_PASSWORD_LENGTH = 12

MAX_USERNAME_LENGTH = 64

# Deliberately loose: one "@" with something either side and no spaces.
# Nothing is sent to the address yet (ADR 0018), so this catches typos like
# a missing "@", not deliverability.
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+$")


def current_user_id(request: Request) -> int:
    """The id of the User this request acts as: the one seam every
    per-user read goes through (app.user_settings.current_user_settings).

    SessionAuthMiddleware puts the signed-in User's id (or, under
    AUTH_DISABLED, the first Admin's) on `request.state` before any route
    runs. Tests act as another User by overriding this dependency.
    """
    user_id: int = request.state.user_id
    return user_id


async def create_user(
    session: AsyncSession, user: User, user_settings: UserSettings | None = None
) -> User:
    """Adds `user` with what every user starts with: their own settings
    (defaults unless given) and their Inbox (issue #409). Every path that
    creates a user (`/setup`, the one-time env import, an Admin's create)
    goes through here, so no user ever exists without either. Flushes; the
    caller commits.

    A system code path (ADR 0018): it writes rows owned by the new User
    whoever the request acts as (nobody yet, during `/setup` and the env
    import; an Admin, for the admin API), so the global owner filter
    (issue #411) must exempt it.
    """
    session.add(user)
    await session.flush()
    settings_row = user_settings or UserSettings()
    settings_row.user_id = user.id
    session.add(settings_row)
    session.add(TaskList(name=INBOX_NAME, is_inbox=True, owner_id=user.id))
    await session.flush()
    return user


async def find_user_by_login(session: AsyncSession, login: str) -> User | None:
    """The User whose username or email is `login`. Both columns are
    citext, so the match ignores case."""
    user: User | None = await session.scalar(
        select(User).where(or_(User.username == login, User.email == login))
    )
    return user


async def install_has_password(session: AsyncSession) -> bool:
    """Whether anyone can log in yet. Until some User holds a password the
    install is waiting on `/setup` (or, on an upgrade from before ADR 0008,
    the one-time AUTH_PASSWORD_HASH import)."""
    return bool(await session.scalar(select(exists().where(User.password_hash.is_not(None)))))


async def first_admin(session: AsyncSession) -> User | None:
    """The oldest active Admin: who AUTH_DISABLED acts as."""
    user: User | None = await session.scalar(
        select(User).where(User.is_admin, User.is_active).order_by(User.id).limit(1)
    )
    return user


def set_password(user: User, password_hash: str) -> None:
    """Sets a new password and bumps the session epoch, which logs out
    every session the User already has (ADR 0018). The caller reissues
    the cookie of the session making the change, if it should stay in."""
    user.password_hash = password_hash
    user.session_epoch += 1


async def import_env_password(
    session: AsyncSession, password_hash: str | None, user_settings: UserSettings
) -> None:
    """The one-time AUTH_PASSWORD_HASH import (ADR 0008's upgrade path),
    run from app.main's lifespan. Acts only while no User can log in, so it
    runs at most once and never overrides a password set since.

    The hash lands on user #1, the seeded Admin, if the migration created
    one without a password; otherwise a fresh install gets user #1 shaped
    like the migration's seed (ADR 0018): username "admin", an Admin who
    must complete their profile on first login, starting from
    `user_settings` (the first-boot environment import).
    """
    if password_hash is None or await install_has_password(session):
        return
    seeded = await session.scalar(select(User).order_by(User.id).limit(1))
    if seeded is not None:
        seeded.password_hash = password_hash
    else:
        await create_user(
            session,
            User(
                username=SEED_USERNAME,
                password_hash=password_hash,
                is_admin=True,
                must_complete_profile=True,
            ),
            user_settings,
        )
    await session.commit()


def check_new_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise APIError(
            422, "invalid_password", f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
        )


def clean_username(username: str) -> str:
    username = username.strip()
    if not username or len(username) > MAX_USERNAME_LENGTH:
        raise APIError(
            422, "invalid_username", f"Username must be 1 to {MAX_USERNAME_LENGTH} characters"
        )
    return username


def clean_email(email: str) -> str:
    email = email.strip()
    if not _EMAIL_PATTERN.match(email):
        raise APIError(422, "invalid_email", "Enter a valid email address")
    return email


async def ensure_identity_free(
    session: AsyncSession, username: str, email: str | None, *, except_user: User | None = None
) -> None:
    """409 when another User already holds `username` or `email` (both
    citext, so case is ignored), reported per field: `username_taken` or
    `email_taken`. A missing email (the migration's seeded user #1) clashes
    with nobody."""
    others = select(User).where(User.id != except_user.id) if except_user else select(User)
    if await session.scalar(others.where(User.username == username)) is not None:
        raise APIError(409, "username_taken", "That username is already taken")
    if email is not None and await session.scalar(others.where(User.email == email)) is not None:
        raise APIError(409, "email_taken", "That email is already in use")
