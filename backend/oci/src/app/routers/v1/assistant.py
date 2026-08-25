"""The Assistant's configuration and availability gate (ADR 0009; issue
#185) — the foundation every later Assistant slice rides on, mirroring what
`assist.py` does for Assisted Capture.

Entirely independent of Assisted Capture's configuration: this router never
reads `assist_ollama_base_url` / `assist_model`, and nothing here changes
Assisted Capture's behavior, prompt, or settings. Unlike the Ollama base
URL, the API key *is* a credential and is encrypted at rest under
`APP_MASTER_KEY` (ADR 0008) and write-only in the API — the read endpoint
reports whether it's set, never its value, exactly as the Google client
secret does.
"""

from datetime import date
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, field_validator

from app.app_settings import require_app_settings
from app.assistant_chat import (
    AssistantChatMessage,
    AssistantChatTurn,
    build_messages,
    fallback_turn,
    request_assistant_turn,
    validate_turn,
)
from app.assistant_provider import assistant_available
from app.assistant_snapshot import build_week_snapshot
from app.config import Settings
from app.crypto import decrypt_credential, encrypt_credential
from app.db import SessionDep
from app.models import AppSettings
from app.schemas import reject_explicit_null

router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])


class AssistantStatus(BaseModel):
    available: bool


class AssistantConfig(BaseModel):
    base_url: str | None
    model: str | None
    # The API key's value never round-trips — only whether one is stored,
    # exactly as GoogleStatus.client_secret_set never discloses the secret.
    api_key_set: bool
    planning_preferences: str | None


# PATCH-style fields: absent means "leave unchanged" (reject_explicit_null),
# the same convention as AssistConfigUpdate/GoogleCredentialsUpdate. Unlike
# base_url/model, api_key is write-only — omitting it keeps whatever is
# already stored, and it's never echoed back.
class AssistantConfigUpdate(BaseModel):
    base_url: str | None = Field(default=None, min_length=1, max_length=255)
    model: str | None = Field(default=None, min_length=1, max_length=255)
    api_key: str | None = Field(default=None, min_length=1)
    planning_preferences: str | None = Field(default=None, max_length=4000)

    _reject_nulls = field_validator("base_url", "model", "api_key", "planning_preferences")(
        reject_explicit_null
    )


def _require_master_key(settings: Settings) -> str:
    assert settings.app_master_key is not None  # app.main refuses to start without it
    return settings.app_master_key


def _config_from(app_settings: AppSettings) -> AssistantConfig:
    return AssistantConfig(
        base_url=app_settings.assistant_base_url,
        model=app_settings.assistant_model,
        api_key_set=app_settings.encrypted_assistant_api_key is not None,
        planning_preferences=app_settings.assistant_planning_preferences,
    )


@router.get("/status")
async def assistant_status(request: Request, session: SessionDep) -> AssistantStatus:
    master_key = _require_master_key(request.app.state.settings)
    app_settings = await require_app_settings(session)
    api_key = None
    if app_settings.encrypted_assistant_api_key is not None:
        try:
            api_key = decrypt_credential(app_settings.encrypted_assistant_api_key, key=master_key)
        except ValueError:
            api_key = None
    available = await assistant_available(
        app_settings.assistant_base_url, app_settings.assistant_model, api_key
    )
    return AssistantStatus(available=available)


@router.get("/config")
async def read_assistant_config(session: SessionDep) -> AssistantConfig:
    app_settings = await require_app_settings(session)
    return _config_from(app_settings)


@router.put("/config")
async def update_assistant_config(
    payload: AssistantConfigUpdate, request: Request, session: SessionDep
) -> AssistantConfig:
    master_key = _require_master_key(request.app.state.settings)
    app_settings = await require_app_settings(session)

    if payload.base_url is not None:
        app_settings.assistant_base_url = payload.base_url
    if payload.model is not None:
        app_settings.assistant_model = payload.model
    if payload.api_key is not None:
        app_settings.encrypted_assistant_api_key = encrypt_credential(
            payload.api_key, key=master_key
        )
    if payload.planning_preferences is not None:
        app_settings.assistant_planning_preferences = payload.planning_preferences

    await session.commit()
    return _config_from(app_settings)


@router.delete("/config", status_code=204)
async def remove_assistant_config(session: SessionDep) -> None:
    """Clears every field, returning the Assistant to the same
    unconfigured, invisible state as a fresh deployment (mirrors
    `remove_assist_config` / `remove_google_credentials`)."""
    app_settings = await require_app_settings(session)
    app_settings.assistant_base_url = None
    app_settings.assistant_model = None
    app_settings.encrypted_assistant_api_key = None
    app_settings.assistant_planning_preferences = None
    await session.commit()


class AssistantChatRequest(BaseModel):
    # The whole client-held transcript, per turn (ADR 0009: nothing about
    # the conversation is persisted server-side). Capped further, oldest
    # first, once the system prompt is built — see `build_messages`.
    transcript: list[AssistantChatMessage] = Field(min_length=1, max_length=200)
    local_date: date
    time_zone: str = Field(min_length=1, max_length=64)

    @field_validator("time_zone")
    @classmethod
    def _validate_time_zone(cls, value: str) -> str:
        # A bad IANA name is a client error, not a provider failure — reject
        # it as ordinary validation (422) rather than letting the snapshot
        # builder's unguarded `ZoneInfo(...)` raise a 500 downstream.
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError:
            raise ValueError(f"Unknown IANA timezone {value!r}") from None
        return value


@router.post("/chat")
async def assistant_chat(
    payload: AssistantChatRequest, request: Request, session: SessionDep
) -> AssistantChatTurn:
    """The Assistant's chat turn (ADR 0009; issue #187): builds the week
    snapshot for `local_date`/`time_zone`, asks the configured provider for
    prose plus Suggestions, and validates every Suggestion against that
    same snapshot before it reaches the caller. Never raises: an
    unconfigured or unreachable provider, a timeout, or an unparseable
    response all degrade to an apologetic assistant message with no
    Suggestions.
    """
    settings: Settings = request.app.state.settings
    app_settings = await require_app_settings(session)

    base_url = app_settings.assistant_base_url
    model = app_settings.assistant_model
    if not base_url or not model or app_settings.encrypted_assistant_api_key is None:
        return fallback_turn()

    master_key = _require_master_key(settings)
    try:
        api_key = decrypt_credential(app_settings.encrypted_assistant_api_key, key=master_key)
    except ValueError:
        return fallback_turn()

    snapshot = await build_week_snapshot(
        session,
        settings=settings,
        calendar_source=request.app.state.calendar_source,
        event_cache=request.app.state.event_cache,
        local_date=payload.local_date,
        time_zone=payload.time_zone,
    )
    messages = build_messages(
        app_settings.assistant_planning_preferences, snapshot, payload.transcript
    )
    raw = await request_assistant_turn(base_url, model, api_key, messages)
    if raw is None:
        return fallback_turn()
    return validate_turn(raw, snapshot)
