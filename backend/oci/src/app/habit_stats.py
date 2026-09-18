"""Habit statistics — the server-computed Streak and yearly heatmap (per the
PRD: computed, never stored).

The Streak counts consecutive scheduled days checked in, walking back from
today: a missed scheduled day resets it, unscheduled days are skipped rather
than broken, and an unticked today is graced — the day isn't over yet.
Check-ins on unscheduled days are history (they show in the heatmap) but
never streak. N-times-per-week habits are scheduled every day (v1 keeps the
due rule and the streak rule the same; a per-week quota walk is future work).
"""

from datetime import date, timedelta

from app.habit_frequency import due_on


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


def intensity(value: float, target: float) -> float:
    """How filled a heatmap day renders: the value's share of the Target,
    capped at 1 (a Boolean check-in is always the whole target)."""
    return min(value / target, 1.0)
