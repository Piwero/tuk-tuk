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

import re
from collections.abc import Callable
from datetime import date, datetime

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field, field_validator

from app.app_settings import require_app_settings
from app.assist import assist_available, list_installed_models, parse_capture_extraction
from app.date_phrase import resolve_date_phrase
from app.db import SessionDep
from app.models import AppSettings
from app.recurrence_phrase import resolve_recurrence_phrase
from app.reminder_phrase import resolve_reminder_phrase
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


class ParseCaptureRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    # The caller's own local day and IANA timezone — the date phrase (e.g.
    # "tuesday 3pm") is meaningless without them, and resolving it is always
    # done here in code, never by the model (ADR 0005).
    local_date: date
    time_zone: str = Field(min_length=1, max_length=64)


class ParseCaptureDraft(BaseModel):
    title: str
    due_date: datetime | None
    is_all_day: bool
    # Set alongside a non-null due_date so the frontend's confirm step can
    # create the Task with the same timezone it was resolved against; null
    # whenever due_date is, including every fallback path.
    time_zone: str | None
    # RRULE content (app.recurrence) and reminder offsets (app.models.Task.
    # reminders), resolved from recurrence_phrase/reminder_phrase (issue
    # #44). Both require a resolved due_date to attach to — a Task without a
    # date can't recur or hold reminders (app.recurrence, app.schemas) — so
    # neither is ever set alongside a null due_date.
    recurrence: str | None
    reminders: list[str]


def _strip_phrase(title: str, phrase: str) -> str:
    """Removes the first case-insensitive occurrence of `phrase` from
    `title` and collapses the whitespace left behind; a phrase the model
    claimed was in the title but isn't leaves the title unchanged."""
    stripped = re.sub(re.escape(phrase), "", title, count=1, flags=re.IGNORECASE)
    return " ".join(stripped.split())


def _resolve_and_strip(
    phrase: str | None, resolver: Callable[[str], str | None], title: str
) -> tuple[str | None, str]:
    """The shared shape behind resolving a recurrence/reminder phrase: only
    a phrase that both exists and resolves gets stripped out of the title —
    an unresolvable one leaves its words in place rather than blocking the
    draft. Returns (resolved value or None, possibly-stripped title)."""
    if not phrase:
        return None, title
    resolved = resolver(phrase)
    if resolved is None:
        return None, title
    return resolved, _strip_phrase(title, phrase)


@router.post("/parse-capture")
async def parse_capture(payload: ParseCaptureRequest, session: SessionDep) -> ParseCaptureDraft:
    """Assisted Capture's parse step (ADR 0005; issues #43, #44): one
    stateless extraction plus deterministic date, recurrence, and reminder
    resolution, for Quick-Add's single confirmation beat. Assist only ever
    adds value, never subtracts it — an unconfigured or unreachable Ollama,
    a parse failure, an empty extraction, an empty residual title, or an
    unresolvable phrase all degrade towards the text exactly as typed, with
    no error. Recurrence and reminder phrases are only ever resolved
    against a Task that also has a resolved date (a dateless Task can't
    recur or hold reminders); an unresolvable phrase of either kind simply
    leaves its words in the title rather than blocking the draft.
    """
    app_settings = await require_app_settings(session)
    base_url = app_settings.assist_ollama_base_url
    model = app_settings.assist_model
    plain_capture = ParseCaptureDraft(
        title=payload.text,
        due_date=None,
        is_all_day=False,
        time_zone=None,
        recurrence=None,
        reminders=[],
    )
    if not base_url or not model:
        return plain_capture

    extraction = await parse_capture_extraction(base_url, model, payload.text)
    if extraction is None:
        return plain_capture

    title = (extraction["title"] or "").strip() or payload.text
    date_phrase = extraction["date_phrase"]
    resolved = (
        resolve_date_phrase(date_phrase, payload.local_date, payload.time_zone)
        if date_phrase
        else None
    )
    if resolved is None:
        return ParseCaptureDraft(
            title=title,
            due_date=None,
            is_all_day=False,
            time_zone=None,
            recurrence=None,
            reminders=[],
        )
    due_date, is_all_day = resolved

    recurrence, title = _resolve_and_strip(
        extraction["recurrence_phrase"], resolve_recurrence_phrase, title
    )

    reminder, title = _resolve_and_strip(
        extraction["reminder_phrase"], resolve_reminder_phrase, title
    )
    reminders = [] if reminder is None else [reminder]

    return ParseCaptureDraft(
        title=title,
        due_date=due_date,
        is_all_day=is_all_day,
        time_zone=payload.time_zone,
        recurrence=recurrence,
        reminders=reminders,
    )
