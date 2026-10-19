"""Global escalating-but-capped login lockout (ADR 0005, issue #339).

Pure arithmetic: given a failure count and the current instant, returns
the instant until which login should be locked. No database, no HTTP —
persistence is the router's job (app.routers.v1.auth).
"""

from datetime import UTC, datetime, timedelta

from app.login_throttle import LoginThrottle


class TestLoginThrottle:
    def test_the_first_failure_locks_for_the_base_duration(self) -> None:
        now = datetime(2026, 1, 1, tzinfo=UTC)

        locked_until = LoginThrottle.lock_until(failure_count=1, now=now, base_seconds=1.0)

        assert locked_until == now + timedelta(seconds=1.0)

    def test_each_additional_failure_escalates_the_lock_duration(self) -> None:
        now = datetime(2026, 1, 1, tzinfo=UTC)

        first = LoginThrottle.lock_until(failure_count=1, now=now, base_seconds=1.0)
        second = LoginThrottle.lock_until(failure_count=2, now=now, base_seconds=1.0)
        third = LoginThrottle.lock_until(failure_count=3, now=now, base_seconds=1.0)

        assert first < second < third

    def test_the_lock_duration_is_capped_rather_than_unbounded(self) -> None:
        now = datetime(2026, 1, 1, tzinfo=UTC)

        locked_until = LoginThrottle.lock_until(failure_count=50, now=now, base_seconds=1.0)

        assert locked_until == now + timedelta(seconds=LoginThrottle.CAP_SECONDS)

    def test_a_zero_base_never_locks_even_after_many_failures(self) -> None:
        now = datetime(2026, 1, 1, tzinfo=UTC)

        locked_until = LoginThrottle.lock_until(failure_count=10, now=now, base_seconds=0.0)

        assert locked_until == now
