"""Deterministic date/time phrase resolution (ADR 0005; issues #43, #46).

The model (app.assist.parse_capture_extraction) only ever extracts a phrase
like "tomorrow"/"mañana" or "tuesday 3pm"/"martes a las 3" — resolving it
into a concrete instant against the client-supplied local date and timezone
is ordinary code, never model output. A phrase this resolver doesn't
recognize returns None, which the caller treats the same as "no date":
Assist only ever adds value, never subtracts it (ADR 0005).

Spanish is first-class alongside English (issue #46): weekday names,
"hoy"/"mañana", "próximo <weekday>"/"el <weekday> que viene" for a forced
next-occurrence, and "a las <time>" are all recognized on equal footing with
their English equivalents. Words are accent-folded before matching so
"miércoles"/"proximo" match regardless of whether the client sent accents.
"""

import re
import unicodedata
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
    "lunes": 0,
    "martes": 1,
    "miercoles": 2,
    "jueves": 3,
    "viernes": 4,
    "sabado": 5,
    "domingo": 6,
}

_ARTICLES = ("el", "la", "los", "las")
_NEXT_MARKERS = ("proximo", "proxima")

_TIME_RE = re.compile(r"^(\d{1,2})(?::(\d{2}))?(am|pm)?$")


def _fold(word: str) -> str:
    """Lowercases and strips accents so "miércoles"/"próximo" match their
    unaccented forms — the client may send either."""
    normalized = unicodedata.normalize("NFD", word.lower())
    return "".join(c for c in normalized if unicodedata.category(c) != "Mn")


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
    words = [_fold(word) for word in phrase.strip().split() if word]
    if not words:
        return None

    idx = 0
    while idx < len(words) and words[idx] in _ARTICLES:
        idx += 1

    is_next = False
    if idx < len(words) and words[idx] in _NEXT_MARKERS:
        is_next = True
        idx += 1

    if idx >= len(words):
        return None

    if words[idx] in ("today", "hoy"):
        target_date = local_date
        idx += 1
    elif words[idx] in ("tomorrow", "manana"):
        target_date = local_date + timedelta(days=1)
        idx += 1
    elif words[idx] == "next" and idx + 1 < len(words) and words[idx + 1] in _WEEKDAYS:
        delta = (_WEEKDAYS[words[idx + 1]] - local_date.weekday()) % 7
        target_date = local_date + timedelta(days=delta if delta != 0 else 7)
        idx += 2
    elif words[idx] in _WEEKDAYS:
        weekday = _WEEKDAYS[words[idx]]
        idx += 1
        # Spanish's forced-next-occurrence marker can trail the weekday
        # too, e.g. "el viernes que viene" alongside the leading form
        # "el próximo viernes" already handled above.
        if idx + 1 < len(words) and words[idx] == "que" and words[idx + 1] == "viene":
            is_next = True
            idx += 2
        delta = (weekday - local_date.weekday()) % 7
        if is_next:
            delta = delta if delta != 0 else 7
        target_date = local_date + timedelta(days=delta)
    else:
        return None

    # Only a leading run of filler words is stripped — "at"/"a las"/"a la"
    # precede the time itself, so unlike the date-word matching above there's
    # no case where one of these legitimately reappears after the time.
    remaining = words[idx:]
    while remaining and remaining[0] in ("at", "a", "las", "la"):
        remaining = remaining[1:]
    if not remaining:
        return datetime.combine(target_date, time(0, 0), tzinfo=UTC), True

    parsed_time = _parse_time(remaining)
    if parsed_time is None:
        return None
    return datetime.combine(target_date, parsed_time, tzinfo=zone), False
