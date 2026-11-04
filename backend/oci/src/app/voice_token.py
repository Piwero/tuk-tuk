"""LiveKit access tokens for the Voice Assistant (ADR 0015; issue #367).

A LiveKit access token is a plain HS256 JWT signed with the project's API
secret, so the stdlib is enough and the backend takes no new dependency.
Claim names follow LiveKit's "Access tokens & grants" docs: `iss` is the API
key, `sub` the participant identity, `video` the room grant. The agent is
dispatched from inside the token (`roomConfig.agents`), which LiveKit applies
when the room is first created — so no server API call, and no SDK, is needed.

ponytail: hand-rolled for one token shape. If we ever need other grants, egress
or server-API calls (RoomService, explicit dispatch), switch to `livekit-api`.
"""

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

# The name the deployed voice agent registers under. `voice-agent/` has to use
# the same plain string (no shared code across the two, by design — see docs
# note in docs/self-hosting/voice.md); change both together.
AGENT_NAME = "tuktuk-voice"

TOKEN_TTL_SECONDS = 600


def new_room_name() -> str:
    return f"tuktuk-{secrets.token_urlsafe(12)}"


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _segment(data: dict[str, Any]) -> str:
    return _b64(json.dumps(data, separators=(",", ":")).encode())


def mint_token(*, api_key: str, api_secret: str, room: str) -> str:
    """A join token for `room` only, valid ~10 minutes, that also asks
    LiveKit to start the voice agent in that room. The identity is opaque
    and random (LiveKit logs identities; never put PII in it)."""
    now = int(time.time())
    claims = {
        "iss": api_key,
        "sub": f"tuktuk-{secrets.token_urlsafe(8)}",
        "nbf": now,
        "exp": now + TOKEN_TTL_SECONDS,
        "video": {
            "room": room,
            "roomJoin": True,
            "canPublish": True,
            "canSubscribe": True,
            "canPublishData": True,
        },
        "roomConfig": {"agents": [{"agentName": AGENT_NAME}]},
    }
    signing_input = f"{_segment({'alg': 'HS256', 'typ': 'JWT'})}.{_segment(claims)}"
    signature = hmac.new(api_secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{_b64(signature)}"
