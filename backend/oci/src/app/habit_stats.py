"""Habit statistics — the server-computed Streak and yearly heatmap (per the
PRD: computed, never stored).

The Streak counts consecutive scheduled days checked in, walking back from
today: a missed scheduled day resets it, unscheduled days are skipped rather
than broken, and an unticked today is graced — the day isn't over yet.
Check-ins on unscheduled days are history (they show in the heatmap) but
never streak. N-times-per-week habits are scheduled every day (v1 keeps the
due rule and the streak rule the same; a per-week quota walk is future work).

The Habit start (`eligible_from`) is the first local day a Habit can be
missed: days before it are "not started", never missed. The Streak already
stops at the earliest Check-in, so the Habit start never changes its value.
"""

from datetime import date, datetime, timedelta, tzinfo

from app.habit_frequency import due_on
from app.schemas import as_utc


def current_streak(frequency: str, checked: set[date], today: date) -> int:
    """The Streak as of `today` for a Habit with this frequency, given the
    set of days it has Check-ins on.
    """
    if not checked:
        return 0
    day = today
    if due_on(frequency, day) and day not in checked:
        # Grace an unticked today: the run is judged from yesterday back.
        day -= timedelta(days=1)
    earliest = min(checked)
    streak = 0
    while day >= earliest:
        if due_on(frequency, day):
            if day not in checked:
                break
            streak += 1
        day -= timedelta(days=1)
    return streak


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
