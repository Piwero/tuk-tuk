"""Connecting and disconnecting Google accounts (issue #105).

The whole OAuth roundtrip is driven exactly as a browser would: GET
/connect for the redirect to Google, then GET /callback with the code and
state carried in that redirect's query string — no test reaches into the
router's internals to fabricate a state token.
"""

import sqlite3
import time as time_module
from collections.abc import Iterator
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import TEST_PASSWORD, FakeCalendarSource, FakeClock


def make_client(
    database_url: str,
    fake_clock: FakeClock,
    fake_calendar_source: FakeCalendarSource,
    **overrides: object,
) -> TestClient:
    app = create_app(
        Settings(database_url=database_url, **overrides),  # type: ignore[arg-type]
        clock=fake_clock,
        calendar_source=fake_calendar_source,
    )
    test_client = TestClient(app, follow_redirects=False)
    response = test_client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})
    assert response.status_code == 204, response.text
    return test_client


@pytest.fixture
def configured_client(
    database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
) -> Iterator[TestClient]:
    with make_client(
        database_url,
        fake_clock,
        fake_calendar_source,
        google_client_id="a-client-id",
        google_client_secret="a-client-secret",
        google_encryption_key="a-dedicated-key",
        cors_origins=["http://localhost:5900"],
    ) as test_client:
        yield test_client


@pytest.fixture
def unconfigured_client(
    database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
) -> Iterator[TestClient]:
    with make_client(database_url, fake_clock, fake_calendar_source) as test_client:
        yield test_client


def state_from_connect_redirect(response: httpx.Response) -> tuple[str, str]:
    """Follows a /connect response's Location and returns (state, redirect_uri)."""
    location = response.headers["location"]
    params = parse_qs(urlparse(location).query)
    return params["state"][0], params["redirect_uri"][0]


def connect_and_authorize(
    client: TestClient,
    calendar_source: FakeCalendarSource,
    *,
    code: str,
    google_account_id: str,
    email: str,
    refresh_token: str,
) -> httpx.Response:
    connect_response = client.get("/api/v1/google/connect")
    assert connect_response.status_code == 302
    state, _redirect_uri = state_from_connect_redirect(connect_response)
    calendar_source.register_code(
        code, google_account_id=google_account_id, email=email, refresh_token=refresh_token
    )
    callback_response: httpx.Response = client.get(
        "/api/v1/google/callback", params={"code": code, "state": state}
    )
    return callback_response


class TestConnect:
    def test_redirects_to_googles_consent_screen(self, configured_client: TestClient) -> None:
        response = configured_client.get("/api/v1/google/connect")

        assert response.status_code == 302
        location = response.headers["location"]
        assert location.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
        params = parse_qs(urlparse(location).query)
        assert params["client_id"] == ["a-client-id"]
        assert params["response_type"] == ["code"]
        assert "state" in params

    def test_never_includes_the_client_secret(self, configured_client: TestClient) -> None:
        response = configured_client.get("/api/v1/google/connect")

        assert "a-client-secret" not in response.headers["location"]

    def test_is_not_found_when_unconfigured(self, unconfigured_client: TestClient) -> None:
        response = unconfigured_client.get("/api/v1/google/connect")

        assert response.status_code == 404

    def test_is_rejected_without_a_session(self, database_url: str, fake_clock: FakeClock) -> None:
        app = create_app(Settings(database_url=database_url), clock=fake_clock)
        with TestClient(app, follow_redirects=False) as client:
            response = client.get("/api/v1/google/connect")

        assert response.status_code == 401


