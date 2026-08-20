"""Assist availability (ADR 0005; issue #42): whether Ollama is reachable
and the configured model is installed. Never raises — any failure to reach
Ollama (unset settings, connection refused, timeout, a malformed response)
simply means unavailable, so the caller never has to distinguish "Ollama is
down" from "Ollama was never configured".
"""

import httpx

# Short enough that a hung Ollama doesn't stall the availability check the
# frontend polls on every load and window refocus.
_TIMEOUT_SECONDS = 2.0


async def assist_available(base_url: str | None, model: str | None) -> bool:
    if not base_url or not model:
        return False
    try:
        async with httpx.AsyncClient(base_url=base_url, timeout=_TIMEOUT_SECONDS) as client:
            response = await client.get("/api/tags")
    except httpx.HTTPError:
        return False
    if response.status_code != 200:
        return False
    try:
        payload = response.json()
    except ValueError:
        return False
    installed = payload.get("models", [])
    if not isinstance(installed, list):
        return False
    names = {entry.get("name") for entry in installed if isinstance(entry, dict)}
    return model in names
