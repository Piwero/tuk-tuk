"""When each account was last active (issue #478, spec #468): set when an
authenticated request is served, written at most once every few minutes
per User, null until first use, and shown to Admins in the admin users
list only."""

from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from tests.conftest import TEST_PASSWORD, FakeClock, create_user_row, log_in

ME = "/api/v1/auth/me"
USERS = "/api/v1/admin/users"
TEMP_PASSWORD = "tulip-orbit-canvas-42"


def listed(client: TestClient) -> dict[str, dict[str, object]]:
    response = client.get(USERS)
    assert response.status_code == 200, response.text
    return {item["username"]: item for item in response.json()["items"]}


def last_active(client: TestClient, username: str) -> datetime | None:
    value = listed(client)[username]["last_active_at"]
    assert value is None or isinstance(value, str)
    return None if value is None else datetime.fromisoformat(value)


def as_member(client: TestClient, path: str = ME) -> None:
    """One request served to `bea`, then back to the admin's session."""
    client.cookies.clear()
    log_in(client, "bea", TEST_PASSWORD)
    assert client.get(path).status_code == 200
    client.cookies.clear()
    log_in(client)


class TestNullUntilFirstUse:
    def test_an_account_nobody_has_used(self, client: TestClient) -> None:
        create_user_row(client, "bea", "bea@example.com")

        assert last_active(client, "bea") is None

    def test_an_account_created_by_an_admin(self, client: TestClient) -> None:
        created = client.post(
            USERS,
            json={"username": "cy", "email": "cy@example.com", "temp_password": TEMP_PASSWORD},
        )

        assert created.status_code == 201, created.text
        assert created.json()["last_active_at"] is None


class TestSetWhenAnAuthenticatedRequestIsServed:
    def test_by_the_users_own_request(self, client: TestClient, fake_clock: FakeClock) -> None:
        create_user_row(client, "bea", "bea@example.com")
        fake_clock.advance(timedelta(days=2))
        served_at = fake_clock.now

        as_member(client)
        fake_clock.advance(timedelta(hours=2))

        assert last_active(client, "bea") == served_at

    def test_the_admin_reading_the_list_is_active_now(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        fake_clock.advance(timedelta(days=2))

        assert last_active(client, "admin") == fake_clock.now

    def test_while_a_forced_step_is_pending(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        create_user_row(
            client, "bea", "bea@example.com", password=TEMP_PASSWORD, must_change_password=True
        )
        fake_clock.advance(timedelta(days=2))
        served_at = fake_clock.now
        client.cookies.clear()
        log_in(client, "bea", TEMP_PASSWORD)
        assert client.get(ME).status_code == 200
        client.cookies.clear()
        log_in(client)
        fake_clock.advance(timedelta(hours=1))

        assert last_active(client, "bea") == served_at

    def test_not_by_a_request_refused_for_a_pending_step(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        create_user_row(
            client, "bea", "bea@example.com", password=TEMP_PASSWORD, must_change_password=True
        )
        client.cookies.clear()
        log_in(client, "bea", TEMP_PASSWORD)
        assert client.get("/api/v1/tasks").status_code == 403
        client.cookies.clear()
        log_in(client)

        assert last_active(client, "bea") is None


class TestWrittenAtMostOnceEveryFewMinutes:
    def test_requests_within_the_interval_leave_it_unchanged(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        first = last_active(client, "admin")
        assert first == fake_clock.now

        fake_clock.advance(timedelta(minutes=4))

        assert last_active(client, "admin") == first

    def test_the_first_request_after_the_interval_moves_it(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        last_active(client, "admin")
        fake_clock.advance(timedelta(minutes=4))
        last_active(client, "admin")
        fake_clock.advance(timedelta(minutes=2))

        assert last_active(client, "admin") == fake_clock.now


class TestVisibility:
    def test_not_on_the_users_own_record(self, client: TestClient) -> None:
        assert "last_active_at" not in client.get(ME).json()

    def test_the_admin_list_gains_it_and_nothing_else(self, client: TestClient) -> None:
        create_user_row(client, "bea", "bea@example.com")
        as_member(client, "/api/v1/tasks")

        assert set(listed(client)["bea"]) == {
            "id",
            "username",
            "email",
            "is_admin",
            "is_active",
            "must_change_password",
            "must_complete_profile",
            "created_at",
            "last_active_at",
        }