class TestCallback:
    def test_a_successful_exchange_lists_the_account_by_email(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        callback_response = connect_and_authorize(
            configured_client,
            fake_calendar_source,
            code="auth-code-1",
            google_account_id="google-1",
            email="me@example.com",
            refresh_token="rt-1",
        )

        assert callback_response.status_code == 302

        accounts = configured_client.get("/api/v1/google/accounts").json()
        assert [account["email"] for account in accounts] == ["me@example.com"]

    def test_redirects_back_to_the_originating_frontend_origin(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        callback_response = connect_and_authorize(
            configured_client,
            fake_calendar_source,
            code="auth-code-1",
            google_account_id="google-1",
            email="me@example.com",
            refresh_token="rt-1",
        )

        assert callback_response.headers["location"].startswith("http://localhost:5900")

    def test_several_accounts_can_be_connected_and_all_are_listed(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        connect_and_authorize(
            configured_client,
            fake_calendar_source,
            code="auth-code-1",
            google_account_id="google-1",
            email="one@example.com",
            refresh_token="rt-1",
        )
        connect_and_authorize(
            configured_client,
            fake_calendar_source,
            code="auth-code-2",
            google_account_id="google-2",
            email="two@example.com",
            refresh_token="rt-2",
        )

        accounts = configured_client.get("/api/v1/google/accounts").json()
        assert sorted(account["email"] for account in accounts) == [
            "one@example.com",
            "two@example.com",
        ]

    def test_reconnecting_the_same_account_updates_rather_than_duplicates(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        connect_and_authorize(
            configured_client,
            fake_calendar_source,
            code="auth-code-1",
            google_account_id="google-1",
            email="old@example.com",
            refresh_token="rt-1",
        )
        connect_and_authorize(
            configured_client,
            fake_calendar_source,
            code="auth-code-2",
            google_account_id="google-1",
            email="new@example.com",
            refresh_token="rt-2",
        )

        accounts = configured_client.get("/api/v1/google/accounts").json()
        assert [account["email"] for account in accounts] == ["new@example.com"]

    def test_an_unrecognized_code_does_not_create_an_account(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        connect_response = configured_client.get("/api/v1/google/connect")
        state, _ = state_from_connect_redirect(connect_response)

        callback_response = configured_client.get(
            "/api/v1/google/callback", params={"code": "never-registered", "state": state}
        )

        assert callback_response.status_code == 302
        assert configured_client.get("/api/v1/google/accounts").json() == []

    def test_a_tampered_state_is_rejected(self, configured_client: TestClient) -> None:
        response = configured_client.get(
            "/api/v1/google/callback", params={"code": "some-code", "state": "not-a-real-state"}
        )

        assert response.status_code == 400

    def test_an_expired_state_is_rejected(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A captured state token isn't valid indefinitely — see
        _STATE_MAX_AGE_SECONDS in app.routers.v1.google."""
        real_time = time_module.time
        monkeypatch.setattr(time_module, "time", lambda: real_time() - 700)
        connect_response = configured_client.get("/api/v1/google/connect")
        state, _ = state_from_connect_redirect(connect_response)
        monkeypatch.undo()

        response = configured_client.get(
            "/api/v1/google/callback", params={"code": "some-code", "state": state}
        )

        assert response.status_code == 400

    def test_is_not_found_when_unconfigured(self, unconfigured_client: TestClient) -> None:
        response = unconfigured_client.get(
            "/api/v1/google/callback", params={"code": "x", "state": "y"}
        )

        assert response.status_code == 404


class TestAccountsAndDisconnect:
    def test_disconnecting_removes_the_account_from_the_list(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        connect_and_authorize(
            configured_client,
            fake_calendar_source,
            code="auth-code-1",
            google_account_id="google-1",
            email="me@example.com",
            refresh_token="rt-1",
        )
        account_id = configured_client.get("/api/v1/google/accounts").json()[0]["id"]

        delete_response = configured_client.delete(f"/api/v1/google/accounts/{account_id}")

        assert delete_response.status_code == 204
        assert configured_client.get("/api/v1/google/accounts").json() == []

    def test_disconnecting_destroys_the_stored_credential(
        self,
        configured_client: TestClient,
        fake_calendar_source: FakeCalendarSource,
        database_url: str,
    ) -> None:
        connect_and_authorize(
            configured_client,
            fake_calendar_source,
            code="auth-code-1",
            google_account_id="google-1",
            email="me@example.com",
            refresh_token="rt-1",
        )
        account_id = configured_client.get("/api/v1/google/accounts").json()[0]["id"]

        configured_client.delete(f"/api/v1/google/accounts/{account_id}")

        db_path = database_url.removeprefix("sqlite+aiosqlite:///")
        rows = sqlite3.connect(db_path).execute("SELECT * FROM google_accounts").fetchall()
        assert rows == []

    def test_disconnecting_an_unknown_account_is_a_404(self, configured_client: TestClient) -> None:
        response = configured_client.delete("/api/v1/google/accounts/999")

        assert response.status_code == 404

    def test_accounts_never_expose_the_stored_credential(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        connect_and_authorize(
            configured_client,
            fake_calendar_source,
            code="auth-code-1",
            google_account_id="google-1",
            email="me@example.com",
            refresh_token="a-very-secret-refresh-token",
        )

        response = configured_client.get("/api/v1/google/accounts")

        assert "a-very-secret-refresh-token" not in response.text

    def test_the_stored_credential_is_encrypted_at_rest(
        self,
        configured_client: TestClient,
        fake_calendar_source: FakeCalendarSource,
        database_url: str,
    ) -> None:
        connect_and_authorize(
            configured_client,
            fake_calendar_source,
            code="auth-code-1",
            google_account_id="google-1",
            email="me@example.com",
            refresh_token="a-very-secret-refresh-token",
        )

        db_path = database_url.removeprefix("sqlite+aiosqlite:///")
        row = (
            sqlite3.connect(db_path)
            .execute("SELECT encrypted_refresh_token FROM google_accounts")
            .fetchone()
        )
        assert "a-very-secret-refresh-token" not in row[0]

    def test_is_not_found_when_unconfigured(self, unconfigured_client: TestClient) -> None:
        assert unconfigured_client.get("/api/v1/google/accounts").status_code == 404
        assert unconfigured_client.delete("/api/v1/google/accounts/1").status_code == 404


class TestCredentialSurvivesSecretKeyRotation:
    def test_rotating_the_session_signing_key_leaves_the_account_working(
        self,
        database_url: str,
        fake_clock: FakeClock,
        fake_calendar_source: FakeCalendarSource,
    ) -> None:
        with make_client(
            database_url,
            fake_clock,
            fake_calendar_source,
            google_client_id="a-client-id",
            google_client_secret="a-client-secret",
            google_encryption_key="a-dedicated-key",
            secret_key="original-signing-key",
        ) as client:
            connect_and_authorize(
                client,
                fake_calendar_source,
                code="auth-code-1",
                google_account_id="google-1",
                email="me@example.com",
                refresh_token="rt-1",
            )

        # A fresh app, as if the signing key were rotated (the "log every
        # device out" lever) — same database, same encryption key.
        with make_client(
            database_url,
            fake_clock,
            FakeCalendarSource(),
            google_client_id="a-client-id",
            google_client_secret="a-client-secret",
            google_encryption_key="a-dedicated-key",
            secret_key="rotated-signing-key",
        ) as rotated_client:
            accounts = rotated_client.get("/api/v1/google/accounts").json()

        assert [account["email"] for account in accounts] == ["me@example.com"]
