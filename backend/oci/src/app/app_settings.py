"""The DB-backed settings singleton (ADR 0008), down to what stays
install-wide (issue #409): bootstrapping it on first boot, and the fetch
every authenticated request needs to gate on and sign sessions with.
Everything per user lives in app.user_settings.
"""

import secrets

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import AppSettings

SETTINGS_ID = 1


async def get_app_settings(
    session: AsyncSession, *, for_update: bool = False
) -> AppSettings | None:
    return await session.get(AppSettings, SETTINGS_ID, with_for_update=for_update)


async def require_app_settings(session: AsyncSession, *, for_update: bool = False) -> AppSettings:
    """Like get_app_settings, but asserts the singleton row exists — true
    for every request that reaches here, since app.main's lifespan
    bootstraps it before the app starts serving. `for_update` locks the
    row until the transaction ends, to serialize a whole-install change.
    """
    row = await get_app_settings(session, for_update=for_update)
    assert row is not None
    return row


async def bootstrap_app_settings(session: AsyncSession, settings: Settings) -> AppSettings:
    """Ensures the singleton settings row exists, run once from app.main's
    lifespan before the app serves any request.

    A fresh row generates its own session_key — this value carries no
    meaning a person needs to choose, unlike the password, so it never
    waits on `/setup`. Created at most once: once a row exists it is
    left alone. The ADR 0008 env imports land elsewhere: AUTH_PASSWORD_HASH
    on a User (app.users.import_env_password), the integration env vars on
    the first User's settings (app.user_settings.user_settings_from_env).
    """
    row = await get_app_settings(session)
    if row is not None:
        return row

    row = AppSettings(
        id=SETTINGS_ID,
        session_key=secrets.token_urlsafe(32),
    )
    session.add(row)
    await session.commit()
    return row
