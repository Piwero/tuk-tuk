"""`POST /api/v1/voice/session` (ADR 0015; issue #367): mints a LiveKit
access token for a fresh room, with the agent dispatched from inside the
token. Tokens are verified here by hand (stdlib HMAC) so the test is
independent of the minting code and needs no JWT library either.
"""

import base64
import hashlib
import hmac
import json
from typing import Any

from fastapi.testclient import TestClient

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
