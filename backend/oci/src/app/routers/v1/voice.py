"""The Voice Assistant's LiveKit configuration (ADR 0015; issue #366),
mirroring `assistant.py`: URL and API key are plain, the API secret is
encrypted at rest under `APP_MASTER_KEY` (ADR 0008) and write-only — the
read endpoint reports whether it is set, never its value.
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, field_validator

from app import voice_livekit
from app.db import SessionDep
from app.errors import APIError
from app.models import UserSettings
from app.schemas import reject_explicit_null
from app.user_settings import CurrentUserSettings

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


def _config_from(user_settings: UserSettings) -> VoiceConfig:
    return VoiceConfig(**voice_livekit.read_config(user_settings))


@router.get("/config")
async def read_voice_config(user_settings: CurrentUserSettings) -> VoiceConfig:
    return _config_from(user_settings)


@router.put("/config")
async def update_voice_config(
    payload: VoiceConfigUpdate,
    request: Request,
    session: SessionDep,
    user_settings: CurrentUserSettings,
) -> VoiceConfig:
    master_key = request.app.state.settings.app_master_key
    assert master_key is not None  # app.main refuses to start without it

    # Like Google: the first save needs a secret, later ones may omit it.
    if (
        payload.livekit_api_secret is None
        and user_settings.encrypted_voice_livekit_api_secret is None
    ):
        raise APIError(422, "livekit_secret_required", "A LiveKit API secret is required")

    voice_livekit.apply_update(
        user_settings,
        master_key=master_key,
        url=payload.livekit_url,
        api_key=payload.livekit_api_key,
        api_secret=payload.livekit_api_secret,
    )

    await session.commit()
    return _config_from(user_settings)


@router.delete("/config", status_code=204)
async def remove_voice_config(session: SessionDep, user_settings: CurrentUserSettings) -> None:
    """Clears every field, returning the Voice Assistant to the same
    unconfigured, invisible state as a fresh deployment."""
    voice_livekit.clear(user_settings)
    await session.commit()


class VoiceSession(BaseModel):
    url: str
    token: str
    room: str


@router.post("/session")
async def start_voice_session(request: Request, user_settings: CurrentUserSettings) -> VoiceSession:
    """Mints a join token for a fresh room, with the agent dispatched from
    inside the token (see `app.voice_livekit`). Unconfigured is a 404
    `voice_unavailable`: the feature does not exist until Settings has the
    LiveKit credentials, and the frontend never offers the mic before that."""
    master_key = request.app.state.settings.app_master_key
    assert master_key is not None  # app.main refuses to start without it
    if not voice_livekit.is_configured(user_settings):
        raise APIError(404, "voice_unavailable", "Voice Assistant is not configured")
    return VoiceSession(**voice_livekit.create_session(user_settings, master_key=master_key))
