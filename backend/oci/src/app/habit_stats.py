"""Habit statistics — the server-computed Streak and yearly heatmap (per the
PRD: computed, never stored).

The Streak counts consecutive eligible scheduled days checked in, walking
back from today: a missed scheduled day resets it, unscheduled, paused and
skipped days are stepped over rather than broken, and an unticked today is graced — the
day isn't over yet. Which day is which is app.habit_days' call.
Check-ins on unscheduled days are history (they show in the heatmap) but
never streak. N-times-per-week habits are scheduled every day (v1 keeps the
due rule and the streak rule the same; a per-week quota walk is future work).
Their Weekly target is read separately (`current_week`, issue #568): the
current week's progress toward N, never lowered by a pause or skip, and
excluded only when paused throughout.

The Habit start (`eligible_from`) is the first local day a Habit can be
missed: days before it are "not started", never missed. The Streak already
stops at the earliest Check-in, so the Habit start never changes its value.
"""

from collections.abc import Mapping
from datetime import date, datetime, tzinfo

from app.habit_days import HabitDays, Pause, Week
from app.models import Habit
from app.schemas import as_utc


def habit_days(
    habit: Habit, values: Mapping[date, float], today: date, start: date | None = None
) -> HabitDays:
    """The Habit's days as of `today`, given its Check-in values by day:
    its frequency, Target, pauses and skips come from the Habit itself.
    `start` is the Habit start (`eligible_from`); a caller with no zone to
    read it in may leave it out, and the earliest Check-in stands in. The
    Streak walk ends there anyway, so its value is the same either way."""
    return HabitDays(
        frequency=habit.frequency,
        target=habit.target,
        start=start if start is not None else min(values, default=today),
        pauses=tuple(Pause(start=row.start_date, end=row.end_date) for row in habit.pauses),
        values=values,
        today=today,
        skips=frozenset(row.date for row in habit.skips),
    )


def current_streak(days: HabitDays) -> int:
    """The Streak as of the days' `today`. Read by app.habit_days, the one
    day rule."""
    return days.streak() if days.values else 0


def current_week(days: HabitDays) -> Week | None:
    """The week holding `today` for a times-per-week Habit (issue #568), read
    from its Habit start; None for other frequencies."""
    return days.week(days.today)


def eligible_from(created_at: datetime, zone: tzinfo, checked: set[date], today: date) -> date:
    """The Habit start: the creation instant's local day in `zone`, pulled
    back to the earliest real Check-in when one is earlier (a backfill is
    intentional history), and never later than `today` — so today is always
    eligible, even when the caller's clock runs behind the server's.
    """
    start = as_utc(created_at).astimezone(zone).date()
    if checked:
        start = min(start, min(checked))
    return min(start, today)


def intensity(value: float, target: float) -> float:
    """How filled a heatmap day renders: the value's share of the Target,
    capped at 1 (a Boolean check-in is always the whole target)."""
    return min(value / target, 1.0)
