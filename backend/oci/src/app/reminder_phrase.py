"""Deterministic reminder-phrase resolution (ADR 0005; issues #44, #46).

The model (app.assist.parse_capture_extraction) only ever extracts a phrase
like "the day before" or "el día antes" — resolving it into the signed
ISO-8601 duration offset Tasks already store (iCalendar TRIGGER convention,
see app.models.Task.reminders) is ordinary code, never model output. A
phrase this resolver doesn't recognize returns None, which the caller
treats the same as "no reminder": Assist only ever adds value, never
subtracts it.

Spanish is first-class alongside English (issue #46): "recuérdame" mirrors
the "remind me" prefix, "antes" mirrors trailing "before", and Spanish
articles/amount words and unit names are recognized on equal footing with
their English equivalents. Words are accent-folded before matching, same
convention as app.date_phrase, so "día"/"recuérdame" match unaccented too.
"""

import unicodedata

# Days-multiplier per unit; weeks convert to days since Tasks' offset syntax
# (app.routers.v1.tasks.DURATION_RE) excludes the "W" designator — months and
# years have no fixed length, so that syntax sticks to the day/time subset,
# and a week is just 7 fixed-length days.
_UNIT_TO_DAYS = {
    "day": 1,
    "days": 1,
    "week": 7,
    "weeks": 7,
    "dia": 1,
    "dias": 1,
    "semana": 7,
    "semanas": 7,
}

_ARTICLE_AMOUNTS = {
    "a": 1,
    "an": 1,
    "the": 1,
    "one": 1,
    "un": 1,
    "una": 1,
    "uno": 1,
    "el": 1,
    "la": 1,
}

_NO_OFFSET_PHRASES = (
    ["at", "the", "time"],
    ["on", "time"],
    ["a", "tiempo"],
    ["en", "el", "momento"],
)


def _fold(word: str) -> str:
    normalized = unicodedata.normalize("NFD", word.lower())
    return "".join(c for c in normalized if unicodedata.category(c) != "Mn")


def resolve_reminder_phrase(phrase: str) -> str | None:
    """Resolves `phrase` into a signed ISO-8601 duration offset, or None
    when it isn't one of the closed set this resolver understands: "at the
    time"/"on time"/"a tiempo"/"en el momento" (no offset), or "<amount>
    <unit> before"/"<amount> <unit> antes" where amount is a digit or an
    article word meaning one (English "a"/"an"/"the"/"one", Spanish
    "un"/"una"/"uno"/"el"/"la").
    """
    words = [_fold(word) for word in phrase.strip().split() if word]
    if not words:
        return None
    if words[:2] == ["remind", "me"]:
        words = words[2:]
    elif words[:1] == ["recuerdame"]:
        words = words[1:]
    if not words:
        return None

    if list(words) in _NO_OFFSET_PHRASES:
        return "PT0S"

    if words[-1] not in ("before", "antes") or len(words) != 3:
        return None
    amount_word, unit = words[0], words[1]
    if amount_word.isdigit():
        n = int(amount_word)
    elif amount_word in _ARTICLE_AMOUNTS:
        n = _ARTICLE_AMOUNTS[amount_word]
    else:
        return None
    if n < 1:
        return None
    if unit in _UNIT_TO_DAYS:
        return f"-P{n * _UNIT_TO_DAYS[unit]}D"
    if unit in ("minute", "minutes", "minuto", "minutos"):
        return f"-PT{n}M"
    if unit in ("hour", "hours", "hora", "horas"):
        return f"-PT{n}H"
    return None
