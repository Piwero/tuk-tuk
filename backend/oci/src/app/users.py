"""User #1, the one user every request acts as until per-user login lands
(issue #405): created on a fresh install's first boot, and kept in step
with the install's password.
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SEED_USER_ID, AppSettings, User

SEED_USERNAME = "admin"


async def require_seed_user(session: AsyncSession) -> User:
    """Asserts user #1 exists: true for every request, since app.main's
    lifespan ensures it before the app starts serving."""
    user = await session.get(User, SEED_USER_ID)
    assert user is not None
    return user


async def ensure_seed_user(session: AsyncSession, app_settings: AppSettings) -> User:
    """Creates user #1 on a fresh install, run once from app.main's lifespan
    before anything owned is written. An upgraded install already has it
    (migration 0035). Mirrors the migration's seed: the admin, still to
    complete their profile, holding the install's password.
    """
    user = await session.get(User, SEED_USER_ID)
    if user is not None:
        return user
    user = User(
        id=SEED_USER_ID,
        username=SEED_USERNAME,
        password_hash=app_settings.password_hash,
        is_admin=True,
        must_complete_profile=True,
    )
    session.add(user)
    await session.flush()
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
