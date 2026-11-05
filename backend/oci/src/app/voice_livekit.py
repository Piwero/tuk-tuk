"""The LiveKit adapter for the Voice Assistant (ADR 0015; issues #367, #391):
credential storage on `AppSettings`, token minting and agent dispatch. The
router only calls `is_configured`, `read_config`, `apply_update`, `clear` and
`create_session` and knows nothing of tokens or the `voice_livekit_*` columns (kept as-is, so
installs upgrade without a migration).

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

from app.app_settings import voice_configured as is_configured
from app.crypto import decrypt_credential, encrypt_credential
from app.models import AppSettings

__all__ = [
    "AGENT_NAME",
    "apply_update",
    "clear",
    "create_session",
    "is_configured",
    "mint_token",
    "read_config",
]

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


def read_config(app_settings: AppSettings) -> dict[str, Any]:
    """The `/voice/config` fields; the secret is only reported as set or not."""
    return {
        "livekit_url": app_settings.voice_livekit_url,
        "livekit_api_key": app_settings.voice_livekit_api_key,
        "livekit_api_secret_set": app_settings.encrypted_voice_livekit_api_secret is not None,
        "configured": is_configured(app_settings),
    }


def apply_update(
    app_settings: AppSettings,
    *,
    master_key: str,
    url: str | None,
    api_key: str | None,
    api_secret: str | None,
) -> None:
    """PATCH-style: `None` leaves a field unchanged. The secret is stored
    encrypted under `APP_MASTER_KEY` (ADR 0008)."""
    if url is not None:
        app_settings.voice_livekit_url = url
    if api_key is not None:
        app_settings.voice_livekit_api_key = api_key
    if api_secret is not None:
        app_settings.encrypted_voice_livekit_api_secret = encrypt_credential(
            api_secret, key=master_key
        )


def clear(app_settings: AppSettings) -> None:
    app_settings.voice_livekit_url = None
    app_settings.voice_livekit_api_key = None
    app_settings.encrypted_voice_livekit_api_secret = None


def create_session(app_settings: AppSettings, *, master_key: str) -> dict[str, str]:
    """`{url, token, room}` for a fresh room; the caller checks `is_configured`."""
    assert app_settings.voice_livekit_url is not None
    assert app_settings.voice_livekit_api_key is not None
    assert app_settings.encrypted_voice_livekit_api_secret is not None
    room = new_room_name()
    token = mint_token(
        api_key=app_settings.voice_livekit_api_key,
        api_secret=decrypt_credential(
            app_settings.encrypted_voice_livekit_api_secret, key=master_key
        ),
        room=room,
    )
    return {"url": app_settings.voice_livekit_url, "token": token, "room": room}
