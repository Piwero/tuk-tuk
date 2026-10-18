"""Login, the session probe, default-deny enforcement (ADR 0005, issues
#83 and #84), and the change-password flow (ADR 0008, issue #116).
"""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.config import Settings
from app.login_throttle import LoginThrottle
from app.main import create_app
from app.session import issue_session_token, verify_session_token
from tests.conftest import TEST_PASSWORD, FakeClock, app_settings_row


class TestLogin:
    def test_the_correct_password_returns_204_with_no_body_and_a_session_cookie(
        self, unauthenticated_client: TestClient
    ) -> None:
        response = unauthenticated_client.post(
            "/api/v1/auth/login", json={"password": TEST_PASSWORD}
        )

        assert response.status_code == 204
        assert response.content == b""
        assert "tuktuk_session" in response.cookies

    def test_the_cookie_is_httponly_and_samesite_lax(
        self, unauthenticated_client: TestClient
    ) -> None:
        response = unauthenticated_client.post(
            "/api/v1/auth/login", json={"password": TEST_PASSWORD}
        )

        set_cookie = response.headers["set-cookie"].lower()
        assert "httponly" in set_cookie
        assert "samesite=lax" in set_cookie
        assert "path=/" in set_cookie

    def test_the_wrong_password_is_rejected_with_the_error_envelope(
        self, unauthenticated_client: TestClient
    ) -> None:
        response = unauthenticated_client.post("/api/v1/auth/login", json={"password": "wrong"})

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "invalid_credentials"
        assert "tuktuk_session" not in response.cookies

    def test_consecutive_failures_escalate_and_success_resets(
        self, unauthenticated_client: TestClient
    ) -> None:
        # The base delay is zeroed in tests (conftest), so a locked-out
        # response is immediate; the lockout isn't engaged until the
        # threshold in TestLockout below. This proves the sequence of
        # outcomes: repeated failures, then a reset via success, then a
        # fresh failure is once again treated as first-in-sequence
        # (indirectly, by the login continuing to work at all afterwards).
        for _ in range(3):
            failed = unauthenticated_client.post("/api/v1/auth/login", json={"password": "wrong"})
            assert failed.status_code == 401

        success = unauthenticated_client.post(
            "/api/v1/auth/login", json={"password": TEST_PASSWORD}
        )
        assert success.status_code == 204


LOCKOUT_THRESHOLD = 5  # keep in sync with app.routers.v1.auth.LOCKOUT_THRESHOLD


