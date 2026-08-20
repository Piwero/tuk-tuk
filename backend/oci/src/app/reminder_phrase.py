"""Deterministic reminder-phrase resolution (ADR 0005; issue #44).

The model (app.assist.parse_capture_extraction) only ever extracts a phrase
like "the day before" or "1 hour before" — resolving it into the signed
ISO-8601 duration offset Tasks already store (iCalendar TRIGGER convention,
see app.models.Task.reminders) is ordinary code, never model output. A
phrase this resolver doesn't recognize returns None, which the caller
treats the same as "no reminder": Assist only ever adds value, never
subtracts it.
"""

# Days-multiplier per unit; weeks convert to days since Tasks' offset syntax
# (app.routers.v1.tasks.DURATION_RE) excludes the "W" designator — months and
# years have no fixed length, so that syntax sticks to the day/time subset,
# and a week is just 7 fixed-length days.
_UNIT_TO_DAYS = {"day": 1, "days": 1, "week": 7, "weeks": 7}

_ARTICLE_AMOUNTS = {"a": 1, "an": 1, "the": 1, "one": 1}


def resolve_reminder_phrase(phrase: str) -> str | None:
    """Resolves `phrase` into a signed ISO-8601 duration offset, or None
    when it isn't one of the closed set this resolver understands: "at the
    time"/"on time" (no offset), or "<amount> <unit> before" where amount
    is a digit or one of "a"/"an"/"the"/"one" (meaning one).
    """
    words = [word for word in phrase.strip().lower().split() if word]
    if not words:
        return None
    if words[:2] == ["remind", "me"]:
        words = words[2:]
    if not words:
        return None

    if words in (["at", "the", "time"], ["on", "time"]):
        return "PT0S"

    if words[-1] != "before" or len(words) != 3:
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
    if unit in ("minute", "minutes"):
        return f"-PT{n}M"
    if unit in ("hour", "hours"):
        return f"-PT{n}H"
    return None
