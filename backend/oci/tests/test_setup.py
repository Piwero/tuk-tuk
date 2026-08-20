"""First-run setup, the DB-backed settings singleton, and the one-time
`.env` upgrade-import path (ADR 0008, issue #115).
"""

import sqlite3

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import FakeClock, app_settings_row


def fresh_client(database_url: str, fake_clock: FakeClock) -> TestClient:
    """A client for a database with no password set yet — unlike every
    other test's `unauthenticated_client`, which inherits the module-level
    AUTH_PASSWORD_HASH env var (conftest) and so is already past setup.
    """
    app = create_app(Settings(database_url=database_url, auth_password_hash=None), clock=fake_clock)
    return TestClient(app)


class TestFreshDeployment:
    def test_every_route_reports_setup_required(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            response = client.get("/api/v1/tasks")

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "setup_required"

    def test_health_is_still_reachable(self, database_url: str, fake_clock: FakeClock) -> None:
        with fresh_client(database_url, fake_clock) as client:
            response = client.get("/health")

        assert response.status_code == 200

    def test_login_reports_not_found_before_setup(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            response = client.post("/api/v1/auth/login", json={"password": "anything"})

        assert response.status_code == 404

    def test_a_session_key_is_generated_on_boot(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            row = app_settings_row(client.app)  # type: ignore[arg-type]

        assert row.session_key != ""
        assert row.password_hash is None


class TestSetup:
    def test_sets_the_password_and_issues_a_session(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            response = client.post("/api/v1/auth/setup", json={"password": "a-new-password"})

            assert response.status_code == 204
            assert "tuktuk_session" in response.cookies

            follow_up = client.get("/api/v1/tasks")
            assert follow_up.status_code == 200

    def test_login_works_with_the_password_just_set(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            client.post("/api/v1/auth/setup", json={"password": "a-new-password"})
            client.cookies.clear()

            response = client.post("/api/v1/auth/login", json={"password": "a-new-password"})

        assert response.status_code == 204

    def test_is_unreachable_once_a_password_already_exists(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            first = client.post("/api/v1/auth/setup", json={"password": "a-new-password"})
            assert first.status_code == 204

            replay = client.post("/api/v1/auth/setup", json={"password": "a-different-password"})

        assert replay.status_code == 404

    def test_rejects_an_empty_password(self, database_url: str, fake_clock: FakeClock) -> None:
        with fresh_client(database_url, fake_clock) as client:
            response = client.post("/api/v1/auth/setup", json={"password": ""})

        assert response.status_code == 422


class TestUpgradeImport:
    def test_an_existing_auth_password_hash_is_imported_and_setup_is_skipped(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        # A real Argon2id hash isn't needed here — bootstrap_app_settings
        # only copies the value into the settings row, it never verifies it.
        settings = Settings(database_url=database_url, auth_password_hash="an-imported-hash")

        with TestClient(create_app(settings, clock=fake_clock)) as client:
            row = app_settings_row(client.app)  # type: ignore[arg-type]
            response = client.get("/api/v1/tasks")

        assert row.password_hash == "an-imported-hash"
        # Reached the route handler at all (not setup_required) — 401 here
        # would mean the import didn't happen and /setup is still gating.
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"

    def test_the_import_runs_at_most_once(self, database_url: str, fake_clock: FakeClock) -> None:
        first_settings = Settings(database_url=database_url, auth_password_hash="first-hash")
        with TestClient(create_app(first_settings, clock=fake_clock)):
            pass

        # A second boot against the same database, with a different env
        # value — the already-populated row must win, not the env var.
        second_settings = Settings(database_url=database_url, auth_password_hash="second-hash")
        with TestClient(create_app(second_settings, clock=fake_clock)) as client:
            row = app_settings_row(client.app)  # type: ignore[arg-type]

        assert row.password_hash == "first-hash"

    def test_google_credentials_are_imported_alongside_the_password(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        settings = Settings(
            database_url=database_url,
            auth_password_hash="an-imported-hash",
            google_client_id="a-client-id",
            google_client_secret="a-client-secret",
        )

        with TestClient(create_app(settings, clock=fake_clock)) as client:
            row = app_settings_row(client.app)  # type: ignore[arg-type]

        assert row.google_client_id == "a-client-id"
        assert row.encrypted_google_client_secret is not None
        assert "a-client-secret" not in row.encrypted_google_client_secret

    def test_a_lone_google_client_id_without_a_secret_is_not_imported(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        """Half a credential pair is unusable and, since this import runs at
        most once, unrecoverable without host access — importing neither
        field is better than persisting a client_id with no secret."""
        settings = Settings(
            database_url=database_url,
            auth_password_hash="an-imported-hash",
            google_client_id="a-client-id",
            google_client_secret=None,
        )

        with TestClient(create_app(settings, clock=fake_clock)) as client:
            row = app_settings_row(client.app)  # type: ignore[arg-type]

        assert row.google_client_id is None
        assert row.encrypted_google_client_secret is None

    def test_assist_settings_are_imported_alongside_the_password(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        settings = Settings(
            database_url=database_url,
            auth_password_hash="an-imported-hash",
            assist_ollama_base_url="http://localhost:11434",
            assist_model="qwen3:14b",
        )

        with TestClient(create_app(settings, clock=fake_clock)) as client:
            row = app_settings_row(client.app)  # type: ignore[arg-type]

        assert row.assist_ollama_base_url == "http://localhost:11434"
        assert row.assist_model == "qwen3:14b"

    def test_a_lone_assist_setting_is_still_imported(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        """Unlike the Google pair, neither Assist field is a credential, so
        there's no half-configured-and-unusable risk to guard against —
        each imports independently."""
        settings = Settings(
            database_url=database_url,
            auth_password_hash="an-imported-hash",
            assist_ollama_base_url="http://localhost:11434",
            assist_model=None,
        )

        with TestClient(create_app(settings, clock=fake_clock)) as client:
            row = app_settings_row(client.app)  # type: ignore[arg-type]

        assert row.assist_ollama_base_url == "http://localhost:11434"
        assert row.assist_model is None


class TestEncryptionAtRest:
    def test_the_stored_google_client_secret_is_not_plaintext_in_the_raw_db_file(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        settings = Settings(
            database_url=database_url,
            auth_password_hash="an-imported-hash",
            google_client_id="a-client-id",
            google_client_secret="a-very-secret-client-secret",
        )

        with TestClient(create_app(settings, clock=fake_clock)):
            pass

        db_path = database_url.removeprefix("sqlite+aiosqlite:///")
        row = (
            sqlite3.connect(db_path)
            .execute("SELECT encrypted_google_client_secret FROM settings")
            .fetchone()
        )
        assert row is not None
        assert "a-very-secret-client-secret" not in row[0]
