"""Login, the session probe, and default-deny enforcement (ADR 0005,
issues #83 and #84).
"""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.config import Settings
from app.session import issue_session_token, verify_session_token
from tests.conftest import TEST_PASSWORD, FakeClock


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
        # The base delay is zeroed in tests (conftest), so this exercises the
        # throttle's bookkeeping without costing wall-clock time. We can't
        # observe the delay directly over HTTP, so this just proves the
        # sequence of outcomes: repeated failures, then a reset via success,
        # then a fresh failure is once again treated as first-in-sequence
        # (indirectly, by the login continuing to work at all afterwards).
        for _ in range(3):
            failed = unauthenticated_client.post("/api/v1/auth/login", json={"password": "wrong"})
            assert failed.status_code == 401

        success = unauthenticated_client.post(
            "/api/v1/auth/login", json={"password": TEST_PASSWORD}
        )
        assert success.status_code == 204


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
        forged = issue_session_token(
            Settings(secret_key="a-different-key"), issued_at=datetime.now(UTC)
        )
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
        issued_at = fake_clock.now
        old_token = issue_session_token(settings, issued_at=issued_at)
        unauthenticated_client.cookies.set("tuktuk_session", old_token)
        fake_clock.advance(timedelta(days=settings.auth_session_reissue_threshold_days, hours=1))

        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 200
        new_token = response.cookies["tuktuk_session"]
        assert new_token != old_token
        reissued_at = verify_session_token(new_token, settings, fake_clock)
        assert reissued_at is not None
        assert reissued_at > issued_at

    def test_a_fresh_session_is_not_reissued(self, client: TestClient) -> None:
        first_response = client.get("/api/v1/tasks")

        assert "tuktuk_session" not in first_response.cookies

    def test_a_session_still_within_the_reissue_threshold_is_not_reissued(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        settings = unauthenticated_client.app.state.settings  # type: ignore[attr-defined]
        token = issue_session_token(settings, issued_at=fake_clock.now)
        unauthenticated_client.cookies.set("tuktuk_session", token)
        fake_clock.advance(timedelta(hours=23))

        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 200
        assert "tuktuk_session" not in response.cookies

    def test_a_session_used_regularly_over_longer_than_the_lifetime_never_expires(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        settings = unauthenticated_client.app.state.settings  # type: ignore[attr-defined]
        token = issue_session_token(settings, issued_at=fake_clock.now)
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
        token = issue_session_token(settings, issued_at=fake_clock.now)
        unauthenticated_client.cookies.set("tuktuk_session", token)
        fake_clock.advance(timedelta(days=settings.auth_session_lifetime_days + 1))

        response = unauthenticated_client.get("/api/v1/tasks")

        assert response.status_code == 401
        assert "tuktuk_session" not in response.cookies

    def test_a_reissued_cookie_carries_the_same_attributes_as_a_fresh_one(
        self, unauthenticated_client: TestClient, fake_clock: FakeClock
    ) -> None:
        settings = unauthenticated_client.app.state.settings  # type: ignore[attr-defined]
        token = issue_session_token(settings, issued_at=fake_clock.now)
        unauthenticated_client.cookies.set("tuktuk_session", token)
        fake_clock.advance(timedelta(days=settings.auth_session_reissue_threshold_days, hours=1))

        response = unauthenticated_client.get("/api/v1/tasks")

        set_cookie = response.headers["set-cookie"].lower()
        assert "httponly" in set_cookie
        assert "samesite=lax" in set_cookie
        assert "path=/" in set_cookie
