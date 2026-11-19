"""First-run setup of the first Admin, the DB-backed settings singleton,
and the one-time `.env` upgrade-import path (ADR 0008, ADR 0018; issues
#115 and #410).
"""

from fastapi.testclient import TestClient
from httpx import Response

from app.config import Settings
from app.main import create_app
from tests.conftest import FakeClock, app_settings_row, create_user_row, run_sql

SETUP = {"username": "ana", "email": "ana@example.com", "password": "a-new-password"}


def fresh_client(database_url: str, fake_clock: FakeClock, **settings: object) -> TestClient:
    """A client for a fresh install: no User yet, unlike every other test's
    `unauthenticated_client`, which is already past setup."""
    return TestClient(
        create_app(Settings(database_url=database_url, **settings), clock=fake_clock)  # type: ignore[arg-type]
    )


def setup(client: TestClient, **overrides: object) -> Response:
    return client.post("/api/v1/auth/setup", json={**SETUP, **overrides})


def users(database_url: str) -> list[tuple[object, ...]]:
    return run_sql(
        database_url,
        "SELECT id, username, email, is_admin, must_complete_profile FROM users ORDER BY id",
    )


class TestFreshDeployment:
    def test_has_no_users(self, database_url: str, fake_clock: FakeClock) -> None:
        with fresh_client(database_url, fake_clock):
            pass

        assert users(database_url) == []

    def test_every_route_reports_setup_required(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            response = client.get("/api/v1/tasks")

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "setup_required"

    def test_health_is_still_reachable(self, database_url: str, fake_clock: FakeClock) -> None:
        with fresh_client(database_url, fake_clock) as client:
            assert client.get("/health").status_code == 200

    def test_login_reports_not_found_before_setup(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            response = client.post(
                "/api/v1/auth/login", json={"login": "anyone", "password": "anything"}
            )

        assert response.status_code == 404

    def test_a_session_key_is_generated_on_boot(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            row = app_settings_row(client.app)  # type: ignore[arg-type]

        assert row.session_key != ""


class TestSetup:
    def test_creates_the_first_admin_and_signs_them_in(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            response = setup(client)

            assert response.status_code == 204
            assert "tuktuk_session" in response.cookies
            me = client.get("/api/v1/auth/me").json()
            assert client.get("/api/v1/tasks").status_code == 200

        assert (me["username"], me["email"], me["is_admin"]) == ("ana", "ana@example.com", True)
        assert me["must_change_password"] is False
        assert me["must_complete_profile"] is False

    def test_the_first_admin_gets_their_own_inbox(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            setup(client)
            lists = client.get("/api/v1/lists").json()["items"]

        assert [(entry["name"], entry["is_inbox"]) for entry in lists] == [("Inbox", True)]

    def test_login_works_with_the_credentials_just_set(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            setup(client)
            client.cookies.clear()

            response = client.post(
                "/api/v1/auth/login",
                json={"login": "ana@example.com", "password": "a-new-password"},
            )

        assert response.status_code == 204

    def test_is_unreachable_once_a_user_exists(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            assert setup(client).status_code == 204

            replay = setup(client, username="mallory", email="mallory@example.com")

        assert replay.status_code == 404
        assert [row[1] for row in users(database_url)] == ["ana"]

    def test_requires_a_username_and_an_email(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            response = client.post("/api/v1/auth/setup", json={"password": "a-new-password"})

        assert response.status_code == 422
        assert users(database_url) == []

    def test_rejects_a_blank_username(self, database_url: str, fake_clock: FakeClock) -> None:
        with fresh_client(database_url, fake_clock) as client:
            response = setup(client, username="   ")

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_username"

    def test_rejects_an_invalid_email(self, database_url: str, fake_clock: FakeClock) -> None:
        with fresh_client(database_url, fake_clock) as client:
            response = setup(client, email="ana.example.com")

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_email"

    def test_rejects_an_empty_password(self, database_url: str, fake_clock: FakeClock) -> None:
        with fresh_client(database_url, fake_clock) as client:
            assert setup(client, password="").status_code == 422

    def test_rejects_a_password_shorter_than_the_minimum(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            response = setup(client, password="short")

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_password"
        assert "12" in response.json()["error"]["message"]

    def test_accepts_a_password_of_exactly_the_minimum_length(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            assert setup(client, password="123456789012").status_code == 204

    def test_completes_a_seeded_user_1_that_never_had_a_password(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        # An upgraded install that only ever ran with AUTH_DISABLED: the
        # migration seeded user #1 with its data but no password, so nobody
        # can log in and setup must hand that User over, not add a second.
        with fresh_client(database_url, fake_clock) as client:
            create_user_row(client, "admin", None, is_admin=True, must_complete_profile=True)
            run_sql(database_url, "UPDATE users SET password_hash = NULL")

            response = setup(client)

        assert response.status_code == 204
        assert users(database_url) == [(1, "ana", "ana@example.com", True, False)]


class TestUpgradeImport:
    def test_an_auth_password_hash_creates_user_1_as_the_migration_would(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock, auth_password_hash=_hash("old-password")):
            pass

        assert users(database_url) == [(1, "admin", None, True, True)]

    def test_user_1_logs_in_with_the_imported_password_and_must_complete_their_profile(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        settings = {"auth_password_hash": _hash("old-password")}
        with fresh_client(database_url, fake_clock, **settings) as client:
            login = client.post(
                "/api/v1/auth/login", json={"login": "admin", "password": "old-password"}
            )
            blocked = client.get("/api/v1/tasks")

        assert login.status_code == 204
        assert blocked.json()["error"]["code"] == "profile_completion_required"

    def test_the_hash_goes_to_a_seeded_user_1_that_has_no_password(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            create_user_row(client, "admin", None, is_admin=True, must_complete_profile=True)
            run_sql(database_url, "UPDATE users SET password_hash = NULL")

        with fresh_client(database_url, fake_clock, auth_password_hash="an-imported-hash"):
            pass

        assert run_sql(database_url, "SELECT id, password_hash FROM users") == [
            (1, "an-imported-hash")
        ]

    def test_the_import_runs_at_most_once(self, database_url: str, fake_clock: FakeClock) -> None:
        with fresh_client(database_url, fake_clock, auth_password_hash="first-hash"):
            pass

        # A second boot against the same database, with a different env
        # value — the password already held must win, not the env var.
        with fresh_client(database_url, fake_clock, auth_password_hash="second-hash"):
            pass

        assert run_sql(database_url, "SELECT password_hash FROM users") == [("first-hash",)]

    def test_is_ignored_once_setup_has_created_a_user(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            setup(client)

        with fresh_client(database_url, fake_clock, auth_password_hash="an-imported-hash"):
            pass

        assert [row[1] for row in users(database_url)] == ["ana"]

    def test_google_credentials_are_imported_on_first_boot(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(
            database_url,
            fake_clock,
            google_client_id="a-client-id",
            google_client_secret="a-client-secret",
        ) as client:
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
        with fresh_client(
            database_url, fake_clock, google_client_id="a-client-id", google_client_secret=None
        ) as client:
            row = app_settings_row(client.app)  # type: ignore[arg-type]

        assert row.google_client_id is None
        assert row.encrypted_google_client_secret is None

    def test_assist_settings_are_imported_on_first_boot(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(
            database_url,
            fake_clock,
            assist_ollama_base_url="http://localhost:11434",
            assist_model="qwen3:14b",
        ) as client:
            row = app_settings_row(client.app)  # type: ignore[arg-type]

        assert row.assist_ollama_base_url == "http://localhost:11434"
        assert row.assist_model == "qwen3:14b"

    def test_a_lone_assist_setting_is_still_imported(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        """Unlike the Google pair, neither Assist field is a credential, so
        there's no half-configured-and-unusable risk to guard against —
        each imports independently."""
        with fresh_client(
            database_url,
            fake_clock,
            assist_ollama_base_url="http://localhost:11434",
            assist_model=None,
        ) as client:
            row = app_settings_row(client.app)  # type: ignore[arg-type]

        assert row.assist_ollama_base_url == "http://localhost:11434"
        assert row.assist_model is None


class TestEncryptionAtRest:
    def test_the_stored_google_client_secret_is_not_plaintext_in_the_raw_db_file(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(
            database_url,
            fake_clock,
            google_client_id="a-client-id",
            google_client_secret="a-very-secret-client-secret",
        ):
            pass

        [row] = run_sql(database_url, "SELECT encrypted_google_client_secret FROM settings")
        assert "a-very-secret-client-secret" not in row[0]


def _hash(password: str) -> str:
    from argon2 import PasswordHasher
    from argon2.low_level import Type

    return PasswordHasher(time_cost=1, memory_cost=64, parallelism=1, type=Type.ID).hash(password)
