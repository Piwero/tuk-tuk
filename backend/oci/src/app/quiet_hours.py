"""Quiet hours (issue #567): a per-User band of the day during which
Reminder notifications are held back, and when a held Reminder comes out.

The band is two "HH:MM" wall-clock labels, read in a zone the caller picks
(the claiming tab's, ADR 0019). It may wrap past midnight: a start after its
end, like 22:00-07:00, is a night band that ends the next day. A start equal
to its end is refused, since it could mean an empty band or the whole day.
The start is inside the band and the end is not.

This is a notification setting. Active hours, the Calendar's band (ADR
0010), is a different setting and nothing here reads it.
"""

import re
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta, tzinfo

_HH_MM = re.compile(r"^\d{2}:\d{2}$")


class InvalidQuietHoursError(ValueError):
    """A band that can't be saved; the message says why, for the User."""


def _minute_of_day(label: str) -> int:
    if not _HH_MM.match(label):
        raise InvalidQuietHoursError(f"{label!r} is not an HH:MM time")
    hours, minutes = int(label[:2]), int(label[3:])
    if hours > 23 or minutes > 59:
        raise InvalidQuietHoursError(f"{label!r} is not a time of day")
    return hours * 60 + minutes


@dataclass(frozen=True)
class QuietHours:
    """A valid band, as minutes of the day."""

    start: int
    end: int

    @classmethod
    def parse(cls, start: str, end: str) -> "QuietHours":
        """The band from its labels, or InvalidQuietHoursError."""
        band = cls(start=_minute_of_day(start), end=_minute_of_day(end))
        if band.start == band.end:
            raise InvalidQuietHoursError("Quiet hours must start and end at different times")
        return band

    @property
    def wraps(self) -> bool:
        return self.start > self.end

    def _inside_minute(self, minute: int) -> bool:
        if self.wraps:
            return minute >= self.start or minute < self.end
        return self.start <= minute < self.end

    def contains(self, instant: datetime, zone: tzinfo) -> bool:
        """Whether `instant` falls inside the band, on the wall clock of `zone`."""
        local = instant.astimezone(zone)
        return self._inside_minute(local.hour * 60 + local.minute)

    def end_after(self, instant: datetime, zone: tzinfo) -> datetime:
        """When the band holding `instant` ends: the first end label on the
        wall clock of `zone` after it. Only meaningful for an instant
        `contains` accepts. A wall-clock end skipped by a DST change resolves
        the way zoneinfo does (fold 0)."""
        local = instant.astimezone(zone)
        end_label = time(self.end // 60, self.end % 60)
        day = local.date()
        if local.hour * 60 + local.minute >= self.end:
            day += timedelta(days=1)
        return datetime.combine(day, end_label, tzinfo=zone).astimezone(UTC)


def held_until(at: datetime, quiet: QuietHours | None, zone: tzinfo) -> datetime | None:
    """The end of the Quiet hours band a fire time falls in, or None when it
    isn't held. A held Reminder is delivered at that end instead."""
    if quiet is None or not quiet.contains(at, zone):
        return None
    return quiet.end_after(at, zone)
