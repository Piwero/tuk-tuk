"""Deterministic recurrence-phrase resolution (ADR 0005; issues #44, #46).

The model (app.assist.parse_capture_extraction) only ever extracts a phrase
like "every month on the 1st" or "cada lunes" — resolving it into RRULE
content (app.recurrence's vocabulary) is ordinary code, never model output.
A phrase this resolver doesn't recognize returns None, which the caller
treats the same as "no recurrence": Assist only ever adds value, never
subtracts it.

Spanish is first-class alongside English (issue #46): "cada" mirrors
"every", "todos los <unit/weekday>" mirrors the bare-plural English forms
("todos los meses" == "monthly"), and "y" mirrors "and" in a weekday list.
Words are accent-folded before matching, same convention as
app.date_phrase, so "miércoles"/"año" match their unaccented forms too.
"""

import re
import unicodedata

_WEEKDAYS = {
    "monday": "MO",
    "tuesday": "TU",
    "wednesday": "WE",
    "thursday": "TH",
    "friday": "FR",
    "saturday": "SA",
    "sunday": "SU",
    "lunes": "MO",
    "martes": "TU",
    "miercoles": "WE",
    "jueves": "TH",
    "viernes": "FR",
    "sabado": "SA",
    "domingo": "SU",
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
    "dia": "DAILY",
    "dias": "DAILY",
    "diario": "DAILY",
    "diariamente": "DAILY",
    "semana": "WEEKLY",
    "semanas": "WEEKLY",
    "semanal": "WEEKLY",
    "semanalmente": "WEEKLY",
    "mes": "MONTHLY",
    "meses": "MONTHLY",
    "mensual": "MONTHLY",
    "mensualmente": "MONTHLY",
    "ano": "YEARLY",
    "anos": "YEARLY",
    "anual": "YEARLY",
    "anualmente": "YEARLY",
}

_ORDINAL_RE = re.compile(r"^(\d{1,2})(st|nd|rd|th)?$")


def _fold(word: str) -> str:
    normalized = unicodedata.normalize("NFD", word.lower())
    return "".join(c for c in normalized if unicodedata.category(c) != "Mn")


def _weekday_list(words: list[str]) -> list[str] | None:
    """A conjunction of weekday names ("monday and thursday" / "lunes y
    jueves") into RRULE BYDAY codes, or None when any word isn't a
    recognized weekday or conjunction."""
    days: list[str] = []
    for word in words:
        if word in ("and", "y"):
            continue
        if word not in _WEEKDAYS:
            return None
        code = _WEEKDAYS[word]
        if code not in days:
            days.append(code)
    return days or None


def resolve_recurrence_phrase(phrase: str) -> str | None:
    """Resolves `phrase` into RRULE content, or None when it isn't one of
    the closed set this resolver understands: bare frequency words
    (daily/weekly/monthly/yearly and their Spanish equivalents), "every"/
    "cada N <unit>", "every"/"cada <weekday>[, <weekday>...]", "every month
    on the Nth"/"cada mes el día N", and "todos los <unit/weekday>".
    """
    words = [_fold(word.strip(",")) for word in phrase.strip().split() if word.strip(",")]
    if not words:
        return None

    if len(words) == 1 and words[0] in _FREQ_UNITS:
        return f"FREQ={_FREQ_UNITS[words[0]]}"

    if words[0] in ("todos", "todas") and len(words) >= 3 and words[1] in ("los", "las"):
        rest = words[2:]
        if len(rest) == 1 and rest[0] in _FREQ_UNITS:
            return f"FREQ={_FREQ_UNITS[rest[0]]}"
        days = _weekday_list(rest)
        return f"FREQ=WEEKLY;BYDAY={','.join(days)}" if days else None

    if words[0] not in ("every", "cada") or len(words) < 2:
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

    if rest[0] in ("mes", "meses") and len(rest) >= 4 and rest[1] == "el" and rest[2] == "dia":
        match = _ORDINAL_RE.match(rest[3])
        if match is None:
            return None
        day = int(match.group(1))
        if not 1 <= day <= 31:
            return None
        return f"FREQ=MONTHLY;BYMONTHDAY={day}"

    if len(rest) == 1 and rest[0] in _FREQ_UNITS:
        return f"FREQ={_FREQ_UNITS[rest[0]]}"

    days = _weekday_list(rest)
    return f"FREQ=WEEKLY;BYDAY={','.join(days)}" if days else None
