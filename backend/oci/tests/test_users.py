"""Creating a User (ADR 0018): each starts with their own Inbox, and every
row they create, children included, is theirs (issue #411)."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.routers.v1 import admin_users as admin_users_router
from app.routers.v1 import auth as auth_router
from tests.conftest import FakeClock, create_user_row, log_in, make_task, run_sql


class TestCreatingAUser:
    def test_each_user_gets_their_own_inbox(
        self, unauthenticated_client: TestClient, database_url: str
    ) -> None:
        bea = create_user_row(unauthenticated_client, "bea", "bea@example.com")

        assert run_sql(
            database_url, "SELECT owner_id, name FROM lists WHERE is_inbox ORDER BY owner_id"
        ) == [(1, "Inbox"), (bea.id, "Inbox")]


class TestNewRowsBelongToTheSignedInUser:
    def test_a_created_task_and_its_check_item_belong_to_whoever_created_them(
        self, unauthenticated_client: TestClient, database_url: str
    ) -> None:
        bea = create_user_row(unauthenticated_client, "bea", "bea@example.com")
        log_in(unauthenticated_client, "bea")

        task = make_task(unauthenticated_client, "Write code")
        response = unauthenticated_client.post(
            f"/api/v1/tasks/{task['id']}/check-items", json={"title": "Tests"}
        )
        assert response.status_code == 201, response.text

        assert run_sql(database_url, "SELECT owner_id FROM tasks") == [(bea.id,)]
        assert run_sql(database_url, "SELECT owner_id FROM check_items") == [(bea.id,)]


async def _skip_the_check(*_args: object, **_kwargs: object) -> None:
    """Stands in for the pre-check (`ensure_identity_free`), as if another
    request took the name between that check and this one's commit."""


TAKEN = [({"username": "BEA"}, "username_taken"), ({"email": "Bea@Example.com"}, "email_taken")]


class TestAnIdentityTakenByARacingRequest:
    """The pre-check and the write are separate steps, so a concurrent
    request can claim the same username or email in between. The unique
    index then refuses the write, and that is reported exactly as the
    pre-check would have: a 409 naming the field, not a 500."""

    @pytest.fixture
    def racing(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> TestClient:
        monkeypatch.setattr(auth_router, "ensure_identity_free", _skip_the_check)
        monkeypatch.setattr(admin_users_router, "ensure_identity_free", _skip_the_check)
        create_user_row(client, "bea", "bea@example.com")
        return client

    @pytest.mark.parametrize(("fields", "code"), TAKEN)
    def test_an_admin_creating_an_account(
        self, racing: TestClient, fields: dict[str, str], code: str
    ) -> None:
        response = racing.post(
            "/api/v1/admin/users",
            json={
                "username": "cy",
                "email": "cy@example.com",
                "temp_password": "tulip-orbit-canvas-42",
                **fields,
            },
        )

        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == code

    @pytest.mark.parametrize(("fields", "code"), TAKEN)
    def test_editing_ones_own_profile(
        self, racing: TestClient, fields: dict[str, str], code: str
    ) -> None:
        response = racing.patch("/api/v1/auth/me", json=fields)

        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == code

    @pytest.mark.parametrize(("fields", "code"), TAKEN)
    def test_completing_a_profile(
        self, racing: TestClient, database_url: str, fields: dict[str, str], code: str
    ) -> None:
        run_sql(
            database_url,
            "UPDATE users SET email = NULL, must_complete_profile = true WHERE username = 'admin'",
        )

        response = racing.post(
            "/api/v1/auth/complete",
            json={
                "username": "ana",
                "email": "ana@example.com",
                "new_password": "a-brand-new-password",
                **fields,
            },
        )

        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == code

    def test_first_run_setup(
        self, database_url: str, fake_clock: FakeClock, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """An upgraded install whose user #1 never had a password: setup
        completes that User, and here the name is already another's."""
        monkeypatch.setattr(auth_router, "ensure_identity_free", _skip_the_check)
        run_sql(
            database_url,
            "INSERT INTO users (id, username, is_admin, must_complete_profile) "
            "VALUES (1, 'admin', true, true), (2, 'bea', false, true)",
        )
        app = create_app(Settings(database_url=database_url), clock=fake_clock)

        with TestClient(app) as fresh:
            response = fresh.post(
                "/api/v1/auth/setup",
                json={"username": "Bea", "email": "ana@example.com", "password": "a-new-password"},
            )

        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "username_taken"
