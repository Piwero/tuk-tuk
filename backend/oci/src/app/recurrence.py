"""Recurrence — iCalendar RRULE handling for recurring Tasks (ADR 0003).

A Task's recurrence is stored as RRULE content anchored at its due date.
Completing a recurring Task advances its dates in place to the next
occurrence; the row itself completes only when the recurrence has ended.
"""

import re
from datetime import UTC, datetime, tzinfo
from typing import cast
from zoneinfo import ZoneInfo

from dateutil.rrule import rrule, rrulestr

from app.errors import APIError
from app.models import CompletedOccurrence, Task
from app.schemas import as_utc


def invalid_recurrence(message: str) -> APIError:
    return APIError(status_code=422, code="invalid_recurrence", message=message)


def parse_rule(recurrence: str, dtstart: datetime) -> rrule:
    # A single-rule string always yields an rrule, never an rruleset.
    return cast(rrule, rrulestr(recurrence, dtstart=dtstart))


def validate_recurrence(recurrence: str | None, due_date: datetime | None) -> str | None:
    """Recurrence is RRULE content anchored at the due date: check that it
    parses, keep it a single bare rule (no DTSTART smuggling, parts in any
    order per RFC 5545), and require a date.
    """
    if recurrence is None:
        return None
    parts = recurrence.split(";")
    if "\n" in recurrence or not any(part.startswith("FREQ=") for part in parts):
        raise invalid_recurrence(f"Not RRULE content: {recurrence!r}")
    try:
        parse_rule(recurrence, dtstart=datetime(2000, 1, 1))
    except (ValueError, KeyError):
        raise invalid_recurrence(f"Not RRULE content: {recurrence!r}") from None
    if due_date is None:
        raise invalid_recurrence("A task without a date cannot recur")
    return recurrence


def local_zone(is_all_day: bool, time_zone: str | None) -> tzinfo:
    """The zone occurrences are computed in: recurrence preserves wall-clock
    time in the task's own timezone (all-day values are date-only at UTC).
    """
    return UTC if is_all_day or time_zone is None else ZoneInfo(time_zone)


def next_occurrence(
    recurrence: str,
    due_date: datetime,
    is_all_day: bool,
    time_zone: str | None,
) -> datetime | None:
    """The next occurrence strictly after the current due date, as a UTC
    instant, or None when the recurrence has ended (past COUNT or UNTIL).

    Computed on naive wall-clock time in the task's zone, so a DST shift
    never moves an "every day at 09:00" task to 08:00.
    """
    zone = local_zone(is_all_day, time_zone)
    local = as_utc(due_date).astimezone(zone).replace(tzinfo=None)
    nxt = parse_rule(recurrence, dtstart=local).after(local)
    if nxt is None:
        return None
    return nxt.replace(tzinfo=zone).astimezone(UTC)


def decrement_count(recurrence: str) -> str:
    """One occurrence was completed: an "ends after N times" rule has N-1
    occurrences left. Never below 1 — the rule that produced a next occurrence
    still owes that occurrence.
    """

    def spend_one(match: re.Match[str]) -> str:
        return f"COUNT={max(int(match.group(1)) - 1, 1)}"

    return re.sub(r"COUNT=(\d+)", spend_one, recurrence)


def advance_in_place(task: Task) -> CompletedOccurrence | None:
    """Advance a recurring Task to its next occurrence: reset its checklist,
    move its dates forward (preserving the start->due duration), and return
    the Completed Occurrence to record. None when the recurrence has ended —
    the caller completes the row itself instead, and that completed row (not
    a duplicate occurrence) is the final history entry.
    """
    if task.recurrence is None or task.due_date is None:  # guarded by the caller
        return None
    nxt = next_occurrence(task.recurrence, task.due_date, task.is_all_day, task.time_zone)
    if nxt is None:
        return None
    occurrence = CompletedOccurrence(
        task_id=task.id,
        due_date=task.due_date,
        is_all_day=task.is_all_day,
    )
    delta = nxt - as_utc(task.due_date)
    if task.start_date is not None:
        task.start_date = as_utc(task.start_date) + delta
    task.due_date = nxt
    task.recurrence = decrement_count(task.recurrence)
    # The next occurrence starts with a fresh checklist.
    for item in task.check_items:
        item.done = False
    return occurrence
