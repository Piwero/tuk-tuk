"""Global escalating-but-capped delay on consecutive failed logins (ADR 0005)."""

from app.login_throttle import LoginThrottle


class TestLoginThrottle:
    def test_the_first_failure_delays_by_the_base_amount(self) -> None:
        throttle = LoginThrottle()

        assert throttle.record_failure(base=1.0) == 1.0

    def test_each_consecutive_failure_escalates_the_delay(self) -> None:
        throttle = LoginThrottle()

        first = throttle.record_failure(base=1.0)
        second = throttle.record_failure(base=1.0)
        third = throttle.record_failure(base=1.0)

        assert first < second < third

    def test_the_delay_is_capped_rather_than_unbounded(self) -> None:
        throttle = LoginThrottle()

        for _ in range(50):
            delay = throttle.record_failure(base=1.0)

        assert delay == throttle.CAP_SECONDS

    def test_a_success_resets_the_escalation(self) -> None:
        throttle = LoginThrottle()
        throttle.record_failure(base=1.0)
        throttle.record_failure(base=1.0)

        throttle.record_success()

        assert throttle.record_failure(base=1.0) == 1.0

    def test_a_zero_base_never_delays_even_after_many_failures(self) -> None:
        throttle = LoginThrottle()

        for _ in range(10):
            delay = throttle.record_failure(base=0.0)

        assert delay == 0.0
