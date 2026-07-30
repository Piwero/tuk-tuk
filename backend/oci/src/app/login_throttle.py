"""Global consecutive-failure delay for the login endpoint (ADR 0005).

Global rather than per-client: the request chain (CDN, ingress, reverse
proxy) is never trusted for a real client address, and with exactly one
legitimate user a global counter is nearly equivalent to a per-user one.
"""


class LoginThrottle:
    # Escalates but never locks the legitimate user out entirely; 30s is
    # long enough to blunt brute-forcing without making a mistyped
    # password practically unrecoverable.
    CAP_SECONDS = 30.0

    def __init__(self) -> None:
        self._consecutive_failures = 0

    def record_failure(self, base: float) -> float:
        delay = min(base * (2**self._consecutive_failures), self.CAP_SECONDS)
        self._consecutive_failures += 1
        return float(delay)

    def record_success(self) -> None:
        self._consecutive_failures = 0
