"""Assist configuration and availability probe (ADR 0005; issue #42, and
this Settings UI slice). The Ollama base URL and model name are DB-backed
settings (ADR 0008's UI-managed pattern, mirroring google.py) — an operator
sets them from Settings rather than editing `.env` and restarting. Neither
value is a credential, so unlike the Google client secret, both are stored
and returned in plain text.

The status probe is the foundation every Assist feature rides on: the
frontend polls it on load and on window refocus and renders no AI
affordance anywhere until it reports available: true. Settings' "Test"
button calls the same endpoint to confirm a saved configuration actually
reaches Ollama and finds the model installed.
"""

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field, field_validator

from app.app_settings import require_app_settings
from app.assist import assist_available, list_installed_models
from app.db import SessionDep
from app.models import AppSettings
from app.schemas import reject_explicit_null

router = APIRouter(prefix="/api/v1/assist", tags=["assist"])


class AssistStatus(BaseModel):
    available: bool


class AssistConfig(BaseModel):
    ollama_base_url: str | None
    model: str | None


class AssistModels(BaseModel):
    models: list[str]


# PATCH-style fields: absent means "leave unchanged" (reject_explicit_null),
# same convention as GoogleCalendarUpdate. Unlike Google's client_secret,
# neither field here is write-only — Settings can always show what's
# currently saved, since neither value is sensitive.
class AssistConfigUpdate(BaseModel):
    ollama_base_url: str | None = Field(default=None, min_length=1, max_length=255)
    model: str | None = Field(default=None, min_length=1, max_length=255)

    _reject_nulls = field_validator("ollama_base_url", "model")(reject_explicit_null)


def _config_from(app_settings: AppSettings) -> AssistConfig:
    return AssistConfig(
        ollama_base_url=app_settings.assist_ollama_base_url,
        model=app_settings.assist_model,
    )


@router.get("/status")
async def assist_status(session: SessionDep) -> AssistStatus:
    app_settings = await require_app_settings(session)
    available = await assist_available(
        app_settings.assist_ollama_base_url, app_settings.assist_model
    )
    return AssistStatus(available=available)


@router.get("/config")
async def read_assist_config(session: SessionDep) -> AssistConfig:
    app_settings = await require_app_settings(session)
    return _config_from(app_settings)


@router.get("/models")
async def read_assist_models(
    session: SessionDep, base_url: str | None = Query(default=None)
) -> AssistModels:
    """Powers Settings' model dropdown: every model Ollama reports
    installed at `base_url`, so an operator picks from what's actually
    there instead of typing a name from memory. `base_url` is a query
    param, not the saved setting, so the dropdown can query a URL the
    operator just typed but hasn't saved yet; omitting it falls back to
    whatever's currently saved (e.g. a page refresh with fields already
    filled in). Never errors — an unreachable or blank base URL just
    answers an empty list, same posture as `/status`.
    """
    if base_url is None:
        app_settings = await require_app_settings(session)
        base_url = app_settings.assist_ollama_base_url
    return AssistModels(models=await list_installed_models(base_url))


@router.put("/config")
async def update_assist_config(payload: AssistConfigUpdate, session: SessionDep) -> AssistConfig:
    app_settings = await require_app_settings(session)
    if payload.ollama_base_url is not None:
        app_settings.assist_ollama_base_url = payload.ollama_base_url
    if payload.model is not None:
        app_settings.assist_model = payload.model
    await session.commit()
    return _config_from(app_settings)


@router.delete("/config", status_code=204)
async def remove_assist_config(session: SessionDep) -> None:
    """Clears both settings, returning Assist to the same unconfigured,
    invisible state as a fresh deployment (mirrors Google's credential
    removal)."""
    app_settings = await require_app_settings(session)
    app_settings.assist_ollama_base_url = None
    app_settings.assist_model = None
    await session.commit()
