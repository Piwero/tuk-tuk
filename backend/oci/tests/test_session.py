"""Signed session cookie: issue, verify, and rolling reissue (ADR 0005)."""

from datetime import timedelta

from app.config import Settings
from app.session import issue_session_token, needs_reissue, verify_session_token
from tests.conftest import FakeClock


def settings(**overrides: object) -> Settings:
    defaults: dict[str, object] = {
        "secret_key": "test-signing-key",
        "auth_session_lifetime_days": 30,
        "auth_session_reissue_threshold_days": 1,
    }
    defaults.update(overrides)
    return Settings(**defaults)  # type: ignore[arg-type]


class TestIssueAndVerify:
    def test_a_freshly_issued_token_verifies(self, fake_clock: FakeClock) -> None:
        s = settings()
        token = issue_session_token(s, issued_at=fake_clock.now)

        assert verify_session_token(token, s, fake_clock) is not None

    def test_verify_returns_the_issued_at_time(self, fake_clock: FakeClock) -> None:
        s = settings()
        issued_at = fake_clock.now
        token = issue_session_token(s, issued_at=issued_at)
        fake_clock.advance(timedelta(days=1))

        assert verify_session_token(token, s, fake_clock) == issued_at

    def test_a_malformed_token_is_rejected(self, fake_clock: FakeClock) -> None:
        assert verify_session_token("not-a-real-token", settings(), fake_clock) is None

    def test_an_absent_token_is_rejected(self, fake_clock: FakeClock) -> None:
        assert verify_session_token(None, settings(), fake_clock) is None

    def test_a_token_signed_with_a_different_key_is_rejected(self, fake_clock: FakeClock) -> None:
        issuing_settings = settings(secret_key="key-one")
        token = issue_session_token(issuing_settings, issued_at=fake_clock.now)

        verifying_settings = settings(secret_key="key-two")

        assert verify_session_token(token, verifying_settings, fake_clock) is None

    def test_an_expired_token_is_rejected(self, fake_clock: FakeClock) -> None:
        s = settings(auth_session_lifetime_days=30)
        issued_at = fake_clock.now
        token = issue_session_token(s, issued_at=issued_at)
        fake_clock.advance(timedelta(days=31))

        assert verify_session_token(token, s, fake_clock) is None

    def test_a_token_within_the_lifetime_is_accepted(self, fake_clock: FakeClock) -> None:
        s = settings(auth_session_lifetime_days=30)
        issued_at = fake_clock.now
        token = issue_session_token(s, issued_at=issued_at)
        fake_clock.advance(timedelta(days=29))

        assert verify_session_token(token, s, fake_clock) is not None


class TestReissue:
    def test_a_fresh_session_does_not_need_reissue(self, fake_clock: FakeClock) -> None:
        s = settings(auth_session_lifetime_days=30, auth_session_reissue_threshold_days=1)
        issued_at = fake_clock.now
        fake_clock.advance(timedelta(hours=1))

        assert needs_reissue(issued_at, s, fake_clock) is False

    def test_a_session_older_than_the_threshold_needs_reissue(self, fake_clock: FakeClock) -> None:
        s = settings(auth_session_lifetime_days=30, auth_session_reissue_threshold_days=1)
        issued_at = fake_clock.now
        fake_clock.advance(timedelta(days=1, hours=1))

        assert needs_reissue(issued_at, s, fake_clock) is True

    def test_a_session_still_within_the_threshold_does_not_need_reissue(
        self, fake_clock: FakeClock
    ) -> None:
        s = settings(auth_session_lifetime_days=30, auth_session_reissue_threshold_days=1)
        issued_at = fake_clock.now
        fake_clock.advance(timedelta(hours=23))

        assert needs_reissue(issued_at, s, fake_clock) is False

    def test_a_session_well_short_of_expiry_still_needs_reissue_once_past_the_threshold(
        self, fake_clock: FakeClock
    ) -> None:
        """The bug this ticket fixes: reissue used to fire only in the final
        day before expiry. A session that is merely a day old — nowhere near
        its 30-day expiry — must already be eligible for refresh.
        """
        s = settings(auth_session_lifetime_days=30, auth_session_reissue_threshold_days=1)
        issued_at = fake_clock.now
        fake_clock.advance(timedelta(days=2))

        assert needs_reissue(issued_at, s, fake_clock) is True
