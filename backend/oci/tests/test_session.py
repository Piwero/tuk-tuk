"""Signed session cookie: issue, verify, and rolling reissue (ADR 0005)."""

from datetime import UTC, datetime, timedelta

from app.config import Settings
from app.session import issue_session_token, needs_reissue, verify_session_token


def settings(**overrides: object) -> Settings:
    defaults: dict[str, object] = {
        "secret_key": "test-signing-key",
        "auth_session_lifetime_days": 30,
        "auth_session_reissue_threshold_days": 1,
    }
    defaults.update(overrides)
    return Settings(**defaults)  # type: ignore[arg-type]


class TestIssueAndVerify:
    def test_a_freshly_issued_token_verifies(self) -> None:
        s = settings()
        token = issue_session_token(s, issued_at=datetime.now(UTC))

        assert verify_session_token(token, s) is not None

    def test_verify_returns_the_issued_at_time(self) -> None:
        s = settings()
        issued_at = datetime.now(UTC) - timedelta(days=1)
        token = issue_session_token(s, issued_at=issued_at)

        assert verify_session_token(token, s) == issued_at

    def test_a_malformed_token_is_rejected(self) -> None:
        assert verify_session_token("not-a-real-token", settings()) is None

    def test_an_absent_token_is_rejected(self) -> None:
        assert verify_session_token(None, settings()) is None

    def test_a_token_signed_with_a_different_key_is_rejected(self) -> None:
        issuing_settings = settings(secret_key="key-one")
        token = issue_session_token(issuing_settings, issued_at=datetime.now(UTC))

        verifying_settings = settings(secret_key="key-two")

        assert verify_session_token(token, verifying_settings) is None

    def test_an_expired_token_is_rejected(self) -> None:
        s = settings(auth_session_lifetime_days=30)
        issued_at = datetime.now(UTC) - timedelta(days=31)
        token = issue_session_token(s, issued_at=issued_at)

        assert verify_session_token(token, s) is None


class TestReissue:
    def test_a_fresh_session_does_not_need_reissue(self) -> None:
        s = settings(auth_session_lifetime_days=30, auth_session_reissue_threshold_days=1)

        assert needs_reissue(datetime.now(UTC), s) is False

    def test_a_session_near_expiry_needs_reissue(self) -> None:
        s = settings(auth_session_lifetime_days=30, auth_session_reissue_threshold_days=1)
        issued_at = datetime.now(UTC) - timedelta(days=29, hours=12)

        assert needs_reissue(issued_at, s) is True
