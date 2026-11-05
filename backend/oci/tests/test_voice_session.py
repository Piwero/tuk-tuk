"""`POST /api/v1/voice/session` (ADR 0015; issue #367): mints a LiveKit
access token for a fresh room, with the agent dispatched from inside the
token. Tokens are verified here by hand (stdlib HMAC) so the test is
independent of the minting code and needs no JWT library either.
"""

import base64
import hashlib
import hmac
import json
import re
import sqlite3
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.crypto import encrypt_credential
from app.voice_livekit import AGENT_NAME

URL = "wss://tuktuk-abc123.livekit.cloud"
KEY = "APIkey123"
SECRET = "a-very-secret-value"
PAYLOAD = {"livekit_url": URL, "livekit_api_key": KEY, "livekit_api_secret": SECRET}


def _b64(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def verify_hs256(token: str, secret: str) -> dict[str, Any]:
    header, payload, signature = token.split(".")
    assert json.loads(_b64(header)) == {"alg": "HS256", "typ": "JWT"}
    expected = hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    assert hmac.compare_digest(expected, _b64(signature))
    claims: dict[str, Any] = json.loads(_b64(payload))
    return claims


def start_session(client: TestClient) -> dict[str, str]:
    response = client.post("/api/v1/voice/session")
    assert response.status_code == 200
    body: dict[str, str] = response.json()
    return body


def test_requires_a_session(unauthenticated_client: TestClient) -> None:
    assert unauthenticated_client.post("/api/v1/voice/session").status_code == 401


def test_unconfigured_reports_voice_unavailable(client: TestClient) -> None:
    response = client.post("/api/v1/voice/session")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "voice_unavailable"


def test_returns_url_room_and_a_token_signed_with_the_stored_secret(client: TestClient) -> None:
    client.put("/api/v1/voice/config", json=PAYLOAD)

    body = start_session(client)

    assert set(body) == {"url", "token", "room"}
    assert body["url"] == URL
    assert body["room"].startswith("tuktuk-")
    claims = verify_hs256(body["token"], SECRET)
    assert claims["iss"] == KEY
    assert claims["sub"]


def test_token_grants_only_the_returned_room(client: TestClient) -> None:
    client.put("/api/v1/voice/config", json=PAYLOAD)

    body = start_session(client)

    video = verify_hs256(body["token"], SECRET)["video"]
    assert video == {
        "room": body["room"],
        "roomJoin": True,
        "canPublish": True,
        "canSubscribe": True,
        "canPublishData": True,
    }


def test_token_lives_about_ten_minutes(client: TestClient) -> None:
    client.put("/api/v1/voice/config", json=PAYLOAD)

    claims = verify_hs256(start_session(client)["token"], SECRET)

    assert claims["exp"] - claims["nbf"] == 600


def test_token_dispatches_the_voice_agent_into_the_room(client: TestClient) -> None:
    client.put("/api/v1/voice/config", json=PAYLOAD)

    claims = verify_hs256(start_session(client)["token"], SECRET)

    assert claims["roomConfig"] == {"agents": [{"agentName": "tuktuk-voice"}]}


def test_two_calls_get_different_rooms(client: TestClient) -> None:
    client.put("/api/v1/voice/config", json=PAYLOAD)

    assert start_session(client)["room"] != start_session(client)["room"]


def test_new_secret_signs_the_next_token(client: TestClient) -> None:
    client.put("/api/v1/voice/config", json=PAYLOAD)
    client.put("/api/v1/voice/config", json={"livekit_api_secret": "rotated-secret"})

    verify_hs256(start_session(client)["token"], "rotated-secret")


def test_deleted_config_makes_the_next_session_unavailable(client: TestClient) -> None:
    client.put("/api/v1/voice/config", json=PAYLOAD)
    start_session(client)

    client.delete("/api/v1/voice/config")

    assert client.post("/api/v1/voice/session").status_code == 404


def test_credentials_saved_by_an_earlier_version_still_start_sessions(
    client: TestClient, database_url: str
) -> None:
    # An upgraded install: the three columns were written before this refactor.
    db = sqlite3.connect(database_url.removeprefix("sqlite+aiosqlite:///"))
    db.execute(
        "UPDATE settings SET voice_livekit_url = ?, voice_livekit_api_key = ?,"
        " encrypted_voice_livekit_api_secret = ?",
        (URL, KEY, encrypt_credential(SECRET, key="test-master-key")),
    )
    db.commit()
    db.close()

    body = start_session(client)

    assert body["url"] == URL
    assert verify_hs256(body["token"], SECRET)["iss"] == KEY


def test_dispatch_name_matches_the_separately_deployed_agent() -> None:
    # No shared code by design (ADR 0015): read the agent's source as text.
    config = Path(__file__).parents[3] / "voice-agent/src/tuk_voice_agent/config.py"
    if not config.exists():  # backend image / checkout without voice-agent/
        pytest.skip("voice-agent/ not present")
    match = re.search(r'^AGENT_NAME = "([^"]+)"', config.read_text(), re.MULTILINE)
    assert match is not None
    assert match.group(1) == AGENT_NAME
