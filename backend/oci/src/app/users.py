"""Users: creating one together with everything a user starts with, and
naming the user a request acts as.

User #1 is the one user every request acts as until per-user login lands
(issue #405): created on a fresh install's first boot, and kept in step
with the install's password.
"""

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SEED_USER_ID, AppSettings, TaskList, User, UserSettings

SEED_USERNAME = "admin"
INBOX_NAME = "Inbox"


def current_user_id(request: Request) -> int:
    """The id of the user this request acts as: the one seam every
    per-user read goes through (app.user_settings.current_user_settings).

    Always user #1 until per-user login (issue #410) authenticates a user
    and this returns theirs. Tests act as another user by overriding this
    dependency.
    """
    return SEED_USER_ID


async def create_user(
    session: AsyncSession, user: User, user_settings: UserSettings | None = None
) -> User:
    """Adds `user` with what every user starts with: their own settings
    (defaults unless given) and their Inbox (issue #409). Every path that
    creates a user (first boot, `/setup`, an Admin's create) goes through
    here, so no user ever exists without either. Flushes; the caller
    commits.
    """
    session.add(user)
    await session.flush()
    settings_row = user_settings or UserSettings()
    settings_row.user_id = user.id
    session.add(settings_row)
    session.add(TaskList(name=INBOX_NAME, is_inbox=True, owner_id=user.id))
    await session.flush()
    return user


async def require_seed_user(session: AsyncSession) -> User:
    """Asserts user #1 exists: true for every request, since app.main's
    lifespan ensures it before the app starts serving."""
    user = await session.get(User, SEED_USER_ID)
    assert user is not None
    return user


async def ensure_seed_user(
    session: AsyncSession, app_settings: AppSettings, user_settings: UserSettings
) -> User:
    """Creates user #1 on a fresh install, run once from app.main's lifespan
    before anything owned is written. An upgraded install already has it
    (migrations 0035 and 0036, which also gave it its settings and kept its
    Inbox). Mirrors the migration's seed: the admin, still to complete
    their profile, holding the install's password, starting from
    `user_settings` (the first-boot environment import).
    """
    user = await session.get(User, SEED_USER_ID)
    if user is not None:
        return user
    user = await create_user(
        session,
        User(
            id=SEED_USER_ID,
            username=SEED_USERNAME,
            password_hash=app_settings.password_hash,
            is_admin=True,
            must_complete_profile=True,
        ),
        user_settings,
    )
    # The explicit id leaves the sequence behind; move it past user #1 so
    # the next user created gets id 2.
    await session.execute(
        text("SELECT setval(pg_get_serial_sequence('users', 'id'), max(id)) FROM users")
    )
    await session.commit()
    return user


def set_install_password(app_settings: AppSettings, user: User, password_hash: str) -> None:
    """Login still verifies against `settings.password_hash`; user #1's copy
    is kept identical so per-user login can switch to it with no data step."""
    app_settings.password_hash = password_hash
    user.password_hash = password_hash
