"""Pure escalating-but-capped login lockout arithmetic (ADR 0005).

Takes a consecutive-failure count and the current instant, returns the
instant login should stay locked until. No database, no HTTP — reading and
writing the persisted count/lock onto the settings singleton is the
router's job (app.routers.v1.auth), so a restart doesn't reset the counter
(issue #333/#339). Global rather than per-client: the request chain (CDN,
ingress, reverse proxy) is never trusted for a real client address, and
with exactly one legitimate user a global counter is nearly equivalent to
a per-user one.
"""

from datetime import datetime, timedelta


class LoginThrottle:
    # Caps the lock *duration*, not the failure count, so the lock always
    # lifts on its own; 30s is long enough to blunt brute-forcing without
    # making a mistyped password practically unrecoverable.
    CAP_SECONDS = 30.0

    @staticmethod
    def lock_until(*, failure_count: int, now: datetime, base_seconds: float) -> datetime:
        duration = min(base_seconds * (2 ** (failure_count - 1)), LoginThrottle.CAP_SECONDS)
        return now + timedelta(seconds=duration)
