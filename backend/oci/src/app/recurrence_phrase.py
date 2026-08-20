"""Deterministic recurrence-phrase resolution (ADR 0005; issue #44).

The model (app.assist.parse_capture_extraction) only ever extracts a phrase
like "every month on the 1st" or "weekly" — resolving it into RRULE content
(app.recurrence's vocabulary) is ordinary code, never model output. A phrase
this resolver doesn't recognize returns None, which the caller treats the
same as "no recurrence": Assist only ever adds value, never subtracts it.
"""

import re

_WEEKDAYS = {
    "monday": "MO",
    "tuesday": "TU",
    "wednesday": "WE",
    "thursday": "TH",
    "friday": "FR",
    "saturday": "SA",
    "sunday": "SU",
}

_FREQ_UNITS = {
    "day": "DAILY",
    "days": "DAILY",
    "daily": "DAILY",
    "week": "WEEKLY",
    "weeks": "WEEKLY",
    "weekly": "WEEKLY",
    "month": "MONTHLY",
    "months": "MONTHLY",
    "monthly": "MONTHLY",
    "year": "YEARLY",
    "years": "YEARLY",
    "yearly": "YEARLY",
    "annually": "YEARLY",
}

_ORDINAL_RE = re.compile(r"^(\d{1,2})(st|nd|rd|th)$")


def resolve_recurrence_phrase(phrase: str) -> str | None:
    """Resolves `phrase` into RRULE content, or None when it isn't one of
    the closed set this resolver understands: bare frequency words
    (daily/weekly/monthly/yearly), "every N <unit>", "every <weekday>[,
    <weekday>...]", and "every month on the Nth".
    """
    words = [word.strip(",") for word in phrase.strip().lower().split() if word.strip(",")]
    if not words:
        return None

    if len(words) == 1 and words[0] in _FREQ_UNITS:
        return f"FREQ={_FREQ_UNITS[words[0]]}"

    if words[0] != "every" or len(words) < 2:
        return None
    rest = words[1:]

    if rest[0].isdigit():
        if len(rest) < 2:
            return None
        n = int(rest[0])
        unit = rest[1]
        if n < 1 or unit not in _FREQ_UNITS:
            return None
        return f"FREQ={_FREQ_UNITS[unit]};INTERVAL={n}"

    if rest[0] in ("month", "months") and len(rest) >= 4 and rest[1] == "on" and rest[2] == "the":
        match = _ORDINAL_RE.match(rest[3])
        if match is None:
            return None
        day = int(match.group(1))
        if not 1 <= day <= 31:
            return None
        return f"FREQ=MONTHLY;BYMONTHDAY={day}"

    if len(rest) == 1 and rest[0] in _FREQ_UNITS:
        return f"FREQ={_FREQ_UNITS[rest[0]]}"

    days: list[str] = []
    for word in rest:
        if word == "and":
            continue
        if word not in _WEEKDAYS:
            return None
        code = _WEEKDAYS[word]
        if code not in days:
            days.append(code)
    if not days:
        return None
    return f"FREQ=WEEKLY;BYDAY={','.join(days)}"
