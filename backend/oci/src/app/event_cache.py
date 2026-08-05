"""A short-lived cache directly in front of CalendarSource.list_events
(issue #109). ADR 0006 already commits Events to being fetched live and
never persisted, only "cached briefly in process" — this is that cache: it
absorbs rapid navigation (paging through months) so it doesn't hammer
Google, without turning into a second source of truth. Keyed on the exact
Google calendar and window requested, so it never serves one calendar's
entries for another's, or a wider window's answer for a narrower one.

Reuses the same injected Clock every other freshness/expiry decision in this
app uses (see app.session.Clock), rather than wall-clock time directly, so
tests can drive expiry without sleeping.
"""

from dataclasses import dataclass

from app.calendar_source import CalendarEventEntry
from app.session import Clock

# Long enough that paging back and forth across a few months doesn't refetch
# on every click; short enough that a stale account failure or a real change
# on Google's side is never stuck for long — the toolbar's manual refresh
# exists for exactly the moments a user won't want to wait even this long.
DEFAULT_TTL_SECONDS = 60.0

_CacheKey = tuple[str, str, str]


@dataclass
class _Entry:
    expires_at: float
    events: list[CalendarEventEntry]


class EventCache:
    def __init__(self, clock: Clock, ttl_seconds: float = DEFAULT_TTL_SECONDS) -> None:
        self._clock = clock
        self._ttl_seconds = ttl_seconds
        self._entries: dict[_CacheKey, _Entry] = {}

    def get(
        self, google_calendar_id: str, time_min: str, time_max: str
    ) -> list[CalendarEventEntry] | None:
        entry = self._entries.get((google_calendar_id, time_min, time_max))
        if entry is None or entry.expires_at <= self._clock().timestamp():
            return None
        return entry.events

    def set(
        self,
        google_calendar_id: str,
        time_min: str,
        time_max: str,
        events: list[CalendarEventEntry],
    ) -> None:
        self._entries[(google_calendar_id, time_min, time_max)] = _Entry(
            expires_at=self._clock().timestamp() + self._ttl_seconds, events=events
        )
