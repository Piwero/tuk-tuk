"""The Assistant's provider reachability probe (ADR 0009; issue #185).

Mirrors `app.assist`'s never-raises posture: any failure — unset config,
connection refused, timeout, a non-200 response — simply degrades to
"unavailable" rather than raising, so `assistant_status` never has to
distinguish "the provider is down" from "the Assistant was never
configured".

The Assistant speaks the OpenAI-compatible chat-completions wire format
(ADR 0009) — the same shape cheap OpenAI models, Gemini's compatibility
endpoint, and Ollama all serve. `GET {base_url}/models` is the one
endpoint that shape defines for "is this reachable and authenticated",
without spending a completion (and its cost) just to answer a status
check.
"""

import httpx

# Short enough that a hung or misconfigured provider doesn't stall the
# availability check the frontend polls on every load and window refocus —
# same budget as app.assist's probe.
_TIMEOUT_SECONDS = 2.0


async def assistant_available(base_url: str | None, model: str | None, api_key: str | None) -> bool:
    if not base_url or not model or not api_key:
        return False
    try:
        async with httpx.AsyncClient(base_url=base_url, timeout=_TIMEOUT_SECONDS) as client:
            response = await client.get("/models", headers={"Authorization": f"Bearer {api_key}"})
    except httpx.HTTPError:
        return False
    return response.status_code == 200
