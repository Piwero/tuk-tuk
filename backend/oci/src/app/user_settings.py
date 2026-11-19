"""Per-user settings (issue #409, ADR 0018): the current user's own row,
whether each integration is configured on it, and the first-boot
environment import that seeds user #1's.

Every route reads settings through `CurrentUserSettings`, never by id, so
which user a request acts as is decided in exactly one place
(app.users.current_user_id).
"""

from typing import Annotated

from fastapi import Depends

from app.calendar_source import GoogleOAuthClient
from app.config import Settings
from app.crypto import decrypt_credential, encrypt_credential
from app.db import SessionDep
from app.models import UserSettings
from app.users import current_user_id


async def current_user_settings(
    session: SessionDep, user_id: Annotated[int, Depends(current_user_id)]
) -> UserSettings:
    """The acting user's settings, loaded on the request's own session so a
    route's changes commit with everything else it writes. Every user has
    a row (app.users.create_user, migration 0036)."""
    row = await session.get(UserSettings, user_id)
    assert row is not None
    return row


CurrentUserSettings = Annotated[UserSettings, Depends(current_user_settings)]


def google_configured(user_settings: UserSettings) -> bool:
    """Whether this user has set up the Google Calendar integration at all
    (issue #117): both settings present. This is the source of truth every
    route needs to answer or gate on, not the one-time-import env vars in
    app.config, which are consulted only by `user_settings_from_env`."""
    return bool(user_settings.google_client_id) and bool(
        user_settings.encrypted_google_client_secret
    )


def google_oauth_client(user_settings: UserSettings, *, master_key: str) -> GoogleOAuthClient:
    """This user's own OAuth client, which every exchange and refresh
    against Google is made with. Only called once `google_configured`."""
    assert user_settings.google_client_id is not None
    assert user_settings.encrypted_google_client_secret is not None
    return GoogleOAuthClient(
        client_id=user_settings.google_client_id,
        client_secret=decrypt_credential(
            user_settings.encrypted_google_client_secret, key=master_key
        ),
    )


def voice_configured(user_settings: UserSettings) -> bool:
    """Whether the Voice Assistant (ADR 0015) has its LiveKit URL, API key
    and API secret — independent of the Assistant's settings, which it
    never reads."""
    return (
        bool(user_settings.voice_livekit_url)
        and bool(user_settings.voice_livekit_api_key)
        and bool(user_settings.encrypted_voice_livekit_api_secret)
    )


def user_settings_from_env(settings: Settings) -> UserSettings:
    """The one-time upgrade path of ADR 0008, now landing on the first
    user's settings: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and
    ASSIST_OLLAMA_BASE_URL / ASSIST_MODEL, if set, so an existing
    deployment's Google connection and Assist survive without a person
    re-entering anything. Used only when the first user is created, so the
    env vars are never consulted again, even if left in `.env`.
    """
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
    return UserSettings(
        google_client_id=google_client_id,
        encrypted_google_client_secret=encrypted_google_client_secret,
        # Neither value is a credential, so — unlike the Google pair above —
        # each imports independently; a lone one is simply unavailable
        # until its partner is set from Settings, not a security concern.
        assist_ollama_base_url=settings.assist_ollama_base_url,
        assist_model=settings.assist_model,
    )
