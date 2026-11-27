"""Habit days — the one rule that decides what each of a Habit's days is.

The Streak, the history and the statistics all ask the same question of a
day, so they all read it here (issue #559): a day is done or partial when it
holds a Check-in, future after today, unscheduled off its frequency, not
started before the Habit start, paused inside a pause, skipped when the User
skipped it (issue #564), open while it is still today, and otherwise missed.

The order decides overlaps. A recorded Check-in always shows (a paused or
skipped date can never hold one: pausing or skipping over a Check-in is
refused, and so is a Check-in on a paused or skipped date). An off day is
unscheduled even inside a pause, and a date before the Habit start stays not
started even when paused or skipped. A pause later laid over a skip wins
while it lasts. A skipped day still reads skipped when it lies ahead, so a
planned skip shows before the day comes.

Paused and skipped days are neither success nor failure: they are not
eligible, so the Streak steps over them the way it steps over an unscheduled
day.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from app.habit_frequency import due_on, times_per_week

DayState = Literal[
    "done",
    "partial",
    "future",
    "unscheduled",
    "not_started",
    "paused",
    "skipped",
    "open_today",
    "missed",
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


@dataclass(frozen=True)
class Week:
    """A times-per-week Habit's week, Monday to Sunday (issue #568). `done`
    counts days whose Check-in met the Target; `remaining` is what is still
    to do. The Target is never reduced by a pause or skip inside the week:
    only a pause covering every day of the week from the Habit start on
    `excluded`s it, so it counts as neither met nor missed."""

    start: date
    end: date
    target: int
    done: int
    remaining: int
    paused_days: int
    skipped_days: int
    excluded: bool


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
    skips: frozenset[date] = frozenset()

    def state(self, day: date) -> DayState:
        value = self.values.get(day)
        if value is not None:
            return "done" if value >= self.target else "partial"
        if day > self.today:
            return "skipped" if self._skipped(day) else "future"
        if not due_on(self.frequency, day):
            return "unscheduled"
        if day < self.start:
            return "not_started"
        if is_paused(day, self.pauses):
            return "paused"
        if day in self.skips:
            return "skipped"
        return "open_today" if day == self.today else "missed"

    def _skipped(self, day: date) -> bool:
        return (
            day in self.skips
            and due_on(self.frequency, day)
            and day >= self.start
            and not is_paused(day, self.pauses)
        )

    def week(self, day: date) -> Week | None:
        """The week holding `day`, for a times-per-week Habit; None for any
        other frequency, whose days carry their own schedule."""
        target = times_per_week(self.frequency)
        if target is None:
            return None
        start = day - timedelta(days=day.weekday())
        days = [start + timedelta(days=offset) for offset in range(7)]
        states = [self.state(each) for each in days]
        started = [each for each in days if each >= self.start]
        done = states.count("done")
        return Week(
            start=start,
            end=days[-1],
            target=target,
            done=done,
            remaining=max(target - done, 0),
            paused_days=sum(1 for each in started if is_paused(each, self.pauses)),
            skipped_days=states.count("skipped"),
            excluded=bool(started) and all(is_paused(each, self.pauses) for each in started),
        )

    def streak(self) -> int:
        """Consecutive eligible scheduled days checked in, walking back from
        today. Unscheduled, paused and skipped days are stepped over, never counted;
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
