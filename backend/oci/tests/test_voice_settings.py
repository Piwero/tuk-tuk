"""The Voice Assistant's LiveKit settings (ADR 0015; issue #366): URL, API
key and a write-only API secret, mirroring the Assistant/Google credential
tests — round-trip, ciphertext-only at rest, never echoed, omitted keeps.
"""

import sqlite3

from fastapi.testclient import TestClient

from app.crypto import decrypt_credential

URL = "wss://tuktuk-abc123.livekit.cloud"
PAYLOAD = {
    "livekit_url": URL,
    "livekit_api_key": "APIkey123",
    "livekit_api_secret": "a-very-secret-value",
}


def stored_secret(database_url: str) -> str | None:
    db_path = database_url.removeprefix("sqlite+aiosqlite:///")
    row = (
        sqlite3.connect(db_path)
        .execute("SELECT encrypted_voice_livekit_api_secret FROM settings")
        .fetchone()
    )
    return row[0] if row else None


def test_fresh_install_is_unconfigured(client: TestClient) -> None:
    response = client.get("/api/v1/voice/config")

    assert response.status_code == 200
    assert response.json() == {
        "livekit_url": None,
        "livekit_api_key": None,
        "livekit_api_secret_set": False,
        "configured": False,
    }


def test_save_round_trips_and_flips_configured(client: TestClient) -> None:
    response = client.put("/api/v1/voice/config", json=PAYLOAD)

    expected = {
        "livekit_url": URL,
        "livekit_api_key": "APIkey123",
        "livekit_api_secret_set": True,
        "configured": True,
    }
    assert response.status_code == 200
    assert response.json() == expected
    # Takes effect on the very next read — no restart, nothing cached.
    assert client.get("/api/v1/voice/config").json() == expected


def test_secret_is_ciphertext_at_rest_and_never_in_a_response(
    client: TestClient, database_url: str
) -> None:
    put = client.put("/api/v1/voice/config", json=PAYLOAD)
    get = client.get("/api/v1/voice/config")

    encrypted = stored_secret(database_url)
    assert encrypted is not None
    assert "a-very-secret-value" not in encrypted
    assert decrypt_credential(encrypted, key="test-master-key") == "a-very-secret-value"
    assert "a-very-secret-value" not in put.text
    assert "a-very-secret-value" not in get.text


def test_omitted_secret_keeps_the_stored_one(client: TestClient, database_url: str) -> None:
    client.put("/api/v1/voice/config", json=PAYLOAD)
    before = stored_secret(database_url)

    response = client.put(
        "/api/v1/voice/config",
        json={"livekit_url": "wss://other.livekit.cloud", "livekit_api_key": "newkey"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "livekit_url": "wss://other.livekit.cloud",
        "livekit_api_key": "newkey",
        "livekit_api_secret_set": True,
        "configured": True,
    }
    assert stored_secret(database_url) == before


def test_first_save_without_a_secret_is_rejected(client: TestClient) -> None:
    response = client.put(
        "/api/v1/voice/config", json={"livekit_url": URL, "livekit_api_key": "APIkey123"}
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "livekit_secret_required"
    assert client.get("/api/v1/voice/config").json()["configured"] is False


def test_delete_returns_to_unconfigured(client: TestClient, database_url: str) -> None:
    client.put("/api/v1/voice/config", json=PAYLOAD)

    assert client.delete("/api/v1/voice/config").status_code == 204

    assert client.get("/api/v1/voice/config").json() == {
        "livekit_url": None,
        "livekit_api_key": None,
        "livekit_api_secret_set": False,
        "configured": False,
    }
    assert stored_secret(database_url) is None


def test_every_route_requires_a_session(unauthenticated_client: TestClient) -> None:
    assert unauthenticated_client.get("/api/v1/voice/config").status_code == 401
    assert unauthenticated_client.put("/api/v1/voice/config", json=PAYLOAD).status_code == 401
    assert unauthenticated_client.delete("/api/v1/voice/config").status_code == 401
