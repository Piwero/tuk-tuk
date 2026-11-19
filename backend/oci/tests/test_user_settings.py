"""Every setting is per user (issue #409, ADR 0018): each user brings their
own Google OAuth client, Assist and Assistant providers, LiveKit project,
section toggles and Active hours, and one user's changes never reach
another's.

Until per-user login lands (issue #410), a test picks the acting user
through the one seam that names them, `app.users.current_user_id`.
"""

import asyncio
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.calendar_source import CalendarListEntry, GoogleOAuthClient
from app.config import Settings
from app.main import create_app
from app.models import User
from app.users import create_user, current_user_id
from tests.conftest import TEST_PASSWORD, FakeCalendarSource, FakeClock, run_sql
from tests.test_assistant_chat import StubChatProvider, _chat
from tests.test_google_accounts import connect_and_authorize
from tests.test_voice_session import start_session, verify_hs256

CLIENT_A = {"client_id": "client-a", "client_secret": "secret-a"}
CLIENT_B = {"client_id": "client-b", "client_secret": "secret-b"}


def add_user(app: FastAPI, username: str) -> int:
    async def _add() -> int:
        async with app.state.session_factory() as session:
            user = await create_user(
                session, User(username=username, email=f"{username}@example.com")
            )
            await session.commit()
            return user.id

    return asyncio.run(_add())


@contextmanager
def acting_as(client: TestClient, user_id: int) -> Iterator[TestClient]:
    app: FastAPI = client.app  # type: ignore[assignment]
    app.dependency_overrides[current_user_id] = lambda: user_id
    try:
        yield client
    finally:
        app.dependency_overrides.pop(current_user_id, None)


@pytest.fixture
def two_users(
    database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
) -> Iterator[tuple[TestClient, int]]:
    """A logged-in client, plus the id of a second user beside user #1."""
    app = create_app(
        Settings(database_url=database_url), clock=fake_clock, calendar_source=fake_calendar_source
    )
    with TestClient(app, follow_redirects=False) as client:
        response = client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})
        assert response.status_code == 204, response.text
        yield client, add_user(app, "ben")


@pytest.fixture
def chat_provider() -> Iterator[StubChatProvider]:
    stub = StubChatProvider()
    yield stub
    stub.stop()


def save_google_credentials(client: TestClient, credentials: dict[str, str]) -> None:
    response = client.put("/api/v1/google/credentials", json=credentials)
    assert response.status_code == 200, response.text


class TestGoogleCredentialsArePerUser:
    def test_each_user_reads_back_only_their_own_credentials(
        self, two_users: tuple[TestClient, int]
    ) -> None:
        client, ben = two_users
        save_google_credentials(client, CLIENT_A)

        with acting_as(client, ben):
            assert client.get("/api/v1/google/status").json()["configured"] is False
            save_google_credentials(client, CLIENT_B)
            assert client.get("/api/v1/google/status").json()["client_id"] == "client-b"

        assert client.get("/api/v1/google/status").json()["client_id"] == "client-a"

    def test_connecting_uses_the_acting_users_oauth_client(
        self, two_users: tuple[TestClient, int], fake_calendar_source: FakeCalendarSource
    ) -> None:
        client, ben = two_users
        save_google_credentials(client, CLIENT_A)
        with acting_as(client, ben):
            save_google_credentials(client, CLIENT_B)

            response = connect_and_authorize(
                client,
                fake_calendar_source,
                code="code-b",
                google_account_id="g-ben",
                email="ben@gmail.com",
                refresh_token="refresh-ben",
            )

        assert response.status_code == 302
        assert "googleConnected=1" in response.headers["location"]
        assert fake_calendar_source.exchanged_with == [GoogleOAuthClient("client-b", "secret-b")]

    def test_another_users_credential_change_leaves_my_account_working(
        self, two_users: tuple[TestClient, int], fake_calendar_source: FakeCalendarSource
    ) -> None:
        """A process-wide OAuth client would make ben's save break user #1's
        next refresh, and flip user #1's account to needs_reconnect."""
        client, ben = two_users
        save_google_credentials(client, CLIENT_A)
        connect_and_authorize(
            client,
            fake_calendar_source,
            code="code-a",
            google_account_id="g-ana",
            email="ana@gmail.com",
            refresh_token="refresh-ana",
        )
        fake_calendar_source.register_calendars(
            "refresh-ana", [CalendarListEntry("primary", "Ana", selected=True)]
        )
        [account] = client.get("/api/v1/google/accounts").json()

        with acting_as(client, ben):
            save_google_credentials(client, CLIENT_B)

        [account] = client.get("/api/v1/google/accounts").json()
        assert account["connection_state"] == "connected"
        response = client.post(f"/api/v1/google/accounts/{account['id']}/calendars/refresh")
        assert response.status_code == 200, response.text
        assert fake_calendar_source.refreshed_with == [GoogleOAuthClient("client-a", "secret-a")]

    def test_another_user_removing_their_credentials_keeps_my_accounts(
        self, two_users: tuple[TestClient, int], fake_calendar_source: FakeCalendarSource
    ) -> None:
        client, ben = two_users
        save_google_credentials(client, CLIENT_A)
        connect_and_authorize(
            client,
            fake_calendar_source,
            code="code-a",
            google_account_id="g-ana",
            email="ana@gmail.com",
            refresh_token="refresh-ana",
        )

        with acting_as(client, ben):
            save_google_credentials(client, CLIENT_B)
            assert client.delete("/api/v1/google/credentials").status_code == 204

        assert client.get("/api/v1/google/status").json()["configured"] is True
        assert [a["email"] for a in client.get("/api/v1/google/accounts").json()] == [
            "ana@gmail.com"
        ]


