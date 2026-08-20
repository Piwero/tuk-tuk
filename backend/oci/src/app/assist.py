"""Assist availability (ADR 0005; issue #42), model discovery (issue #42's
Settings UI follow-up), and Assisted Capture's parse step (issue #43). All
three ever read from Ollama and never raise — any failure (unset/blank base
URL, connection refused, timeout, a malformed response) simply degrades to
"unavailable", "no models", or "nothing extracted", so a caller never has
to distinguish "Ollama is down" from "Ollama was never configured".

English and Spanish are equally first-class extraction inputs (ADR 0005,
issue #46): `_EXTRACTION_SYSTEM_PROMPT` asks for phrases verbatim in
whichever language the text itself uses, and the deterministic resolvers it
feeds (app.date_phrase, app.recurrence_phrase, app.reminder_phrase,
app.priority_phrase) each recognize the Spanish equivalents of every English
phrase shape they understand. This is why ADR 0005 constrains the
configured model to multilingual-strong ~14B-class options (e.g.
`qwen3:14b`) rather than an English-only model of similar size — a model
that only extracts well in English would silently degrade ES parses back to
plain capture.
"""

import json
from typing import TypedDict

import httpx


class CaptureExtraction(TypedDict):
    """The shape `parse_capture_extraction` returns on success — every
    field the model is asked for, already type-checked."""

    title: str
    date_phrase: str | None
    recurrence_phrase: str | None
    reminder_phrase: str | None
    list_phrase: str | None
    tag_phrases: list[str]
    priority_phrase: str | None


# Short enough that a hung Ollama doesn't stall the availability check the
# frontend polls on every load and window refocus.
_TIMEOUT_SECONDS = 2.0

# A parse blocks one Quick-Add submission, so it can wait longer than the
# availability probe — but still only a few seconds, per ADR 0005's "Assist
# only ever adds value, never subtracts it": a client-enforced timeout on
# the frontend backs this up independently.
_PARSE_TIMEOUT_SECONDS = 4.0

# Ollama's structured-output mode (ADR 0005: the model extracts intent only,
# never computes a date itself). A null date_phrase means the text has no
# date/time in it at all — distinct from an unparseable phrase, which
# app.date_phrase.resolve_date_phrase discovers on the code side.
_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "date_phrase": {"type": ["string", "null"]},
        "recurrence_phrase": {"type": ["string", "null"]},
        "reminder_phrase": {"type": ["string", "null"]},
        "list_phrase": {"type": ["string", "null"]},
        "tag_phrases": {"type": "array", "items": {"type": "string"}},
        "priority_phrase": {"type": ["string", "null"]},
    },
    "required": [
        "title",
        "date_phrase",
        "recurrence_phrase",
        "reminder_phrase",
        "list_phrase",
        "tag_phrases",
        "priority_phrase",
    ],
}

_EXTRACTION_SYSTEM_PROMPT = (
    "Extract a task title, a date/time phrase, a recurrence phrase, a "
    "reminder phrase, a list name phrase, tag name phrases, and a priority "
    'phrase from the user\'s free text. "title" is the text with any '
    "date/time phrase removed, otherwise the original text unchanged — "
    'every other phrase stays in the title. "date_phrase" is the exact '
    "substring naming a date or time (e.g. 'tomorrow', 'next friday', "
    "'tuesday 3pm'), or null if the text names no date or time. "
    '"recurrence_phrase" is the exact substring naming a repeating schedule '
    "(e.g. 'every month on the 1st', 'weekly'), or null if the text names "
    'none. "reminder_phrase" is the exact substring asking to be reminded '
    "ahead of the task's date (e.g. 'remind me the day before', '1 hour "
    'before\'), or null if the text names none. "list_phrase" is the '
    "exact substring naming the list or folder the task belongs in (e.g. "
    "'errands' from 'in my errands list'), or null if the text names none. "
    '"tag_phrases" is every exact substring naming a tag or label the task '
    "should be filed under (e.g. 'urgent' from 'tag it urgent'), or an "
    'empty list if the text names none. "priority_phrase" is the exact '
    "substring naming how urgent or important the task is (e.g. 'high "
    "priority', 'urgent', 'low'), or null if the text names none. Never "
    "invent a phrase that isn't in the text, and never compute or output "
    "an actual date, RRULE, offset, or decide whether a list/tag/priority "
    "name actually exists — only ever extract what the text itself says. "
    "The text may be in English or Spanish; extract every phrase verbatim "
    "in whichever language it appears in the text — never translate it."
)