class TestLockout:
    def test_enough_consecutive_failures_locks_login(
        self, unauthenticated_client: TestClient
    ) -> None:
        for _ in range(LOCKOUT_THRESHOLD):
            unauthenticated_client.post("/api/v1/auth/login", json={"password": "wrong"})

        response = unauthenticated_client.post(
            "/api/v1/auth/login", json={"password": TEST_PASSWORD}
        )

        assert response.status_code == 429
        assert response.json()["error"]["code"] == "too_many_attempts"
        assert "Retry-After" in response.headers

    def test_a_locked_login_does_not_verify_the_password(
        self, unauthenticated_client: TestClient
    ) -> None:
        for _ in range(LOCKOUT_THRESHOLD):
            unauthenticated_client.post("/api/v1/auth/login", json={"password": "wrong"})

        # Even the *correct* password is refused while locked — the lock
        # is answered before verification ever runs.
        response = unauthenticated_client.post(
            "/api/v1/auth/login", json={"password": TEST_PASSWORD}
        )

        assert response.status_code == 429
        assert "tuktuk_session" not in response.cookies

    def test_advancing_the_clock_past_the_lock_lets_login_work_again(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        for _ in range(LOCKOUT_THRESHOLD):
            unauthenticated_client.post("/api/v1/auth/login", json={"password": "wrong"})
        locked = unauthenticated_client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})
        assert locked.status_code == 429

        fake_clock.advance(timedelta(seconds=LoginThrottle.CAP_SECONDS + 1))

        response = unauthenticated_client.post(
            "/api/v1/auth/login", json={"password": TEST_PASSWORD}
        )

        assert response.status_code == 204

    def test_a_successful_login_clears_the_count_and_the_lock(
        self, unauthenticated_client: TestClient
    ) -> None:
        for _ in range(LOCKOUT_THRESHOLD - 1):
            unauthenticated_client.post("/api/v1/auth/login", json={"password": "wrong"})

        success = unauthenticated_client.post(
            "/api/v1/auth/login", json={"password": TEST_PASSWORD}
        )
        assert success.status_code == 204

        row = app_settings_row(unauthenticated_client.app)  # type: ignore[arg-type]
        assert row.login_failed_attempts == 0
        assert row.login_locked_until is None

    def test_the_lock_survives_a_second_app_built_over_the_same_database(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        first_app = create_app(Settings(database_url=database_url), clock=fake_clock)
        with TestClient(first_app) as first_client:
            for _ in range(LOCKOUT_THRESHOLD):
                first_client.post("/api/v1/auth/login", json={"password": "wrong"})

        second_app = create_app(Settings(database_url=database_url), clock=fake_clock)
        with TestClient(second_app) as second_client:
            response = second_client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})

        assert response.status_code == 429
        assert response.json()["error"]["code"] == "too_many_attempts"

    def test_change_passwords_current_password_check_feeds_the_same_lock(
        self, client: TestClient
    ) -> None:
        for _ in range(LOCKOUT_THRESHOLD):
            client.post(
                "/api/v1/auth/password",
                json={"current_password": "wrong", "new_password": NEW_PASSWORD},
            )

        response = client.post(
            "/api/v1/auth/password",
            json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
        )

        assert response.status_code == 429
        assert response.json()["error"]["code"] == "too_many_attempts"


class TestSessionProbe:
    def test_returns_204_with_a_valid_session(self, client: TestClient) -> None:
        response = client.get("/api/v1/auth/session")

        assert response.status_code == 204

    def test_is_rejected_without_a_session(self, unauthenticated_client: TestClient) -> None:
        response = unauthenticated_client.get("/api/v1/auth/session")

        assert response.status_code == 401


class TestEnforcement:
    def test_health_is_reachable_without_a_session(
        self, unauthenticated_client: TestClient
    ) -> None:
        response = unauthenticated_client.get("/health")

        assert response.status_code == 200

    def test_a_data_endpoint_rejects_a_request_without_a_session(
        self, unauthenticated_client: TestClient
    ) -> None:
        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"

    def test_a_data_endpoint_accepts_a_request_with_a_valid_session(
        self, client: TestClient
    ) -> None:
        response = client.get("/api/v1/tasks")

        assert response.status_code == 200

    def test_the_openapi_schema_requires_a_session(
        self, unauthenticated_client: TestClient
    ) -> None:
        response = unauthenticated_client.get("/openapi.json")

        assert response.status_code == 401

    def test_the_interactive_docs_require_a_session(
        self, unauthenticated_client: TestClient
    ) -> None:
        response = unauthenticated_client.get("/docs")

        assert response.status_code == 401

    def test_a_malformed_cookie_is_rejected(self, unauthenticated_client: TestClient) -> None:
        unauthenticated_client.cookies.set("tuktuk_session", "not-a-real-token")

        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 401

    def test_a_cookie_signed_with_a_different_key_is_rejected(
        self, unauthenticated_client: TestClient
    ) -> None:
        forged = issue_session_token("a-different-key", issued_at=datetime.now(UTC))
        unauthenticated_client.cookies.set("tuktuk_session", forged)

        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 401

    def test_a_path_merely_prefixed_by_an_allowlisted_one_is_not_opened(
        self, unauthenticated_client: TestClient
    ) -> None:
        response = unauthenticated_client.get("/health-check")

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"


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

        response = client.get("/api/v1/tasks")

        assert response.status_code == 401

    def test_is_rejected_without_a_session(self, unauthenticated_client: TestClient) -> None:
        response = unauthenticated_client.post("/api/v1/auth/logout")

        assert response.status_code == 401


