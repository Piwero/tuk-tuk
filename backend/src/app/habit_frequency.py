"""Habit frequency — the RRULE subset Habits are scheduled by.

A Habit's frequency is RRULE content, but never a date series: it answers
"is this Habit due on this day?", so it needs weekday logic only. Three
shapes (per the PRD): daily, chosen weekdays, and N times per week —
the last stored with TickTick's TT_TIMES extension parameter, which is why
this module parses by hand instead of using dateutil (rrulestr rejects
extension parts, and habits have no anchor date to expand a series from).
"""

from datetime import date

from app.errors import APIError

# RRULE weekday codes in Python's date.weekday() order (Monday = 0).
WEEKDAYS = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")


def invalid_frequency(frequency: str) -> APIError:
    return APIError(
        status_code=422,
        code="invalid_frequency",
        message=f"Not a habit frequency: {frequency!r} — use FREQ=DAILY, "
        "FREQ=WEEKLY;BYDAY=... or FREQ=WEEKLY;TT_TIMES=N",
    )


def parse_frequency(frequency: str) -> dict[str, str]:
    """The rule's parts as a dict, checked against the habit subset:
    FREQ=DAILY (every day), FREQ=WEEKLY;BYDAY=... (chosen weekdays), or
    FREQ=WEEKLY;TT_TIMES=N (N times per week, any days). Raises 422 otherwise.
    """
    parts: dict[str, str] = {}
    for part in frequency.split(";"):
        key, separator, value = part.partition("=")
        if separator == "" or key in parts:
            raise invalid_frequency(frequency)
        parts[key] = value
    known = {"FREQ", "BYDAY", "TT_TIMES", "INTERVAL"}
    if set(parts) - known or parts.get("INTERVAL", "1") != "1":
        raise invalid_frequency(frequency)
    if parts.get("FREQ") == "DAILY":
        if "BYDAY" in parts or "TT_TIMES" in parts:
            raise invalid_frequency(frequency)
        return parts
    if parts.get("FREQ") != "WEEKLY" or ("BYDAY" in parts) == ("TT_TIMES" in parts):
        raise invalid_frequency(frequency)
    if "BYDAY" in parts:
        days = parts["BYDAY"].split(",")
        if len(set(days)) != len(days) or any(day not in WEEKDAYS for day in days):
            raise invalid_frequency(frequency)
    if "TT_TIMES" in parts and parts["TT_TIMES"] not in {str(n) for n in range(1, 8)}:
        raise invalid_frequency(frequency)
    return parts


def validate_frequency(frequency: str) -> str:
    parse_frequency(frequency)
    return frequency


def due_on(frequency: str, day: date) -> bool:
    """Whether a Habit with this frequency is scheduled on the given day.
    Daily and N-times-per-week habits are due every day (the user picks
    which days count toward the N); weekday habits only on their days.
    """
    parts = parse_frequency(frequency)
    if "BYDAY" not in parts:
        return True
    return WEEKDAYS[day.weekday()] in parts["BYDAY"].split(",")
