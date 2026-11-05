"""The Voice Assistant's LiveKit configuration (ADR 0015; issue #366),
mirroring `assistant.py`: URL and API key are plain, the API secret is
encrypted at rest under `APP_MASTER_KEY` (ADR 0008) and write-only — the
read endpoint reports whether it is set, never its value.
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, field_validator

from app import voice_livekit
from app.app_settings import require_app_settings
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
    return VoiceConfig(**voice_livekit.read_config(app_settings))


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

    voice_livekit.apply_update(
        app_settings,
        master_key=master_key,
        url=payload.livekit_url,
        api_key=payload.livekit_api_key,
        api_secret=payload.livekit_api_secret,
    )

    await session.commit()
    return _config_from(app_settings)


@router.delete("/config", status_code=204)
async def remove_voice_config(session: SessionDep) -> None:
    """Clears every field, returning the Voice Assistant to the same
    unconfigured, invisible state as a fresh deployment."""
    app_settings = await require_app_settings(session)
    voice_livekit.clear(app_settings)
    await session.commit()


class VoiceSession(BaseModel):
    url: str
    token: str
    room: str


@router.post("/session")
async def start_voice_session(request: Request, session: SessionDep) -> VoiceSession:
    """Mints a join token for a fresh room, with the agent dispatched from
    inside the token (see `app.voice_livekit`). Unconfigured is a 404
    `voice_unavailable`: the feature does not exist until Settings has the
    LiveKit credentials, and the frontend never offers the mic before that."""
    master_key = request.app.state.settings.app_master_key
    assert master_key is not None  # app.main refuses to start without it
    app_settings = await require_app_settings(session)
    if not voice_livekit.is_configured(app_settings):
        raise APIError(404, "voice_unavailable", "Voice Assistant is not configured")
    return VoiceSession(**voice_livekit.create_session(app_settings, master_key=master_key))