async def _installed_model_names(base_url: str) -> list[str] | None:
    """The `name` of every model Ollama reports installed at `base_url`, or
    None if it couldn't be determined (unreachable, non-200, or a response
    shaped unlike Ollama's `/api/tags`)."""
    try:
        async with httpx.AsyncClient(base_url=base_url, timeout=_TIMEOUT_SECONDS) as client:
            response = await client.get("/api/tags")
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    try:
        payload = response.json()
    except ValueError:
        return None
    installed = payload.get("models", [])
    if not isinstance(installed, list):
        return None
    names = [entry.get("name") for entry in installed if isinstance(entry, dict)]
    return [name for name in names if isinstance(name, str)]


async def assist_available(base_url: str | None, model: str | None) -> bool:
    if not base_url or not model:
        return False
    names = await _installed_model_names(base_url)
    return names is not None and model in names


async def list_installed_models(base_url: str | None) -> list[str]:
    """The Settings UI's model dropdown (issue #42 follow-up): every model
    name Ollama reports installed, sorted for a stable dropdown order.
    Empty whenever `base_url` is blank or Ollama can't be reached — the
    frontend falls back to a free-text field rather than showing an error.
    """
    if not base_url:
        return []
    names = await _installed_model_names(base_url)
    return sorted(names) if names is not None else []


async def parse_capture_extraction(
    base_url: str, model: str, text: str
) -> CaptureExtraction | None:
    """Assisted Capture's one-shot extraction (issue #43): asks Ollama's
    `/api/generate` for a strict `{title, date_phrase}` JSON object via
    structured-output mode. Returns None on any failure — unreachable,
    non-200, malformed JSON, or a response shaped unlike the schema asked
    for — so the caller always has a plain-capture fallback to degrade to.

    Deliberately takes no local date or timezone: the model is only ever
    asked to lift the date/time phrase out of the text verbatim, never to
    resolve it, so it has nothing to resolve it against. The caller
    (app.routers.v1.assist.parse_capture) is what has the client's
    local_date/time_zone, and passes them only to
    app.date_phrase.resolve_date_phrase — deterministic code, per ADR 0005.
    """
    payload = {
        "model": model,
        "prompt": text,
        "system": _EXTRACTION_SYSTEM_PROMPT,
        "format": _EXTRACTION_SCHEMA,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(base_url=base_url, timeout=_PARSE_TIMEOUT_SECONDS) as client:
            response = await client.post("/api/generate", json=payload)
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    try:
        body = response.json()
        extracted = json.loads(body["response"])
    except (ValueError, KeyError, TypeError):
        return None
    if not isinstance(extracted, dict):
        return None
    title = extracted.get("title")
    date_phrase = extracted.get("date_phrase")
    recurrence_phrase = extracted.get("recurrence_phrase")
    reminder_phrase = extracted.get("reminder_phrase")
    list_phrase = extracted.get("list_phrase")
    tag_phrases = extracted.get("tag_phrases")
    priority_phrase = extracted.get("priority_phrase")
    if not isinstance(title, str):
        return None
    for field in (date_phrase, recurrence_phrase, reminder_phrase, list_phrase, priority_phrase):
        if field is not None and not isinstance(field, str):
            return None
    if not isinstance(tag_phrases, list) or not all(isinstance(item, str) for item in tag_phrases):
        return None
    return {
        "title": title,
        "date_phrase": date_phrase,
        "recurrence_phrase": recurrence_phrase,
        "reminder_phrase": reminder_phrase,
        "list_phrase": list_phrase,
        "tag_phrases": tag_phrases,
        "priority_phrase": priority_phrase,
    }
