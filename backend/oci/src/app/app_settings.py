"""The DB-backed settings singleton (ADR 0008): bootstrapping on first
boot, and the fetch every authenticated request needs to gate on and sign
sessions with.
"""

import secrets

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.crypto import encrypt_credential
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


def google_configured(app_settings: AppSettings) -> bool:
    """Whether the Google Calendar integration is set up at all (issue
    #117) — both DB-stored settings present. This is the source of truth
    every route needs to answer or gate on (google.py's settings routes,
    events.py's read-only feed), not the one-time-import env vars in
    app.config, which are consulted only by `bootstrap_app_settings` below.
    """
    return bool(app_settings.google_client_id) and bool(app_settings.encrypted_google_client_secret)


def assist_configured(app_settings: AppSettings) -> bool:
    """Whether Assist has both settings it needs (ADR 0005) — the source of
    truth every route consults, not the one-time-import env vars in
    app.config, which `bootstrap_app_settings` below only reads once."""
    return bool(app_settings.assist_ollama_base_url) and bool(app_settings.assist_model)


def assistant_configured(app_settings: AppSettings) -> bool:
    """Whether the Assistant (ADR 0009) has every setting it needs — base
    URL, model, and an API key — entirely independent of `assist_configured`
    above, which this never reads."""
    return (
        bool(app_settings.assistant_base_url)
        and bool(app_settings.assistant_model)
        and bool(app_settings.encrypted_assistant_api_key)
    )


async def bootstrap_app_settings(session: AsyncSession, settings: Settings) -> AppSettings:
    """Ensures the singleton settings row exists, run once from app.main's
    lifespan before the app serves any request.

    A fresh row generates its own session_key — this value carries no
    meaning a person needs to choose, unlike the password, so it never
    waits on `/setup`. The one-time upgrade path (ADR 0008) lives here too:
    if this is the very first boot (no row yet) and AUTH_PASSWORD_HASH /
    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set in the environment,
    they're imported into the row so an existing deployment's password and
    Google connection survive the upgrade without a person re-entering
    anything. This runs at most once: once a row exists, the env vars are
    never consulted again, even if left in `.env`.
    """
    row = await get_app_settings(session)
    if row is not None:
        return row

    # Imported as a pair or not at all — a lone GOOGLE_CLIENT_ID with no
    # secret (or vice versa) would otherwise persist as a half-configured,
    # unusable row that this one-time import never gets a second chance to
    # complete.
    google_client_id = None
    encrypted_google_client_secret = None
    if settings.google_client_id and settings.google_client_secret:
        assert settings.app_master_key is not None  # app.main refuses to start without it
        google_client_id = settings.google_client_id
        encrypted_google_client_secret = encrypt_credential(
            settings.google_client_secret, key=settings.app_master_key
        )

    row = AppSettings(
        id=SETTINGS_ID,
        session_key=secrets.token_urlsafe(32),
        password_hash=settings.auth_password_hash,
        google_client_id=google_client_id,
        encrypted_google_client_secret=encrypted_google_client_secret,
        # Neither value is a credential, so — unlike the Google pair above —
        # each imports independently; a lone one is simply unavailable
        # until its partner is set from Settings, not a security concern.
        assist_ollama_base_url=settings.assist_ollama_base_url,
        assist_model=settings.assist_model,
    )
    session.add(row)
    await session.commit()
    return row
