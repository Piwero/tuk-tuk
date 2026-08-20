"""Assist availability (ADR 0005; issue #42) and model discovery (issue
#42's Settings UI follow-up): both read Ollama's `/api/tags`. Neither ever
raises — any failure to reach Ollama (unset/blank base URL, connection
refused, timeout, a malformed response) simply means "unavailable" or "no
models", so the caller never has to distinguish "Ollama is down" from
"Ollama was never configured".
"""

import httpx

# Short enough that a hung Ollama doesn't stall the availability check the
# frontend polls on every load and window refocus.
_TIMEOUT_SECONDS = 2.0


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
