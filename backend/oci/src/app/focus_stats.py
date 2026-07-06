"""Focus statistics — totals by day and week, and per-Task / per-Habit
breakdowns, computed from persisted Focus Sessions (per the PRD: computed,
never stored).

A session counts toward the calendar day it started on, read in the
caller's timezone. Weeks start on Monday (WKST=MO, like recurrence).
Every total is honest focus time: the wall-clock span minus the pause.
"""

from collections import defaultdict
from datetime import date, timedelta, tzinfo
from typing import Literal

from app.models import FocusSession
from app.schemas import as_utc


def session_day(session: FocusSession, zone: tzinfo) -> date:
    """The local calendar day a session belongs to: the day it started."""
    return as_utc(session.started_at).astimezone(zone).date()


def focus_seconds(session: FocusSession) -> int:
    span = int((as_utc(session.ended_at) - as_utc(session.started_at)).total_seconds())
    return span - session.pause_seconds


def week_start(day: date) -> date:
    """The Monday of the day's week."""
    return day - timedelta(days=day.weekday())


def daily_totals(sessions: list[tuple[FocusSession, date]]) -> dict[date, int]:
    totals: dict[date, int] = defaultdict(int)
    for session, day in sessions:
        totals[day] += focus_seconds(session)
    return dict(sorted(totals.items()))


def weekly_totals(sessions: list[tuple[FocusSession, date]]) -> dict[date, int]:
    totals: dict[date, int] = defaultdict(int)
    for session, day in sessions:
        totals[week_start(day)] += focus_seconds(session)
    return dict(sorted(totals.items()))


def linked_totals(
    sessions: list[tuple[FocusSession, date]],
    side: Literal["task_id", "habit_id"],
) -> dict[int, int]:
    """Focus seconds per linked row id, in first-seen session order."""
    totals: dict[int, int] = defaultdict(int)
    for session, _ in sessions:
        linked_id = getattr(session, side)
        if linked_id is not None:
            totals[linked_id] += focus_seconds(session)
    return dict(totals)
