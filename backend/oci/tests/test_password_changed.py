"""When each User's password last changed (issue #475, spec #468): set when
the account is created, when an Admin sets a temporary password, and when
the User replaces their password; shown to that User on their own account
record and never in the admin users list."""

from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from tests.conftest import TEST_PASSWORD, FakeClock, create_user_row, log_in, run_sql
from tests.test_setup import fresh_client, setup

ME = "/api/v1/auth/me"
USERS = "/api/v1/admin/users"
TEMP_PASSWORD = "tulip-orbit-canvas-42"
NEW_PASSWORD = "a-brand-new-password"


def password_changed_at(client: TestClient) -> datetime:
    response = client.get(ME)
    assert response.status_code == 200, response.text
    return datetime.fromisoformat(response.json()["password_changed_at"])


class TestSetOnCreation:
    def test_by_first_run_setup(self, database_url: str, fake_clock: FakeClock) -> None:
        fake_clock.advance(timedelta(days=3))
        with fresh_client(database_url, fake_clock) as client:
            assert setup(client).status_code == 204

            assert password_changed_at(client) == fake_clock.now

    def test_by_setup_handing_over_a_seeded_user_who_never_had_a_password(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with fresh_client(database_url, fake_clock) as client:
            create_user_row(client, "admin", None, is_admin=True, must_complete_profile=True)
            run_sql(database_url, "UPDATE users SET password_hash = NULL")
            fake_clock.advance(timedelta(days=3))
            assert setup(client).status_code == 204

            assert password_changed_at(client) == fake_clock.now

    def test_by_an_admin(self, client: TestClient, fake_clock: FakeClock) -> None:
        fake_clock.advance(timedelta(days=3))
        created = client.post(
            USERS,
            json={"username": "cy", "email": "cy@example.com", "temp_password": TEMP_PASSWORD},
        )
        assert created.status_code == 201, created.text
        created_at = fake_clock.now
        fake_clock.advance(timedelta(hours=1))

        client.cookies.clear()
        log_in(client, "cy", TEMP_PASSWORD)

        assert password_changed_at(client) == created_at


class TestSetWhenThePasswordIsReplaced:
    def test_by_an_admin_setting_a_temporary_password(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        member = create_user_row(client, "bea", "bea@example.com", password=NEW_PASSWORD)
        fake_clock.advance(timedelta(days=5))
        reset = client.post(
            f"{USERS}/{member.id}/reset-password", json={"temp_password": TEMP_PASSWORD}
        )
        assert reset.status_code == 200, reset.text
        reset_at = fake_clock.now
        fake_clock.advance(timedelta(hours=1))

        client.cookies.clear()
        log_in(client, "bea", TEMP_PASSWORD)

        assert password_changed_at(client) == reset_at

    def test_by_the_user_changing_it(self, client: TestClient, fake_clock: FakeClock) -> None:
        fake_clock.advance(timedelta(days=5))
        changed = client.post(
            "/api/v1/auth/password",
            json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
        )
        assert changed.status_code == 204, changed.text

        assert password_changed_at(client) == fake_clock.now

    def test_by_the_user_replacing_a_temporary_password(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        create_user_row(
            client, "bea", "bea@example.com", password=TEMP_PASSWORD, must_change_password=True
        )
        client.cookies.clear()
        log_in(client, "bea", TEMP_PASSWORD)
        fake_clock.advance(timedelta(days=2))

        completed = client.post("/api/v1/auth/complete", json={"new_password": NEW_PASSWORD})
        assert completed.status_code == 204, completed.text

        assert password_changed_at(client) == fake_clock.now

    def test_by_the_upgraded_user_completing_their_profile(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        create_user_row(client, "old", None, password=TEMP_PASSWORD, must_complete_profile=True)
        client.cookies.clear()
        log_in(client, "old", TEMP_PASSWORD)
        fake_clock.advance(timedelta(days=2))

        completed = client.post(
            "/api/v1/auth/complete",
            json={"new_password": NEW_PASSWORD, "username": "dee", "email": "dee@example.com"},
        )
        assert completed.status_code == 204, completed.text

        assert password_changed_at(client) == fake_clock.now

    def test_not_by_a_wrong_current_password(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        before = password_changed_at(client)
        fake_clock.advance(timedelta(days=5))
        refused = client.post(
            "/api/v1/auth/password",
            json={"current_password": "not-the-password", "new_password": NEW_PASSWORD},
        )
        assert refused.status_code == 400

        assert password_changed_at(client) == before


class TestVisibility:
    def test_only_on_the_users_own_record_never_in_the_admin_list(self, client: TestClient) -> None:
        create_user_row(client, "bea", "bea@example.com", password=NEW_PASSWORD)

        listed = client.get(USERS)
        assert listed.status_code == 200
        assert all("password_changed_at" not in item for item in listed.json()["items"])
        created = client.post(
            USERS,
            json={"username": "cy", "email": "cy@example.com", "temp_password": TEMP_PASSWORD},
        )
        assert "password_changed_at" not in created.json()
        assert "password_changed_at" in client.get(ME).json()
