"""Editing Google OAuth client credentials from Settings (issue #117): the
credentials form's read/write endpoints, the write-only secret, flipping
connected accounts to "needs_reconnect" on a credential change, and removing
the integration entirely.
"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi.testclient import TestClient

from app.config import Settings
from app.crypto import decrypt_credential
from app.main import create_app
from tests.conftest import TEST_PASSWORD, FakeCalendarSource, FakeClock
from tests.test_google_accounts import connect_and_authorize


@contextmanager
def make_client(
    database_url: str,
    fake_clock: FakeClock,
    fake_calendar_source: FakeCalendarSource,
    **overrides: object,
) -> Iterator[TestClient]:
    app = create_app(
        Settings(database_url=database_url, **overrides),  # type: ignore[arg-type]
        clock=fake_clock,
        calendar_source=fake_calendar_source,
    )
    with TestClient(app, follow_redirects=False) as test_client:
        response = test_client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})
        assert response.status_code == 204, response.text
        yield test_client


def stored_encrypted_secret(database_url: str) -> str | None:
    db_path = database_url.removeprefix("sqlite+aiosqlite:///")
    row = (
        sqlite3.connect(db_path)
        .execute("SELECT encrypted_google_client_secret FROM settings")
        .fetchone()
    )
    return row[0] if row else None


class TestSaveCredentials:
    def test_saving_from_unconfigured_makes_status_report_configured(
        self, database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
    ) -> None:
        with make_client(database_url, fake_clock, fake_calendar_source) as client:
            response = client.put(
                "/api/v1/google/credentials",
                json={"client_id": "a-client-id", "client_secret": "a-client-secret"},
            )

            assert response.status_code == 200
            assert response.json() == {
                "configured": True,
                "client_id": "a-client-id",
                "client_secret_set": True,
            }
            assert client.get("/api/v1/google/status").json()["configured"] is True

    def test_the_saved_secret_is_encrypted_at_rest(
        self, database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
    ) -> None:
        with make_client(database_url, fake_clock, fake_calendar_source) as client:
            client.put(
                "/api/v1/google/credentials",
                json={"client_id": "a-client-id", "client_secret": "a-very-secret-value"},
            )

        encrypted = stored_encrypted_secret(database_url)
        assert encrypted is not None
        assert "a-very-secret-value" not in encrypted
        assert decrypt_credential(encrypted, key="test-master-key") == "a-very-secret-value"

    def test_reaches_the_calendar_source_without_a_restart(
        self, database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
    ) -> None:
        with make_client(database_url, fake_clock, fake_calendar_source) as client:
            client.put(
                "/api/v1/google/credentials",
                json={"client_id": "a-client-id", "client_secret": "a-client-secret"},
            )

            assert fake_calendar_source.client_id == "a-client-id"
            assert fake_calendar_source.client_secret == "a-client-secret"

            # The very next request on the same running app uses the new
            # credentials, not just the DB row.
            connect_response = client.get("/api/v1/google/connect")
            assert connect_response.status_code == 302
            assert "a-client-id" in connect_response.headers["location"]

    def test_omitting_the_secret_keeps_the_one_already_stored(
        self, database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
    ) -> None:
        with make_client(
            database_url,
            fake_clock,
            fake_calendar_source,
            google_client_id="old-client-id",
            google_client_secret="old-client-secret",
        ) as client:
            response = client.put("/api/v1/google/credentials", json={"client_id": "new-client-id"})

            assert response.status_code == 200
            assert response.json() == {
                "configured": True,
                "client_id": "new-client-id",
                "client_secret_set": True,
            }
            assert fake_calendar_source.client_id == "new-client-id"
            assert fake_calendar_source.client_secret == "old-client-secret"

    def test_omitting_the_secret_with_none_stored_yet_is_rejected(
        self, database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
    ) -> None:
        with make_client(database_url, fake_clock, fake_calendar_source) as client:
            response = client.put("/api/v1/google/credentials", json={"client_id": "a-client-id"})

        assert response.status_code == 422
        assert client.get("/api/v1/google/status").json()["configured"] is False

    def test_an_empty_client_id_is_rejected(
        self, database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
    ) -> None:
        with make_client(database_url, fake_clock, fake_calendar_source) as client:
            response = client.put(
                "/api/v1/google/credentials", json={"client_id": "", "client_secret": "a-secret"}
            )

        assert response.status_code == 422

    def test_editing_credentials_flips_every_connected_account_to_needs_reconnect(
        self, database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
    ) -> None:
        with make_client(
            database_url,
            fake_clock,
            fake_calendar_source,
            google_client_id="old-client-id",
            google_client_secret="old-client-secret",
            cors_origins=["http://localhost:5900"],
        ) as client:
            connect_and_authorize(
                client,
                fake_calendar_source,
                code="auth-code-1",
                google_account_id="google-1",
                email="me@example.com",
                refresh_token="rt-1",
            )
            accounts = client.get("/api/v1/google/accounts").json()
            assert accounts[0]["connection_state"] == "connected"

            client.put(
                "/api/v1/google/credentials",
                json={"client_id": "new-client-id", "client_secret": "new-client-secret"},
            )

            accounts = client.get("/api/v1/google/accounts").json()
            assert accounts[0]["connection_state"] == "needs_reconnect"

    def test_is_rejected_without_a_session(
        self, database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
    ) -> None:
        app = create_app(
            Settings(database_url=database_url),
            clock=fake_clock,
            calendar_source=fake_calendar_source,
        )
        with TestClient(app, follow_redirects=False) as unauthenticated_client:
            response = unauthenticated_client.put(
                "/api/v1/google/credentials",
                json={"client_id": "a-client-id", "client_secret": "a-secret"},
            )

        assert response.status_code == 401


class TestRemoveCredentials:
    def test_clears_credentials_and_returns_to_unconfigured(
        self, database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
    ) -> None:
        with make_client(
            database_url,
            fake_clock,
            fake_calendar_source,
            google_client_id="a-client-id",
            google_client_secret="a-client-secret",
        ) as client:
            response = client.delete("/api/v1/google/credentials")

            assert response.status_code == 204
            assert client.get("/api/v1/google/status").json() == {
                "configured": False,
                "client_id": None,
                "client_secret_set": False,
            }
            assert client.get("/api/v1/google/connect").status_code == 404

    def test_disconnects_every_account(
        self, database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
    ) -> None:
        with make_client(
            database_url,
            fake_clock,
            fake_calendar_source,
            google_client_id="a-client-id",
            google_client_secret="a-client-secret",
            cors_origins=["http://localhost:5900"],
        ) as client:
            connect_and_authorize(
                client,
                fake_calendar_source,
                code="auth-code-1",
                google_account_id="google-1",
                email="me@example.com",
                refresh_token="rt-1",
            )

            client.delete("/api/v1/google/credentials")

            db_path = database_url.removeprefix("sqlite+aiosqlite:///")
            rows = sqlite3.connect(db_path).execute("SELECT * FROM google_accounts").fetchall()
            assert rows == []

    def test_is_rejected_without_a_session(
        self, database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
    ) -> None:
        app = create_app(
            Settings(database_url=database_url),
            clock=fake_clock,
            calendar_source=fake_calendar_source,
        )
        with TestClient(app, follow_redirects=False) as unauthenticated_client:
            response = unauthenticated_client.delete("/api/v1/google/credentials")

        assert response.status_code == 401
