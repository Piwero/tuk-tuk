"""User #1 stands in for "the" user until per-user login lands (issue
#408): the app boots with it, everything it creates belongs to it, and its
password and lockout are the install's."""

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import FakeClock, app_settings_row, make_task, run_sql

NEW_PASSWORD = "a-brand-new-password"


def users(database_url: str) -> list[tuple[object, ...]]:
    return run_sql(
        database_url,
        "SELECT id, username, is_admin, must_complete_profile FROM users ORDER BY id",
    )


def user_1_password_hash(database_url: str) -> str | None:
    rows = run_sql(database_url, "SELECT password_hash FROM users WHERE id = 1")
    return rows[0][0]


class TestBootSeedsUser1:
    def test_a_fresh_install_boots_with_user_1_as_the_admin(
        self, client: TestClient, database_url: str
    ) -> None:
        assert users(database_url) == [(1, "admin", True, True)]

    def test_user_1_holds_the_imported_password(
        self, client: TestClient, database_url: str
    ) -> None:
        settings_hash = app_settings_row(client.app).password_hash  # type: ignore[arg-type]

        assert user_1_password_hash(database_url) == settings_hash


class TestUser1OwnsEverything:
    def test_the_inbox_belongs_to_user_1(self, client: TestClient, database_url: str) -> None:
        assert run_sql(database_url, "SELECT owner_id FROM lists WHERE is_inbox") == [(1,)]

    def test_a_created_task_and_its_check_item_belong_to_user_1(
        self, client: TestClient, database_url: str
    ) -> None:
        task = make_task(client, "Write code")
        response = client.post(f"/api/v1/tasks/{task['id']}/check-items", json={"title": "Tests"})
        assert response.status_code == 201, response.text

        assert run_sql(database_url, "SELECT owner_id FROM tasks") == [(1,)]
        assert run_sql(database_url, "SELECT owner_id FROM check_items") == [(1,)]


class TestUser1PasswordFollowsTheInstallPassword:
    def test_first_run_setup_sets_user_1s_password(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        app = create_app(
            Settings(database_url=database_url, auth_password_hash=None), clock=fake_clock
        )
        with TestClient(app) as fresh:
            assert user_1_password_hash(database_url) is None

            response = fresh.post("/api/v1/auth/setup", json={"password": NEW_PASSWORD})
            assert response.status_code == 204, response.text

            settings_hash = app_settings_row(fresh.app).password_hash  # type: ignore[arg-type]
        assert settings_hash is not None
        assert user_1_password_hash(database_url) == settings_hash

    def test_changing_the_password_changes_user_1s(
        self, client: TestClient, database_url: str
    ) -> None:
        response = client.post(
            "/api/v1/auth/password",
            json={"current_password": "test-password", "new_password": NEW_PASSWORD},
        )
        assert response.status_code == 204, response.text

        settings_hash = app_settings_row(client.app).password_hash  # type: ignore[arg-type]
        assert user_1_password_hash(database_url) == settings_hash
