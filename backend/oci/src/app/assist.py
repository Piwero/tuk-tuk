"""Assist availability (ADR 0005; issue #42), model discovery (issue #42's
Settings UI follow-up), and Assisted Capture's parse step (issue #43). All
three ever read from Ollama and never raise — any failure (unset/blank base
URL, connection refused, timeout, a malformed response) simply degrades to
"unavailable", "no models", or "nothing extracted", so a caller never has
to distinguish "Ollama is down" from "Ollama was never configured".
"""

import json

import httpx

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
    },
    "required": ["title", "date_phrase"],
}

_EXTRACTION_SYSTEM_PROMPT = (
    "Extract a task title and a date/time phrase from the user's free text. "
    '"title" is the text with any date/time phrase removed, otherwise the '
    'original text unchanged. "date_phrase" is the exact substring naming a '
    "date or time (e.g. 'tomorrow', 'next friday', 'tuesday 3pm'), or null "
    "if the text names no date or time. Never invent a date_phrase that "
    "isn't in the text, and never compute or output an actual date."
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
) -> dict[str, str | None] | None:
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
    if not isinstance(title, str):
        return None
    if date_phrase is not None and not isinstance(date_phrase, str):
        return None
    return {"title": title, "date_phrase": date_phrase}
