"""The short-lived Events cache in front of Google (issue #109), keyed per
user as well as per calendar and window (issue #409)."""

from datetime import UTC, datetime

from app.calendar_source import CalendarEventEntry
from app.event_cache import EventCache
from tests.conftest import FakeClock

WINDOW = ("2026-01-01T00:00:00Z", "2026-01-08T00:00:00Z")
EVENT = CalendarEventEntry(
    google_event_id="e-1",
    summary="Stand-up",
    start="2026-01-02T09:00:00Z",
    end="2026-01-02T09:15:00Z",
    is_all_day=False,
)


def test_one_users_entries_are_never_served_to_another_with_the_same_calendar() -> None:
    """Two users can each connect a calendar Google calls "primary"."""
    cache = EventCache(clock=FakeClock(datetime(2026, 1, 1, tzinfo=UTC)))

    cache.set(1, "primary", *WINDOW, [EVENT])

    assert cache.get(1, "primary", *WINDOW) == [EVENT]
    assert cache.get(2, "primary", *WINDOW) is None
