"""Habit statistics — the server-computed Streak and yearly heatmap (per the
PRD: computed, never stored).

The Streak counts consecutive eligible scheduled days checked in, walking
back from today: a missed scheduled day resets it, unscheduled, paused and
skipped days are stepped over rather than broken, and an unticked today is graced — the
day isn't over yet. Which day is which is app.habit_days' call.
Check-ins on unscheduled days are history (they show in the heatmap) but
never streak. N-times-per-week habits are scheduled every day (v1 keeps the
due rule and the streak rule the same; a per-week quota walk is future work).

The Habit start (`eligible_from`) is the first local day a Habit can be
missed: days before it are "not started", never missed. The Streak already
stops at the earliest Check-in, so the Habit start never changes its value.
"""

from collections.abc import Iterable, Mapping
from datetime import date, datetime, tzinfo

from app.habit_days import HabitDays, Pause
from app.schemas import as_utc


def current_streak(
    frequency: str,
    target: float,
    pauses: Iterable[Pause],
    values: Mapping[date, float],
    today: date,
    skips: Iterable[date] = (),
) -> int:
    """The Streak as of `today` for a Habit with this frequency, Target,
    pauses and skipped days, given its Check-in values by day. Read by app.habit_days, the one
    day rule. The walk ends at the earliest Check-in, which is never later
    than the Habit start, so the creation day (and so the caller's zone) is
    not needed here.
    """
    if not values:
        return 0
    days = HabitDays(
        frequency=frequency,
        target=target,
        start=min(values),
        pauses=tuple(pauses),
        values=values,
        today=today,
        skips=frozenset(skips),
    )
    return days.streak()


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