class TestAssistantSettingsArePerUser:
    def test_each_user_reads_back_only_their_own_config(
        self, two_users: tuple[TestClient, int]
    ) -> None:
        client, ben = two_users
        client.put(
            "/api/v1/assistant/config",
            json={"base_url": "https://a.example.com", "model": "model-a", "api_key": "sk-a"},
        )

        with acting_as(client, ben):
            assert client.get("/api/v1/assistant/config").json()["api_key_set"] is False

        assert client.get("/api/v1/assistant/config").json() == {
            "base_url": "https://a.example.com",
            "model": "model-a",
            "api_key_set": True,
            "planning_preferences": None,
        }

    def test_each_users_chat_reaches_their_own_provider_config(
        self, two_users: tuple[TestClient, int], chat_provider: StubChatProvider
    ) -> None:
        client, ben = two_users
        chat_provider.set_json_content({"message": "Hi", "suggestions": []})
        for user_id, model in ((1, "model-a"), (ben, "model-b")):
            with acting_as(client, user_id):
                client.put(
                    "/api/v1/assistant/config",
                    json={"base_url": chat_provider.base_url, "model": model, "api_key": "sk"},
                )

        with acting_as(client, ben):
            _chat(client)
        _chat(client)

        assert [chat_provider.request_at(i)["model"] for i in range(2)] == ["model-b", "model-a"]


class TestVoiceSettingsArePerUser:
    def test_each_user_starts_sessions_in_their_own_livekit_project(
        self, two_users: tuple[TestClient, int]
    ) -> None:
        client, ben = two_users
        client.put(
            "/api/v1/voice/config",
            json={
                "livekit_url": "wss://a.livekit.cloud",
                "livekit_api_key": "key-a",
                "livekit_api_secret": "secret-a",
            },
        )

        with acting_as(client, ben):
            assert client.post("/api/v1/voice/session").status_code == 404
            client.put(
                "/api/v1/voice/config",
                json={
                    "livekit_url": "wss://b.livekit.cloud",
                    "livekit_api_key": "key-b",
                    "livekit_api_secret": "secret-b",
                },
            )
            bens = start_session(client)

        mine = start_session(client)
        assert mine["url"] == "wss://a.livekit.cloud"
        assert verify_hs256(mine["token"], "secret-a")["iss"] == "key-a"
        assert bens["url"] == "wss://b.livekit.cloud"
        assert verify_hs256(bens["token"], "secret-b")["iss"] == "key-b"


class TestEverythingElseIsPerUser:
    def test_assist_config(self, two_users: tuple[TestClient, int]) -> None:
        client, ben = two_users
        client.put(
            "/api/v1/assist/config",
            json={"ollama_base_url": "http://ollama:11434", "model": "qwen3:14b"},
        )

        with acting_as(client, ben):
            assert client.get("/api/v1/assist/config").json() == {
                "ollama_base_url": None,
                "model": None,
            }

    def test_section_toggles_stand_up_and_active_hours(
        self, two_users: tuple[TestClient, int]
    ) -> None:
        client, ben = two_users
        client.put(
            "/api/v1/settings/sections",
            json={
                "calendar": True,
                "goals": False,
                "habits": True,
                "focus": True,
                "assistant": True,
            },
        )
        client.put("/api/v1/settings/stand-up", json={"enabled": False})
        client.put(
            "/api/v1/settings/active-hours",
            json={"enabled": True, "start": "08:00", "end": "16:00"},
        )

        with acting_as(client, ben):
            assert client.get("/api/v1/settings/sections").json()["goals"] is True
            assert client.get("/api/v1/settings/stand-up").json() == {"enabled": True}
            assert client.get("/api/v1/settings/active-hours").json()["enabled"] is False

        assert client.get("/api/v1/settings/sections").json()["goals"] is False
        assert client.get("/api/v1/settings/stand-up").json() == {"enabled": False}
        assert client.get("/api/v1/settings/active-hours").json()["start"] == "08:00"


class TestCreatingAUser:
    def test_creates_their_settings_and_inbox_with_them(
        self, two_users: tuple[TestClient, int], database_url: str
    ) -> None:
        _client, ben = two_users

        assert run_sql(database_url, "SELECT user_id FROM user_settings ORDER BY 1") == [
            (1,),
            (ben,),
        ]
        assert run_sql(
            database_url, "SELECT owner_id, name FROM lists WHERE is_inbox ORDER BY 1"
        ) == [(1, "Inbox"), (ben, "Inbox")]

    def test_a_fresh_install_boots_with_user_1s_settings_and_inbox(
        self, client: TestClient, database_url: str
    ) -> None:
        assert run_sql(database_url, "SELECT user_id FROM user_settings") == [(1,)]
        assert run_sql(database_url, "SELECT owner_id FROM lists WHERE is_inbox") == [(1,)]
