"""Habit days — the one rule that decides what each of a Habit's days is.

The Streak, the history and the statistics all ask the same question of a
day, so they all read it here (issue #559): a day is done or partial when it
holds a Check-in, future after today, unscheduled off its frequency, not
started before the Habit start, paused inside a pause, open while it is
still today, and otherwise missed.

The order decides overlaps. A recorded Check-in always shows (a paused date
can never hold one: pausing over a Check-in is refused, and so is a
Check-in on a paused date). An off day is unscheduled even inside a pause,
and a date before the Habit start stays not started even when paused.

A paused day is neither success nor failure: it is not eligible, so the
Streak steps over it the way it steps over an unscheduled day.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from app.habit_frequency import due_on

DayState = Literal[
    "done", "partial", "future", "unscheduled", "not_started", "paused", "open_today", "missed"
]


@dataclass(frozen=True)
class Pause:
    """A pause's date interval, both ends inclusive; `end` None is open-ended."""

    start: date
    end: date | None

    def covers(self, day: date) -> bool:
        return self.start <= day and (self.end is None or day <= self.end)

    def overlaps(self, other: "Pause") -> bool:
        return (other.end is None or self.start <= other.end) and (
            self.end is None or other.start <= self.end
        )


def is_paused(day: date, pauses: Iterable[Pause]) -> bool:
    return any(pause.covers(day) for pause in pauses)


@dataclass(frozen=True)
class HabitDays:
    """One Habit's days as of `today`. `values` maps each checked-in day to
    its value; `start` is the Habit start (see app.habit_stats)."""

    frequency: str
    target: float
    start: date
    pauses: tuple[Pause, ...]
    values: Mapping[date, float]
    today: date

    def state(self, day: date) -> DayState:
        value = self.values.get(day)
        if value is not None:
            return "done" if value >= self.target else "partial"
        if day > self.today:
            return "future"
        if not due_on(self.frequency, day):
            return "unscheduled"
        if day < self.start:
            return "not_started"
        if is_paused(day, self.pauses):
            return "paused"
        return "open_today" if day == self.today else "missed"

    def streak(self) -> int:
        """Consecutive eligible scheduled days checked in, walking back from
        today. Unscheduled and paused days are stepped over, never counted;
        an unticked today is graced (the day isn't over yet); a missed day
        breaks the run and the Habit start ends it. Any Check-in on a
        scheduled day counts, a partial one included. A Check-in on an
        unscheduled day is history, never streak.
        """
        streak = 0
        day = self.today
        # Nothing before the Habit start counts: it is never later than the
        # earliest Check-in, so the walk can stop there.
        while day >= self.start:
            state = self.state(day)
            if state == "missed":
                break
            if state in ("done", "partial") and due_on(self.frequency, day):
                streak += 1
            day -= timedelta(days=1)
        return streak
