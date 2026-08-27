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

# The minutes separator is ":" (English) or "." (common in Spanish and much
# of Europe: "18.00"), so both resolve rather than degrading to "no date".
_TIME_RE = re.compile(r"^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$")

# Spelled-out clock hours (issue #176): the model extracts "four pm" /
# "las cuatro" verbatim, so the resolver rewrites the number word to its
# digit before the pattern above sees it — "four pm" is as ordinary a way
# to say a time as "4pm". English one–twelve and Spanish una–doce only:
# a clock hour never exceeds twelve.
_HOUR_WORDS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "una": 1,
    "un": 1,
    "dos": 2,
    "tres": 3,
    "cuatro": 4,
    "cinco": 5,
    "seis": 6,
    "siete": 7,
    "ocho": 8,
    "nueve": 9,
    "diez": 10,
    "once": 11,
    "doce": 12,
}

# Whole-phrase clock times that name no hour digit at all.
_NAMED_TIMES = {
    "noon": time(12, 0),
    "mediodia": time(12, 0),
    "midnight": time(0, 0),
    "medianoche": time(0, 0),
}

# Filler around a spelled hour that carries no meaning of its own:
# "four o'clock", "las cuatro en punto".
_CLOCK_FILLERS = ("oclock", "o'clock", "punto")

# Trailing Spanish qualifiers that fix an otherwise-24h hour to AM or PM —
# "a las cuatro de la tarde" is 16:00, not 04:00. English uses am/pm, which
# the pattern already captures.
_SPANISH_MERIDIEM_TAILS: dict[tuple[str, ...], str] = {
    ("de", "la", "tarde"): "pm",
    ("de", "la", "noche"): "pm",
    ("de", "la", "manana"): "am",
}

# Daypart qualifiers (issue #173): trailing words like "afternoon"/"tarde"
# name an imprecise time-of-day rather than a clock time, so each maps to a
# reasonable default hour instead of failing to resolve at all — the same
# "app resolves it, never the model" posture as the explicit-time parsing
# below. "manana" is deliberately absent here: unqualified it already means
# "tomorrow" (see the leading-word match above), and its trailing daypart
# sense ("morning") only applies behind the "por"/"en" markers handled by
# _DAYPART_PREFIXES, disambiguated in the trailing-word loop itself.
_DAYPART_TIMES = {
    "morning": time(9, 0),
    "afternoon": time(15, 0),
    "tarde": time(15, 0),
    "evening": time(18, 0),
    "night": time(20, 0),
    "noche": time(20, 0),
}

# Markers that precede a trailing daypart word ("por la tarde", "en la
# mañana") — stripped the same way "at"/"a las" precede an explicit time.
_DAYPART_PREFIXES = ("por", "en")

# "tonight"/"esta noche" name today's date at night with no other date word
# to anchor to, unlike every other daypart phrase which qualifies a
# preceding date word.
_TONIGHT_PHRASES = (("tonight",), ("esta", "noche"))


def _fold(word: str) -> str:
    """Lowercases and strips accents so "miércoles"/"próximo" match their
    unaccented forms — the client may send either."""
    normalized = unicodedata.normalize("NFD", word.lower())
    return "".join(c for c in normalized if unicodedata.category(c) != "Mn")


def _parse_time(words: list[str]) -> time | None:
    """The remaining words after the date portion, matched against a bare
    hour, "hh:mm", or a 12-hour "3pm"/"3:30pm" form — with a spelled-out
    hour ("four pm", "las cuatro"), a named time ("noon", "medianoche"),
    trailing filler ("o'clock"), and a trailing Spanish AM/PM qualifier
    ("de la tarde") all rewritten to that shape first. Returns None for
    anything else, including a 24-hour hour out of range."""
    if not words:
        return None

    if len(words) == 1 and words[0] in _NAMED_TIMES:
        return _NAMED_TIMES[words[0]]

    words = [word for word in words if word not in _CLOCK_FILLERS]

    tail_meridiem: str | None = None
    if len(words) >= 3 and tuple(words[-3:]) in _SPANISH_MERIDIEM_TAILS:
        tail_meridiem = _SPANISH_MERIDIEM_TAILS[tuple(words[-3:])]
        words = words[:-3]

    joined = "".join(str(_HOUR_WORDS.get(word, word)) for word in words)
    if tail_meridiem is not None and not joined.endswith(("am", "pm")):
        joined += tail_meridiem

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

    # "tonight"/"esta noche" name today at night with no other date word to
    # qualify — unlike every other daypart phrase below, which trails a
    # date word this engine already resolved.
    if tuple(words) in _TONIGHT_PHRASES:
        return datetime.combine(local_date, _DAYPART_TIMES["night"], tzinfo=zone), False

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

    remaining = words[idx:]

    # A trailing daypart word ("afternoon"/"tarde") — optionally behind a
    # "por"/"en" marker and article ("por la tarde") — names an imprecise
    # time-of-day rather than a clock time, so it maps to a default hour
    # instead of falling through to the strict clock-time parse below. Only
    # ever tried as a whole-remainder match: "afternoon" bare, or a marker
    # plus exactly one daypart word, so it doesn't swallow a real trailing
    # clock time.
    daypart_remainder = remaining
    if daypart_remainder and daypart_remainder[0] in _DAYPART_PREFIXES:
        daypart_remainder = daypart_remainder[1:]
        if daypart_remainder and daypart_remainder[0] in ("la", "el"):
            daypart_remainder = daypart_remainder[1:]
    if len(daypart_remainder) == 1:
        word = daypart_remainder[0]
        # "manana" only means "morning" in this trailing position — its
        # leading-word sense above ("tomorrow") already consumed it there.
        daypart_time = time(9, 0) if word == "manana" else _DAYPART_TIMES.get(word)
        if daypart_time is not None:
            return datetime.combine(target_date, daypart_time, tzinfo=zone), False

    # Only a leading run of filler words is stripped — "at"/"a las"/"a la"
    # precede the time itself, so unlike the date-word matching above there's
    # no case where one of these legitimately reappears after the time.
    while remaining and remaining[0] in ("at", "a", "las", "la"):
        remaining = remaining[1:]
    if not remaining:
        return datetime.combine(target_date, time(0, 0), tzinfo=UTC), True

    parsed_time = _parse_time(remaining)
    if parsed_time is None:
        return None
    return datetime.combine(target_date, parsed_time, tzinfo=zone), False
