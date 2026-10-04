"""The client's date vocabulary: today, tomorrow, yesterday, bare weekday
names, and full ISO dates, with an optional time appended for timed
scheduling. This is not a port of the frontend's date suggestions and is
not growing toward them — a CLI flag can afford to be unambiguous in a way
a free-text capture box cannot. Whatever is unrecognised errors with the
accepted forms enumerated, so the vocabulary teaches itself.

A bare word yields midnight UTC (the API's date-only convention, like the
ls display path, judged against the caller's local day). A word with a time
yields that local time in the caller's zone. The scheduling invariants stay
the API's — the client forwards whatever it parsed and surfaces the API's
message.
"""

from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

ACCEPTED_FORMS = (
    "today, tomorrow, yesterday, a weekday name (e.g. monday), "
    "or an ISO date (YYYY-MM-DD), optionally with a time (HH:MM)"
)

_WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


class BadDateError(Exception):
    pass


def _miss(word: str) -> BadDateError:
    return BadDateError(f"Could not understand date {word!r} — use {ACCEPTED_FORMS}")


def parse_date(word: str, today: date, zone: ZoneInfo) -> datetime:
    """Parse one date word against the caller's local day and zone."""
    head, space, tail = word.strip().partition(" ")
    if space:
        try:
            clock = time.fromisoformat(tail.strip())
        except ValueError:
            raise _miss(word) from None
        day = _bare_day(head, today)
        if day is None:
            raise _miss(word)
        return datetime.combine(day, clock).replace(tzinfo=zone)
    day = _bare_day(head, today)
    if day is None:
        raise _miss(word)
    return datetime.combine(day, time(0, 0)).replace(tzinfo=UTC)


def _bare_day(head: str, today: date) -> date | None:
    lowered = head.casefold()
    if lowered == "today":
        return today
    if lowered == "tomorrow":
        return date.fromordinal(today.toordinal() + 1)
    if lowered == "yesterday":
        return date.fromordinal(today.toordinal() - 1)
    if lowered in _WEEKDAYS:
        ahead = (_WEEKDAYS[lowered] - today.weekday()) % 7 or 7
        return date.fromordinal(today.toordinal() + ahead)
    try:
        return date.fromisoformat(head)
    except ValueError:
        return None
