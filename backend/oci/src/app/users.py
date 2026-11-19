"""Users (ADR 0018): creating one, finding one to log in, and the
password and session-epoch rules every auth path shares."""

from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TaskList, User

INBOX_NAME = "Inbox"
# The username migration 0035 gives the seeded user #1.
SEED_USERNAME = "admin"


async def create_user(
    session: AsyncSession,
    *,
    username: str,
    email: str | None,
    password_hash: str | None,
    is_admin: bool = False,
    must_change_password: bool = False,
    must_complete_profile: bool = False,
) -> User:
    """Creates a User together with everything a User starts with (today
    their Inbox). The one place a User is born, so every creation path
    (`/setup`, the one-time env import, the admin API) gets the same
    starter rows. Flushes, so the id is set; the caller commits.
    """
    user = User(
        username=username,
        email=email,
        password_hash=password_hash,
        is_admin=is_admin,
        must_change_password=must_change_password,
        must_complete_profile=must_complete_profile,
    )
    session.add(user)
    await session.flush()
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


async def import_env_password(session: AsyncSession, password_hash: str | None) -> None:
    """The one-time AUTH_PASSWORD_HASH import (ADR 0008's upgrade path),
    run from app.main's lifespan. Acts only while no User can log in, so it
    runs at most once and never overrides a password set since.

    The hash lands on user #1, the seeded Admin, if the migration created
    one without a password; otherwise a fresh install gets user #1 shaped
    like the migration's seed (ADR 0018): username "admin", an Admin who
    must complete their profile on first login.
    """
    if password_hash is None or await install_has_password(session):
        return
    seeded = await session.scalar(select(User).order_by(User.id).limit(1))
    if seeded is not None:
        seeded.password_hash = password_hash
    else:
        await create_user(
            session,
            username=SEED_USERNAME,
            email=None,
            password_hash=password_hash,
            is_admin=True,
            must_complete_profile=True,
        )
    await session.commit()