class TestRollingReissue:
    def test_a_session_older_than_the_threshold_is_reissued_with_a_fresh_cookie(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        settings = unauthenticated_client.app.state.settings  # type: ignore[attr-defined]
        session_key = app_settings_row(unauthenticated_client.app).session_key  # type: ignore[arg-type]
        issued_at = fake_clock.now
        old_token = issue_session_token(session_key, issued_at=issued_at)
        unauthenticated_client.cookies.set("tuktuk_session", old_token)
        fake_clock.advance(timedelta(days=settings.auth_session_reissue_threshold_days, hours=1))

        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 200
        new_token = response.cookies["tuktuk_session"]
        assert new_token != old_token
        reissued_at = verify_session_token(new_token, session_key, settings, fake_clock)
        assert reissued_at is not None
        assert reissued_at > issued_at

    def test_a_fresh_session_is_not_reissued(self, client: TestClient) -> None:
        first_response = client.get("/api/v1/tasks")

        assert "tuktuk_session" not in first_response.cookies

    def test_a_session_still_within_the_reissue_threshold_is_not_reissued(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        session_key = app_settings_row(unauthenticated_client.app).session_key  # type: ignore[arg-type]
        token = issue_session_token(session_key, issued_at=fake_clock.now)
        unauthenticated_client.cookies.set("tuktuk_session", token)
        fake_clock.advance(timedelta(hours=23))

        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 200
        assert "tuktuk_session" not in response.cookies

    def test_a_session_used_regularly_over_longer_than_the_lifetime_never_expires(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        session_key = app_settings_row(unauthenticated_client.app).session_key  # type: ignore[arg-type]
        token = issue_session_token(session_key, issued_at=fake_clock.now)
        unauthenticated_client.cookies.set("tuktuk_session", token)

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
        session_key = app_settings_row(unauthenticated_client.app).session_key  # type: ignore[arg-type]
        token = issue_session_token(session_key, issued_at=fake_clock.now)
        unauthenticated_client.cookies.set("tuktuk_session", token)
        fake_clock.advance(timedelta(days=settings.auth_session_lifetime_days + 1))

        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 401
        assert "tuktuk_session" not in response.cookies

    def test_a_reissued_cookie_carries_the_same_attributes_as_a_fresh_one(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        settings = unauthenticated_client.app.state.settings  # type: ignore[attr-defined]
        session_key = app_settings_row(unauthenticated_client.app).session_key  # type: ignore[arg-type]
        token = issue_session_token(session_key, issued_at=fake_clock.now)
        unauthenticated_client.cookies.set("tuktuk_session", token)
        fake_clock.advance(timedelta(days=settings.auth_session_reissue_threshold_days, hours=1))

        response = unauthenticated_client.get("/api/v1/tasks")

        set_cookie = response.headers["set-cookie"].lower()
        assert "httponly" in set_cookie
        assert "samesite=lax" in set_cookie
        assert "path=/" in set_cookie


NEW_PASSWORD = "a-new-password"


class TestChangePassword:
    def test_the_correct_current_password_updates_the_hash_and_returns_204_with_a_fresh_cookie(
        self, client: TestClient
    ) -> None:
        old_hash = app_settings_row(client.app).password_hash  # type: ignore[arg-type]

        response = client.post(
            "/api/v1/auth/password",
            json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
        )

        assert response.status_code == 204
        assert response.content == b""
        assert "tuktuk_session" in response.cookies
        assert app_settings_row(client.app).password_hash != old_hash  # type: ignore[arg-type]

    def test_the_session_key_is_rotated(self, client: TestClient) -> None:
        old_key = app_settings_row(client.app).session_key  # type: ignore[arg-type]

        client.post(
            "/api/v1/auth/password",
            json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
        )

        assert app_settings_row(client.app).session_key != old_key  # type: ignore[arg-type]

    def test_the_device_that_changed_the_password_stays_logged_in(self, client: TestClient) -> None:
        change_response = client.post(
            "/api/v1/auth/password",
            json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
        )
        client.cookies.set("tuktuk_session", change_response.cookies["tuktuk_session"])

        response = client.get("/api/v1/tasks")

        assert response.status_code == 200

    def test_a_second_devices_session_is_rejected_after_the_change(
        self, unauthenticated_client: TestClient
    ) -> None:
        first_login = unauthenticated_client.post(
            "/api/v1/auth/login", json={"password": TEST_PASSWORD}
        )
        second_device_cookie = first_login.cookies["tuktuk_session"]

        unauthenticated_client.post(
            "/api/v1/auth/password",
            json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
        )

        unauthenticated_client.cookies.set("tuktuk_session", second_device_cookie)
        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 401

    def test_the_new_password_logs_in_after_the_change(
        self, unauthenticated_client: TestClient
    ) -> None:
        unauthenticated_client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})
        unauthenticated_client.post(
            "/api/v1/auth/password",
            json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
        )
        unauthenticated_client.cookies.clear()

        response = unauthenticated_client.post(
            "/api/v1/auth/login", json={"password": NEW_PASSWORD}
        )

        assert response.status_code == 204

    def test_the_wrong_current_password_is_rejected_and_changes_nothing(
        self, client: TestClient
    ) -> None:
        old_hash = app_settings_row(client.app).password_hash  # type: ignore[arg-type]
        old_key = app_settings_row(client.app).session_key  # type: ignore[arg-type]

        response = client.post(
            "/api/v1/auth/password",
            json={"current_password": "wrong", "new_password": NEW_PASSWORD},
        )

        assert response.status_code != 204
        assert response.json()["error"]["code"] == "invalid_current_password"
        row = app_settings_row(client.app)  # type: ignore[arg-type]
        assert row.password_hash == old_hash
        assert row.session_key == old_key

    def test_consecutive_wrong_current_password_failures_escalate_and_success_resets(
        self, client: TestClient
    ) -> None:
        for _ in range(3):
            failed = client.post(
                "/api/v1/auth/password",
                json={"current_password": "wrong", "new_password": NEW_PASSWORD},
            )
            assert failed.status_code != 204

        success = client.post(
            "/api/v1/auth/password",
            json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
        )
        assert success.status_code == 204

    def test_an_empty_new_password_is_rejected(self, client: TestClient) -> None:
        old_hash = app_settings_row(client.app).password_hash  # type: ignore[arg-type]

        response = client.post(
            "/api/v1/auth/password",
            json={"current_password": TEST_PASSWORD, "new_password": ""},
        )

        assert response.status_code == 422
        assert app_settings_row(client.app).password_hash == old_hash  # type: ignore[arg-type]

    def test_is_rejected_without_a_session(self, unauthenticated_client: TestClient) -> None:
        response = unauthenticated_client.post(
            "/api/v1/auth/password",
            json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD},
        )

        assert response.status_code == 401


class TestAuthDisabled:
    def disabled_client(
        self, database_url: str, fake_clock: FakeClock, password_hash: str | None = None
    ) -> TestClient:
        app = create_app(
            Settings(
                database_url=database_url, auth_password_hash=password_hash, auth_disabled=True
            ),
            clock=fake_clock,
        )
        return TestClient(app)

    def test_data_endpoint_accepts_request_without_session(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with self.disabled_client(database_url, fake_clock) as client:
            response = client.get("/api/v1/tasks")

        assert response.status_code == 200

    def test_session_probe_accepts_request_without_session(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with self.disabled_client(database_url, fake_clock) as client:
            response = client.get("/api/v1/auth/session")

        assert response.status_code == 204

    def test_docs_accept_request_without_session(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with self.disabled_client(database_url, fake_clock) as client:
            response = client.get("/docs")

        assert response.status_code == 200

    def test_no_password_set_yet_does_not_gate(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with self.disabled_client(database_url, fake_clock, password_hash=None) as client:
            response = client.get("/api/v1/tasks")

        assert response.status_code == 200

    def test_flag_off_still_enforces_auth(self, database_url: str, fake_clock: FakeClock) -> None:
        app = create_app(
            Settings(
                database_url=database_url,
                auth_password_hash="an-imported-hash",
                auth_disabled=False,
            ),
            clock=fake_clock,
        )
        with TestClient(app) as client:
            response = client.get("/api/v1/tasks")

        assert response.status_code == 401
