"""Per-user login, the session cookie and what the middleware checks on it,
forced steps, change-password and logout (ADR 0005, ADR 0008, ADR 0018;
issues #83, #84, #116, #339, #410).
"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from app.config import Settings
from app.login_throttle import LoginThrottle
from app.main import create_app
from app.session import issue_session_token, verify_session_token
from tests.conftest import (
    TEST_EMAIL,
    TEST_PASSWORD,
    TEST_USERNAME,
    FakeClock,
    app_settings_row,
    create_user_row,
    log_in,
    run_sql,
    user_row,
)

NEW_PASSWORD = "a-new-password"
LOCKOUT_THRESHOLD = 5  # keep in sync with app.routers.v1.auth.LOCKOUT_THRESHOLD


def login(client: TestClient, login: str, password: str) -> Response:
    return client.post("/api/v1/auth/login", json={"login": login, "password": password})


def session_key(client: TestClient) -> str:
    return app_settings_row(client.app).session_key  # type: ignore[arg-type]


def change_password(client: TestClient, current: str, new: str) -> Response:
    return client.post(
        "/api/v1/auth/password", json={"current_password": current, "new_password": new}
    )


class TestLogin:
    def test_the_username_and_password_return_204_with_no_body_and_a_session_cookie(
        self, unauthenticated_client: TestClient
    ) -> None:
        response = login(unauthenticated_client, TEST_USERNAME, TEST_PASSWORD)

        assert response.status_code == 204
        assert response.content == b""
        assert "tuktuk_session" in response.cookies
        assert unauthenticated_client.get("/api/v1/tasks").status_code == 200

    def test_the_email_logs_in_too(self, unauthenticated_client: TestClient) -> None:
        response = login(unauthenticated_client, TEST_EMAIL, TEST_PASSWORD)

        assert response.status_code == 204
        assert unauthenticated_client.get("/api/v1/auth/me").json()["username"] == TEST_USERNAME

    @pytest.mark.parametrize("given", ["ADMIN", "Admin@Example.COM", "  admin  "])
    def test_the_login_ignores_case_and_surrounding_spaces(
        self, unauthenticated_client: TestClient, given: str
    ) -> None:
        assert login(unauthenticated_client, given, TEST_PASSWORD).status_code == 204

    def test_each_user_is_signed_in_as_themselves(self, unauthenticated_client: TestClient) -> None:
        create_user_row(unauthenticated_client, "bea", "bea@example.com", password="bea-password")

        login(unauthenticated_client, "bea", "bea-password")

        assert unauthenticated_client.get("/api/v1/auth/me").json()["username"] == "bea"

    def test_the_password_belongs_to_the_named_user(
        self, unauthenticated_client: TestClient
    ) -> None:
        create_user_row(unauthenticated_client, "bea", "bea@example.com", password="bea-password")

        response = login(unauthenticated_client, "bea", TEST_PASSWORD)

        assert response.status_code == 401

    def test_the_cookie_is_httponly_and_samesite_lax(
        self, unauthenticated_client: TestClient
    ) -> None:
        response = login(unauthenticated_client, TEST_USERNAME, TEST_PASSWORD)

        set_cookie = response.headers["set-cookie"].lower()
        assert "httponly" in set_cookie
        assert "samesite=lax" in set_cookie
        assert "path=/" in set_cookie

    def test_the_wrong_password_is_rejected_with_the_error_envelope(
        self, unauthenticated_client: TestClient
    ) -> None:
        response = login(unauthenticated_client, TEST_USERNAME, "wrong")

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "invalid_credentials"
        assert "tuktuk_session" not in response.cookies

    def test_an_unknown_login_gets_the_same_answer_as_a_wrong_password(
        self, unauthenticated_client: TestClient
    ) -> None:
        unknown = login(unauthenticated_client, "nobody", TEST_PASSWORD)
        wrong = login(unauthenticated_client, TEST_USERNAME, "wrong")

        assert unknown.status_code == wrong.status_code == 401
        assert unknown.json() == wrong.json()

    def test_the_old_password_only_body_is_rejected(
        self, unauthenticated_client: TestClient
    ) -> None:
        response = unauthenticated_client.post(
            "/api/v1/auth/login", json={"password": TEST_PASSWORD}
        )

        assert response.status_code == 422

    def test_consecutive_failures_escalate_and_success_resets(
        self, unauthenticated_client: TestClient
    ) -> None:
        for _ in range(3):
            assert login(unauthenticated_client, TEST_USERNAME, "wrong").status_code == 401

        assert login(unauthenticated_client, TEST_USERNAME, TEST_PASSWORD).status_code == 204

    def test_a_stored_password_shorter_than_the_minimum_still_logs_in(
        self, unauthenticated_client: TestClient
    ) -> None:
        # An existing hash is never re-validated against the current
        # minimum, so a short password keeps working until its next change
        # (issue #338) — the minimum must never lock an owner out.
        create_user_row(unauthenticated_client, "bea", "bea@example.com", password="short")

        assert login(unauthenticated_client, "bea", "short").status_code == 204


class TestLockout:
    def test_enough_consecutive_failures_locks_login(
        self, unauthenticated_client: TestClient
    ) -> None:
        for _ in range(LOCKOUT_THRESHOLD):
            login(unauthenticated_client, TEST_USERNAME, "wrong")

        response = login(unauthenticated_client, TEST_USERNAME, TEST_PASSWORD)

        assert response.status_code == 429
        assert response.json()["error"]["code"] == "too_many_attempts"
        assert "Retry-After" in response.headers
        assert "tuktuk_session" not in response.cookies

    def test_the_lock_is_per_user(self, unauthenticated_client: TestClient) -> None:
        create_user_row(unauthenticated_client, "bea", "bea@example.com", password="bea-password")
        for _ in range(LOCKOUT_THRESHOLD):
            login(unauthenticated_client, TEST_USERNAME, "wrong")

        assert login(unauthenticated_client, TEST_USERNAME, TEST_PASSWORD).status_code == 429
        assert login(unauthenticated_client, "bea", "bea-password").status_code == 204

    def test_failures_by_email_and_by_username_count_against_the_same_user(
        self, unauthenticated_client: TestClient
    ) -> None:
        for attempt in range(LOCKOUT_THRESHOLD):
            name = TEST_EMAIL if attempt % 2 else TEST_USERNAME
            login(unauthenticated_client, name, "wrong")

        assert login(unauthenticated_client, TEST_USERNAME, TEST_PASSWORD).status_code == 429

    def test_advancing_the_clock_past_the_lock_lets_login_work_again(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        for _ in range(LOCKOUT_THRESHOLD):
            login(unauthenticated_client, TEST_USERNAME, "wrong")
        assert login(unauthenticated_client, TEST_USERNAME, TEST_PASSWORD).status_code == 429

        fake_clock.advance(timedelta(seconds=LoginThrottle.CAP_SECONDS + 1))

        assert login(unauthenticated_client, TEST_USERNAME, TEST_PASSWORD).status_code == 204

    def test_a_successful_login_clears_the_count_and_the_lock(
        self, unauthenticated_client: TestClient
    ) -> None:
        for _ in range(LOCKOUT_THRESHOLD - 1):
            login(unauthenticated_client, TEST_USERNAME, "wrong")

        assert login(unauthenticated_client, TEST_USERNAME, TEST_PASSWORD).status_code == 204

        row = user_row(unauthenticated_client, 1)
        assert row.login_failed_attempts == 0
        assert row.login_locked_until is None

    def test_the_lock_survives_a_second_app_built_over_the_same_database(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        first_app = create_app(Settings(database_url=database_url), clock=fake_clock)
        with TestClient(first_app) as first_client:
            create_user_row(first_app, is_admin=True)
            for _ in range(LOCKOUT_THRESHOLD):
                login(first_client, TEST_USERNAME, "wrong")

        second_app = create_app(Settings(database_url=database_url), clock=fake_clock)
        with TestClient(second_app) as second_client:
            response = login(second_client, TEST_USERNAME, TEST_PASSWORD)

        assert response.status_code == 429

    def test_change_passwords_current_password_check_feeds_the_same_lock(
        self, client: TestClient
    ) -> None:
        for _ in range(LOCKOUT_THRESHOLD):
            change_password(client, "wrong", NEW_PASSWORD)

        response = change_password(client, TEST_PASSWORD, NEW_PASSWORD)

        assert response.status_code == 429
        assert response.json()["error"]["code"] == "too_many_attempts"


class TestDisabledUser:
    def test_a_disabled_user_with_the_right_password_is_told_the_account_is_disabled(
        self, unauthenticated_client: TestClient
    ) -> None:
        create_user_row(
            unauthenticated_client,
            "bea",
            "bea@example.com",
            password="bea-password",
            is_active=False,
        )

        response = login(unauthenticated_client, "bea", "bea-password")

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "account_disabled"
        assert "tuktuk_session" not in response.cookies

    def test_a_wrong_password_never_learns_the_account_is_disabled(
        self, unauthenticated_client: TestClient
    ) -> None:
        create_user_row(
            unauthenticated_client,
            "bea",
            "bea@example.com",
            password="bea-password",
            is_active=False,
        )

        response = login(unauthenticated_client, "bea", "wrong")

        assert response.json()["error"]["code"] == "invalid_credentials"

    def test_a_session_is_refused_once_its_user_is_disabled(
        self, client: TestClient, database_url: str
    ) -> None:
        run_sql(database_url, "UPDATE users SET is_active = false")

        response = client.get("/api/v1/tasks")

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "account_disabled"


class TestSessionEpoch:
    def test_a_cookie_at_an_older_epoch_is_rejected(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock, database_url: str
    ) -> None:
        run_sql(database_url, "UPDATE users SET session_epoch = 3")
        stale = issue_session_token(
            session_key(unauthenticated_client), user_id=1, epoch=2, issued_at=fake_clock.now
        )
        unauthenticated_client.cookies.set("tuktuk_session", stale)

        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"

    def test_a_cookie_at_the_current_epoch_is_accepted(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock, database_url: str
    ) -> None:
        run_sql(database_url, "UPDATE users SET session_epoch = 3")
        current = issue_session_token(
            session_key(unauthenticated_client), user_id=1, epoch=3, issued_at=fake_clock.now
        )
        unauthenticated_client.cookies.set("tuktuk_session", current)

        assert unauthenticated_client.get("/api/v1/tasks").status_code == 200

    def test_a_cookie_naming_a_user_that_does_not_exist_is_rejected(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        forged = issue_session_token(
            session_key(unauthenticated_client), user_id=999, epoch=0, issued_at=fake_clock.now
        )
        unauthenticated_client.cookies.set("tuktuk_session", forged)

        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"

    def test_the_cookie_names_the_user_and_their_epoch(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        response = login(unauthenticated_client, TEST_USERNAME, TEST_PASSWORD)

        claims = verify_session_token(
            response.cookies["tuktuk_session"],
            session_key(unauthenticated_client),
            unauthenticated_client.app.state.settings,  # type: ignore[attr-defined]
            fake_clock,
        )
        assert claims is not None
        assert (claims.user_id, claims.epoch) == (1, 0)


class TestSessionProbe:
    def test_returns_204_with_a_valid_session(self, client: TestClient) -> None:
        assert client.get("/api/v1/auth/session").status_code == 204

    def test_is_rejected_without_a_session(self, unauthenticated_client: TestClient) -> None:
        assert unauthenticated_client.get("/api/v1/auth/session").status_code == 401


class TestMe:
    def test_returns_the_signed_in_users_account_record(self, client: TestClient) -> None:
        response = client.get("/api/v1/auth/me")

        assert response.status_code == 200
        record = response.json()
        # When the password changed is covered in tests/test_password_changed.py.
        assert "password_changed_at" in record
        del record["password_changed_at"]
        assert record == {
            "id": 1,
            "username": TEST_USERNAME,
            "email": TEST_EMAIL,
            "is_admin": True,
            "must_change_password": False,
            "must_complete_profile": False,
        }

    def test_is_rejected_without_a_session(self, unauthenticated_client: TestClient) -> None:
        assert unauthenticated_client.get("/api/v1/auth/me").status_code == 401


def update_profile(client: TestClient, **fields: str) -> Response:
    return client.patch("/api/v1/auth/me", json=fields)


class TestUpdateProfile:
    """The signed-in User edits their own username and email (issue #474),
    one field at a time, under the same rules as account creation."""

    def test_changes_the_username_and_returns_the_account_record(self, client: TestClient) -> None:
        response = update_profile(client, username="ines")

        assert response.status_code == 200
        assert response.json()["username"] == "ines"
        assert response.json()["email"] == TEST_EMAIL
        assert client.get("/api/v1/auth/me").json()["username"] == "ines"

    def test_changes_only_the_email_when_only_the_email_is_sent(self, client: TestClient) -> None:
        response = update_profile(client, email="  ines@example.org ")

        assert response.status_code == 200
        me = client.get("/api/v1/auth/me").json()
        assert (me["username"], me["email"]) == (TEST_USERNAME, "ines@example.org")

    def test_the_new_username_logs_in_and_this_session_stays(self, client: TestClient) -> None:
        update_profile(client, username="ines")

        assert client.get("/api/v1/tasks").status_code == 200
        client.cookies.clear()
        assert login(client, "ines", TEST_PASSWORD).status_code == 204

    def test_keeping_ones_own_values_in_another_case_is_not_a_conflict(
        self, client: TestClient
    ) -> None:
        response = update_profile(client, username=TEST_USERNAME.upper(), email=TEST_EMAIL)

        assert response.status_code == 200

    @pytest.mark.parametrize(
        ("fields", "code"),
        [
            ({"username": "BEA"}, "username_taken"),
            ({"email": "Bea@Example.com"}, "email_taken"),
        ],
    )
    def test_a_value_another_user_holds_is_reported_on_its_field(
        self, client: TestClient, fields: dict[str, str], code: str
    ) -> None:
        create_user_row(client, "bea", "bea@example.com")

        response = update_profile(client, **fields)

        assert response.status_code == 409
        assert response.json()["error"]["code"] == code
        me = client.get("/api/v1/auth/me").json()
        assert (me["username"], me["email"]) == (TEST_USERNAME, TEST_EMAIL)

    @pytest.mark.parametrize(
        ("fields", "code"),
        [
            ({"username": "   "}, "invalid_username"),
            ({"username": "x" * 65}, "invalid_username"),
            ({"email": "not-an-email"}, "invalid_email"),
        ],
    )
    def test_an_invalid_value_is_rejected(
        self, client: TestClient, fields: dict[str, str], code: str
    ) -> None:
        response = update_profile(client, **fields)

        assert response.status_code == 422
        assert response.json()["error"]["code"] == code

    def test_is_rejected_without_a_session(self, unauthenticated_client: TestClient) -> None:
        assert update_profile(unauthenticated_client, username="ines").status_code == 401


class TestEnforcement:
    def test_health_is_reachable_without_a_session(
        self, unauthenticated_client: TestClient
    ) -> None:
        assert unauthenticated_client.get("/health").status_code == 200

    def test_a_data_endpoint_rejects_a_request_without_a_session(
        self, unauthenticated_client: TestClient
    ) -> None:
        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"

    def test_a_data_endpoint_accepts_a_request_with_a_valid_session(
        self, client: TestClient
    ) -> None:
        assert client.get("/api/v1/tasks").status_code == 200

    def test_the_openapi_schema_requires_a_session(
        self, unauthenticated_client: TestClient
    ) -> None:
        assert unauthenticated_client.get("/openapi.json").status_code == 401

    def test_the_interactive_docs_require_a_session(
        self, unauthenticated_client: TestClient
    ) -> None:
        assert unauthenticated_client.get("/docs").status_code == 401

    def test_a_malformed_cookie_is_rejected(self, unauthenticated_client: TestClient) -> None:
        unauthenticated_client.cookies.set("tuktuk_session", "not-a-real-token")

        assert unauthenticated_client.get("/api/v1/tasks").status_code == 401

    def test_a_cookie_signed_with_a_different_key_is_rejected(
        self, unauthenticated_client: TestClient
    ) -> None:
        forged = issue_session_token(
            "a-different-key", user_id=1, epoch=0, issued_at=datetime.now(UTC)
        )
        unauthenticated_client.cookies.set("tuktuk_session", forged)

        assert unauthenticated_client.get("/api/v1/tasks").status_code == 401

    def test_a_path_merely_prefixed_by_an_allowlisted_one_is_not_opened(
        self, unauthenticated_client: TestClient
    ) -> None:
        response = unauthenticated_client.get("/health-check")

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"


class TestForcedStepGate:
    @pytest.fixture
    def temporary_password_client(self, unauthenticated_client: TestClient) -> TestClient:
        create_user_row(
            unauthenticated_client,
            "bea",
            "bea@example.com",
            password="temporary-pass",
            must_change_password=True,
        )
        log_in(unauthenticated_client, "bea", "temporary-pass")
        return unauthenticated_client

    @pytest.fixture
    def incomplete_profile_client(
        self, unauthenticated_client: TestClient, database_url: str
    ) -> TestClient:
        run_sql(database_url, "UPDATE users SET email = NULL, must_complete_profile = true")
        log_in(unauthenticated_client)
        return unauthenticated_client

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("GET", "/api/v1/tasks"),
            ("GET", "/api/v1/auth/session"),
            ("POST", "/api/v1/auth/password"),
            ("GET", "/api/v1/settings"),
            ("GET", "/openapi.json"),
            ("PATCH", "/api/v1/auth/me"),
        ],
    )
    def test_a_pending_password_change_blocks_everything_else(
        self, temporary_password_client: TestClient, method: str, path: str
    ) -> None:
        response = temporary_password_client.request(method, path, json={"username": "cy"})

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "password_change_required"

    def test_a_pending_profile_completion_blocks_everything_else(
        self, incomplete_profile_client: TestClient
    ) -> None:
        response = incomplete_profile_client.get("/api/v1/tasks")

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "profile_completion_required"

    def test_me_is_reachable_and_names_the_pending_step(
        self, temporary_password_client: TestClient
    ) -> None:
        response = temporary_password_client.get("/api/v1/auth/me")

        assert response.status_code == 200
        assert response.json()["must_change_password"] is True

    def test_logout_is_reachable(self, temporary_password_client: TestClient) -> None:
        assert temporary_password_client.post("/api/v1/auth/logout").status_code == 204

    def test_completing_a_password_change_opens_the_app(
        self, temporary_password_client: TestClient
    ) -> None:
        response = temporary_password_client.post(
            "/api/v1/auth/complete", json={"new_password": NEW_PASSWORD}
        )

        assert response.status_code == 204
        assert temporary_password_client.get("/api/v1/tasks").status_code == 200
        assert (
            temporary_password_client.get("/api/v1/auth/me").json()["must_change_password"] is False
        )

    def test_the_new_password_logs_in_and_the_temporary_one_no_longer_does(
        self, temporary_password_client: TestClient
    ) -> None:
        temporary_password_client.post("/api/v1/auth/complete", json={"new_password": NEW_PASSWORD})
        temporary_password_client.cookies.clear()

        assert login(temporary_password_client, "bea", "temporary-pass").status_code == 401
        assert login(temporary_password_client, "bea", NEW_PASSWORD).status_code == 204

    def test_the_temporary_password_cannot_be_chosen_again(
        self, temporary_password_client: TestClient
    ) -> None:
        response = temporary_password_client.post(
            "/api/v1/auth/complete", json={"new_password": "temporary-pass"}
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "password_unchanged"
        assert temporary_password_client.get("/api/v1/tasks").status_code == 403

    def test_the_new_password_must_meet_the_minimum(
        self, temporary_password_client: TestClient
    ) -> None:
        response = temporary_password_client.post(
            "/api/v1/auth/complete", json={"new_password": "short"}
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_password"

    def test_completing_ends_the_users_other_sessions(
        self, temporary_password_client: TestClient
    ) -> None:
        other_device = temporary_password_client.cookies["tuktuk_session"]
        temporary_password_client.post("/api/v1/auth/complete", json={"new_password": NEW_PASSWORD})

        temporary_password_client.cookies.set("tuktuk_session", other_device)

        assert temporary_password_client.get("/api/v1/auth/me").status_code == 401

    def test_completing_a_profile_sets_username_email_and_password(
        self, incomplete_profile_client: TestClient
    ) -> None:
        response = incomplete_profile_client.post(
            "/api/v1/auth/complete",
            json={"username": "ana", "email": "ana@example.com", "new_password": NEW_PASSWORD},
        )

        assert response.status_code == 204
        me = incomplete_profile_client.get("/api/v1/auth/me").json()
        assert (me["username"], me["email"], me["must_complete_profile"]) == (
            "ana",
            "ana@example.com",
            False,
        )
        assert incomplete_profile_client.get("/api/v1/tasks").status_code == 200

    def test_completing_a_profile_needs_a_username_and_an_email(
        self, incomplete_profile_client: TestClient
    ) -> None:
        response = incomplete_profile_client.post(
            "/api/v1/auth/complete", json={"new_password": NEW_PASSWORD}
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "profile_required"

    def test_a_taken_email_is_reported_on_its_field(
        self, incomplete_profile_client: TestClient
    ) -> None:
        create_user_row(incomplete_profile_client, "bea", "bea@example.com")

        response = incomplete_profile_client.post(
            "/api/v1/auth/complete",
            json={"username": "ana", "email": "BEA@example.com", "new_password": NEW_PASSWORD},
        )

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "email_taken"

    def test_an_invalid_email_is_rejected(self, incomplete_profile_client: TestClient) -> None:
        response = incomplete_profile_client.post(
            "/api/v1/auth/complete",
            json={"username": "ana", "email": "not-an-email", "new_password": NEW_PASSWORD},
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_email"

    def test_there_is_nothing_to_complete_without_a_pending_step(self, client: TestClient) -> None:
        response = client.post("/api/v1/auth/complete", json={"new_password": NEW_PASSWORD})

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "no_pending_step"


class TestLogout:
    def test_returns_204_with_no_body_and_clears_the_cookie(self, client: TestClient) -> None:
        response = client.post("/api/v1/auth/logout")

        assert response.status_code == 204
        assert response.content == b""
        set_cookie = response.headers["set-cookie"].lower()
        assert "tuktuk_session=" in set_cookie
        assert "max-age=0" in set_cookie

    def test_subsequent_requests_are_rejected(self, client: TestClient) -> None:
        client.post("/api/v1/auth/logout")

        assert client.get("/api/v1/tasks").status_code == 401

    def test_is_rejected_without_a_session(self, unauthenticated_client: TestClient) -> None:
        assert unauthenticated_client.post("/api/v1/auth/logout").status_code == 401

    def test_the_deletion_samesite_matches_the_set_samesite(self, client: TestClient) -> None:
        response = client.post("/api/v1/auth/logout")

        assert "samesite=lax" in response.headers["set-cookie"].lower()


def admin_token(client: TestClient, issued_at: datetime) -> str:
    return issue_session_token(session_key(client), user_id=1, epoch=0, issued_at=issued_at)


class TestRollingReissue:
    def test_a_session_older_than_the_threshold_is_reissued_with_a_fresh_cookie(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        settings = unauthenticated_client.app.state.settings  # type: ignore[attr-defined]
        issued_at = fake_clock.now
        old_token = admin_token(unauthenticated_client, issued_at)
        unauthenticated_client.cookies.set("tuktuk_session", old_token)
        fake_clock.advance(timedelta(days=settings.auth_session_reissue_threshold_days, hours=1))

        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 200
        new_token = response.cookies["tuktuk_session"]
        assert new_token != old_token
        claims = verify_session_token(
            new_token, session_key(unauthenticated_client), settings, fake_clock
        )
        assert claims is not None
        assert claims.issued_at > issued_at
        assert (claims.user_id, claims.epoch) == (1, 0)

    def test_a_fresh_session_is_not_reissued(self, client: TestClient) -> None:
        assert "tuktuk_session" not in client.get("/api/v1/tasks").cookies

    def test_a_session_still_within_the_reissue_threshold_is_not_reissued(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        unauthenticated_client.cookies.set(
            "tuktuk_session", admin_token(unauthenticated_client, fake_clock.now)
        )
        fake_clock.advance(timedelta(hours=23))

        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 200
        assert "tuktuk_session" not in response.cookies

    def test_a_session_used_regularly_over_longer_than_the_lifetime_never_expires(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        unauthenticated_client.cookies.set(
            "tuktuk_session", admin_token(unauthenticated_client, fake_clock.now)
        )

        # A request every couple of days, well past the 30-day lifetime.
        for _ in range(20):
            fake_clock.advance(timedelta(days=2))
            response = unauthenticated_client.get("/api/v1/tasks")
            assert response.status_code == 200
            if "tuktuk_session" in response.cookies:
                unauthenticated_client.cookies.set(
                    "tuktuk_session", response.cookies["tuktuk_session"]
                )

    def test_a_session_unused_for_longer_than_the_lifetime_is_rejected_and_not_resurrected(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        settings = unauthenticated_client.app.state.settings  # type: ignore[attr-defined]
        unauthenticated_client.cookies.set(
            "tuktuk_session", admin_token(unauthenticated_client, fake_clock.now)
        )
        fake_clock.advance(timedelta(days=settings.auth_session_lifetime_days + 1))

        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 401
        assert "tuktuk_session" not in response.cookies

    def test_a_reissued_cookie_carries_the_same_attributes_as_a_fresh_one(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        settings = unauthenticated_client.app.state.settings  # type: ignore[attr-defined]
        unauthenticated_client.cookies.set(
            "tuktuk_session", admin_token(unauthenticated_client, fake_clock.now)
        )
        fake_clock.advance(timedelta(days=settings.auth_session_reissue_threshold_days, hours=1))

        response = unauthenticated_client.get("/api/v1/tasks")

        set_cookie = response.headers["set-cookie"].lower()
        assert "httponly" in set_cookie
        assert "samesite=lax" in set_cookie
        assert "path=/" in set_cookie

    def test_a_session_due_for_reissue_stays_signed_in_after_changing_the_password(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        """The route's fresh cookie (new epoch) must not be overwritten by
        the rolling reissue's copy of the old one (issue #475)."""
        settings = client.app.state.settings  # type: ignore[attr-defined]
        fake_clock.advance(timedelta(days=settings.auth_session_reissue_threshold_days, hours=1))

        assert change_password(client, TEST_PASSWORD, NEW_PASSWORD).status_code == 204

        assert client.get("/api/v1/tasks").status_code == 200

    def test_a_session_due_for_reissue_stays_signed_in_after_a_forced_step(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        settings = client.app.state.settings  # type: ignore[attr-defined]
        temporary = "a-temporary-password"
        create_user_row(
            client, "bea", "bea@example.com", password=temporary, must_change_password=True
        )
        client.cookies.clear()
        log_in(client, "bea", temporary)
        fake_clock.advance(timedelta(days=settings.auth_session_reissue_threshold_days, hours=1))

        completed = client.post("/api/v1/auth/complete", json={"new_password": NEW_PASSWORD})
        assert completed.status_code == 204

        assert client.get("/api/v1/tasks").status_code == 200


class TestChangePassword:
    def test_the_correct_current_password_returns_204_with_a_fresh_cookie(
        self, client: TestClient
    ) -> None:
        response = change_password(client, TEST_PASSWORD, NEW_PASSWORD)

        assert response.status_code == 204
        assert response.content == b""
        assert "tuktuk_session" in response.cookies

    def test_bumps_the_session_epoch_and_leaves_the_signing_key_alone(
        self, client: TestClient
    ) -> None:
        old_key = session_key(client)

        change_password(client, TEST_PASSWORD, NEW_PASSWORD)

        assert user_row(client, 1).session_epoch == 1  # type: ignore[arg-type]
        assert session_key(client) == old_key

    def test_the_device_that_changed_the_password_stays_logged_in(self, client: TestClient) -> None:
        change_password(client, TEST_PASSWORD, NEW_PASSWORD)

        assert client.get("/api/v1/tasks").status_code == 200

    def test_the_users_other_sessions_are_rejected_after_the_change(
        self, client: TestClient
    ) -> None:
        other_device = client.cookies["tuktuk_session"]

        change_password(client, TEST_PASSWORD, NEW_PASSWORD)

        client.cookies.set("tuktuk_session", other_device)
        assert client.get("/api/v1/tasks").status_code == 401

    def test_another_users_session_survives_the_change(
        self, unauthenticated_client: TestClient
    ) -> None:
        create_user_row(unauthenticated_client, "bea", "bea@example.com", password="bea-password")
        log_in(unauthenticated_client, "bea", "bea-password")
        beas_session = unauthenticated_client.cookies["tuktuk_session"]
        unauthenticated_client.cookies.clear()
        log_in(unauthenticated_client)

        change_password(unauthenticated_client, TEST_PASSWORD, NEW_PASSWORD)

        unauthenticated_client.cookies.set("tuktuk_session", beas_session)
        assert unauthenticated_client.get("/api/v1/tasks").status_code == 200

    def test_the_new_password_logs_in_after_the_change(self, client: TestClient) -> None:
        change_password(client, TEST_PASSWORD, NEW_PASSWORD)
        client.cookies.clear()

        assert login(client, TEST_USERNAME, NEW_PASSWORD).status_code == 204
        assert login(client, TEST_USERNAME, TEST_PASSWORD).status_code == 401

    def test_the_wrong_current_password_is_rejected_and_changes_nothing(
        self, client: TestClient
    ) -> None:
        response = change_password(client, "wrong", NEW_PASSWORD)

        assert response.status_code == 400
        assert response.json()["error"]["code"] == "invalid_current_password"
        assert user_row(client, 1).session_epoch == 0  # type: ignore[arg-type]
        client.cookies.clear()
        assert login(client, TEST_USERNAME, TEST_PASSWORD).status_code == 204

    def test_consecutive_wrong_current_password_failures_escalate_and_success_resets(
        self, client: TestClient
    ) -> None:
        for _ in range(3):
            assert change_password(client, "wrong", NEW_PASSWORD).status_code == 400

        assert change_password(client, TEST_PASSWORD, NEW_PASSWORD).status_code == 204

    def test_an_empty_new_password_is_rejected(self, client: TestClient) -> None:
        assert change_password(client, TEST_PASSWORD, "").status_code == 422

    def test_a_new_password_shorter_than_the_minimum_is_rejected(self, client: TestClient) -> None:
        response = change_password(client, TEST_PASSWORD, "short")

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_password"
        assert "12" in response.json()["error"]["message"]
        assert user_row(client, 1).session_epoch == 0  # type: ignore[arg-type]

    def test_a_new_password_of_exactly_the_minimum_length_is_accepted(
        self, client: TestClient
    ) -> None:
        assert change_password(client, TEST_PASSWORD, "123456789012").status_code == 204

    def test_is_rejected_without_a_session(self, unauthenticated_client: TestClient) -> None:
        response = change_password(unauthenticated_client, TEST_PASSWORD, NEW_PASSWORD)

        assert response.status_code == 401


class TestAuthDisabled:
    def disabled_app(self, database_url: str, fake_clock: FakeClock) -> TestClient:
        settings = Settings(database_url=database_url, auth_disabled=True, app_env="development")
        return TestClient(create_app(settings, clock=fake_clock))

    def test_acts_as_the_first_admin_without_a_session(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with self.disabled_app(database_url, fake_clock) as client:
            create_user_row(client, "bea", "bea@example.com")
            create_user_row(client, is_admin=True)

            response = client.get("/api/v1/auth/me")

        assert response.status_code == 200
        assert response.json()["username"] == TEST_USERNAME

    def test_data_endpoints_and_docs_accept_a_request_without_a_session(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with self.disabled_app(database_url, fake_clock) as client:
            create_user_row(client, is_admin=True)

            assert client.get("/api/v1/tasks").status_code == 200
            assert client.get("/api/v1/auth/session").status_code == 204
            assert client.get("/docs").status_code == 200

    def test_a_pending_forced_step_does_not_gate(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with self.disabled_app(database_url, fake_clock) as client:
            create_user_row(client, is_admin=True, must_change_password=True)

            assert client.get("/api/v1/tasks").status_code == 200

    def test_a_served_request_marks_the_first_admin_active(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        """Like any other served request (issue #478), so the admin list
        doesn't show the account in use as never active."""
        with self.disabled_app(database_url, fake_clock) as client:
            create_user_row(client, is_admin=True)
            fake_clock.advance(timedelta(days=2))

            users = client.get("/api/v1/admin/users").json()["items"]

        assert datetime.fromisoformat(users[0]["last_active_at"]) == fake_clock.now

    def test_with_no_user_yet_setup_is_still_required(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with self.disabled_app(database_url, fake_clock) as client:
            response = client.get("/api/v1/tasks")

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "setup_required"

    def test_flag_off_still_enforces_auth(self, client: TestClient) -> None:
        client.cookies.clear()

        assert client.get("/api/v1/tasks").status_code == 401
