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


async def get_app_settings(session: AsyncSession) -> AppSettings | None:
    return await session.get(AppSettings, SETTINGS_ID)


async def require_app_settings(session: AsyncSession) -> AppSettings:
    """Like get_app_settings, but asserts the singleton row exists — true
    for every request that reaches here, since app.main's lifespan
    bootstraps it before the app starts serving.
    """
    row = await get_app_settings(session)
    assert row is not None
    return row


async def bootstrap_app_settings(session: AsyncSession, settings: Settings) -> AppSettings:
    """Ensures the singleton settings row exists, run once from app.main's
    lifespan before the app serves any request.

    A fresh row generates its own session_key — this value carries no
    meaning a person needs to choose, unlike the password, so it never
    waits on `/setup`. The one-time upgrade path (ADR 0008) imports
    AUTH_PASSWORD_HASH here on the very first boot (no row yet); once a
    row exists, it is never consulted again, even if left in `.env`. The
    integration env vars land on the first user's settings instead
    (app.user_settings.user_settings_from_env).
    """
    row = await get_app_settings(session)
    if row is not None:
        return row

    row = AppSettings(
        id=SETTINGS_ID,
        session_key=secrets.token_urlsafe(32),
        password_hash=settings.auth_password_hash,
    )
    session.add(row)
    await session.commit()
    return row
