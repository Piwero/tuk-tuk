"""The Voice Assistant's LiveKit configuration (ADR 0015; issue #366),
mirroring `assistant.py`: URL and API key are plain, the API secret is
encrypted at rest under `APP_MASTER_KEY` (ADR 0008) and write-only — the
read endpoint reports whether it is set, never its value.
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, field_validator

from app.app_settings import require_app_settings, voice_configured
from app.crypto import encrypt_credential
from app.db import SessionDep
from app.errors import APIError
from app.models import AppSettings
from app.schemas import reject_explicit_null

router = APIRouter(prefix="/api/v1/voice", tags=["voice"])


class VoiceConfig(BaseModel):
    livekit_url: str | None
    livekit_api_key: str | None
    livekit_api_secret_set: bool
    configured: bool


# PATCH-style: absent means "leave unchanged" (reject_explicit_null). The
# secret is write-only — omitting it keeps whatever is stored.
class VoiceConfigUpdate(BaseModel):
    livekit_url: str | None = Field(default=None, min_length=1, max_length=255)
    livekit_api_key: str | None = Field(default=None, min_length=1, max_length=255)
    livekit_api_secret: str | None = Field(default=None, min_length=1)

    _reject_nulls = field_validator("livekit_url", "livekit_api_key", "livekit_api_secret")(
        reject_explicit_null
    )


def _config_from(app_settings: AppSettings) -> VoiceConfig:
    return VoiceConfig(
        livekit_url=app_settings.voice_livekit_url,
        livekit_api_key=app_settings.voice_livekit_api_key,
        livekit_api_secret_set=app_settings.encrypted_voice_livekit_api_secret is not None,
        configured=voice_configured(app_settings),
    )


@router.get("/config")
async def read_voice_config(session: SessionDep) -> VoiceConfig:
    return _config_from(await require_app_settings(session))


@router.put("/config")
async def update_voice_config(
    payload: VoiceConfigUpdate, request: Request, session: SessionDep
) -> VoiceConfig:
    master_key = request.app.state.settings.app_master_key
    assert master_key is not None  # app.main refuses to start without it
    app_settings = await require_app_settings(session)

    # Like Google: the first save needs a secret, later ones may omit it.
    if (
        payload.livekit_api_secret is None
        and app_settings.encrypted_voice_livekit_api_secret is None
    ):
        raise APIError(422, "livekit_secret_required", "A LiveKit API secret is required")

    if payload.livekit_url is not None:
        app_settings.voice_livekit_url = payload.livekit_url
    if payload.livekit_api_key is not None:
        app_settings.voice_livekit_api_key = payload.livekit_api_key
    if payload.livekit_api_secret is not None:
        app_settings.encrypted_voice_livekit_api_secret = encrypt_credential(
            payload.livekit_api_secret, key=master_key
        )

    await session.commit()
    return _config_from(app_settings)


@router.delete("/config", status_code=204)
async def remove_voice_config(session: SessionDep) -> None:
    """Clears every field, returning the Voice Assistant to the same
    unconfigured, invisible state as a fresh deployment."""
    app_settings = await require_app_settings(session)
    app_settings.voice_livekit_url = None
    app_settings.voice_livekit_api_key = None
    app_settings.encrypted_voice_livekit_api_secret = None
    await session.commit()
