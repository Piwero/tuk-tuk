"""Deterministic date/time phrase resolution (ADR 0005; issue #43).

The model (app.assist.parse_capture_extraction) only ever extracts a phrase
like "tomorrow" or "tuesday 3pm" — resolving it into a concrete instant
against the client-supplied local date and timezone is ordinary code, never
model output. A phrase this resolver doesn't recognize returns None, which
the caller treats the same as "no date": Assist only ever adds value, never
subtracts it (ADR 0005).
"""

import re
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

_WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

_TIME_RE = re.compile(r"^(\d{1,2})(?::(\d{2}))?(am|pm)?$")


def _parse_time(words: list[str]) -> time | None:
    """The remaining words after the date portion, joined and matched
    against a bare hour, "hh:mm", or a 12-hour "3pm"/"3:30pm" form. Returns
    None for anything else, including a 24-hour hour out of range."""
    if not words:
        return None
    joined = "".join(words)
    match = _TIME_RE.match(joined)
    if match is None:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    meridiem = match.group(3)
    if meridiem is not None:
        if not 1 <= hour <= 12:
            return None
        if meridiem == "pm" and hour != 12:
            hour += 12
        if meridiem == "am" and hour == 12:
            hour = 0
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return time(hour, minute)


def resolve_date_phrase(
    phrase: str, local_date: date, time_zone: str
) -> tuple[datetime, bool] | None:
    """Resolves `phrase` against the client's `local_date`/`time_zone` into
    (due_date, is_all_day), or None when the phrase isn't one of the closed
    set this tracer-bullet resolver understands (scope guard: dates and
    times only — recurrence, reminders, and anything else are follow-up
    slices). An all-day result is date-only at UTC midnight, matching the
    Task schedule's all-day convention; a timed result carries the client's
    own timezone, matching an ordinarily-scheduled Task.
    """
    try:
        zone = ZoneInfo(time_zone)
    except (KeyError, ValueError):
        return None
    words = [word for word in phrase.strip().lower().split() if word]
    if not words:
        return None

    if words[0] == "today":
        target_date = local_date
        idx = 1
    elif words[0] == "tomorrow":
        target_date = local_date + timedelta(days=1)
        idx = 1
    elif words[0] == "next" and len(words) > 1 and words[1] in _WEEKDAYS:
        delta = (_WEEKDAYS[words[1]] - local_date.weekday()) % 7
        target_date = local_date + timedelta(days=delta if delta != 0 else 7)
        idx = 2
    elif words[0] in _WEEKDAYS:
        delta = (_WEEKDAYS[words[0]] - local_date.weekday()) % 7
        target_date = local_date + timedelta(days=delta)
        idx = 1
    else:
        return None

    remaining = [word for word in words[idx:] if word != "at"]
    if not remaining:
        return datetime.combine(target_date, time(0, 0), tzinfo=UTC), True

    parsed_time = _parse_time(remaining)
    if parsed_time is None:
        return None
    return datetime.combine(target_date, parsed_time, tzinfo=zone), False
