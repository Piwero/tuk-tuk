"""Foreground Reminder delivery (issue #561, ADR 0019): which Reminders are
due now, and the claim/lease rule that lets several open tabs share them.

A Reminder is due for one Task occurrence: the Task's current, open due
date. Its `fire_at` is that anchor plus the Reminder's offset. Each claim
reloads the Task, so a completed or deleted Task, a recurring Task already
advanced past the occurrence (ADR 0003), or a Reminder removed since,
simply produces no candidate: stale work never notifies.

Policy, all on the server clock:

- `DELIVERY_WINDOW`: a Reminder is claimable from `fire_at` until this much
  later. After that it is missed, never replayed as a late alert.
- `LEASE`: how long a claiming tab has to report `shown` or `failed`.
- `MAX_ATTEMPTS`: an unreported lease that expired is claimed again, by any
  tab, up to this many claims in all and only inside the window. A
  `failed` report is final: the browser refused, so retrying would too.

The ledger's unique key (Task, offset, occurrence due date) is what makes
one occurrence claimable once: two tabs inserting the same key race on the
index and only one wins.
"""

import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, tzinfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ReminderDelivery, Task
from app.recurrence import local_zone
from app.schemas import as_utc

DELIVERY_WINDOW = timedelta(minutes=5)
LEASE = timedelta(seconds=60)
MAX_ATTEMPTS = 3

_OFFSET_RE = re.compile(r"^(-?)P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$")


def fire_at(task: Task, offset: str, caller_zone: tzinfo) -> datetime | None:
    """When `offset` comes due for the Task's current occurrence, or None
    for a Task with no date or an offset the store would never hold.

    A timed Task anchors at its due instant. An all-day Task anchors at the
    start of its date in the caller's zone: its date has no hour, and the
    tab asking is the one that would show it. Whole days are nominal
    (iCalendar): "1 day before" 09:00 is 09:00 the day before, across DST.
    """
    match = _OFFSET_RE.match(offset)
    if task.due_date is None or match is None:
        return None
    sign = -1 if match.group(1) else 1
    days, hours, minutes, seconds = (int(part or 0) for part in match.groups()[1:])
    due = as_utc(task.due_date)
    if task.is_all_day:
        zone = caller_zone
        local = datetime.combine(due.date(), datetime.min.time())
    else:
        zone = local_zone(False, task.time_zone)
        local = due.astimezone(zone).replace(tzinfo=None)
    shifted = (local + sign * timedelta(days=days)).replace(tzinfo=zone).astimezone(UTC)
    return shifted + sign * timedelta(hours=hours, minutes=minutes, seconds=seconds)


@dataclass(frozen=True)
class Due:
    """One Reminder of one Task occurrence, due now."""

    task: Task
    offset: str
    fire_at: datetime


def due_reminders(tasks: list[Task], now: datetime, caller_zone: tzinfo) -> list[Due]:
    """The Reminders of these Tasks inside their delivery window at `now`."""
    found = []
    for task in tasks:
        if task.completed or task.due_date is None:
            continue
        for offset in task.reminders:
            at = fire_at(task, offset, caller_zone)
            if at is not None and at <= now < at + DELIVERY_WINDOW:
                found.append(Due(task=task, offset=offset, fire_at=at))
    return found


def _lease(row: ReminderDelivery, now: datetime) -> None:
    row.lease_token = secrets.token_urlsafe(24)
    row.lease_expires_at = now + LEASE
    row.claimed_at = now


async def claim_due(
    session: AsyncSession, now: datetime, caller_zone: tzinfo
) -> list[ReminderDelivery]:
    """Claims every Reminder due now that no tab holds: new ones, and
    unreported ones whose lease expired with attempts left. Commits."""
    tasks = list(
        (
            await session.scalars(
                select(Task).where(Task.completed.is_(False), Task.due_date.is_not(None))
            )
        ).all()
    )
    claimed = []
    for due in due_reminders(tasks, now, caller_zone):
        row = await _claim_one(session, due, now)
        if row is not None:
            claimed.append(row)
    await session.commit()
    return claimed


async def _claim_one(session: AsyncSession, due: Due, now: datetime) -> ReminderDelivery | None:
    occurrence = as_utc(due.task.due_date)  # type: ignore[arg-type]  # due_reminders checked
    row = ReminderDelivery(
        task_id=due.task.id,
        offset=due.offset,
        occurrence_due=occurrence,
        fire_at=due.fire_at,
        state="claimed",
        attempts=1,
    )
    _lease(row, now)
    row.task = due.task
    try:
        async with session.begin_nested():
            session.add(row)
    except IntegrityError:
        # Already in the ledger: claimed by this or another tab before.
        if row in session:
            session.expunge(row)
    else:
        return row
    # SKIP LOCKED: a row another tab is claiming right now is theirs.
    existing = await session.scalar(
        select(ReminderDelivery)
        .where(
            ReminderDelivery.task_id == due.task.id,
            ReminderDelivery.offset == due.offset,
            ReminderDelivery.occurrence_due == occurrence,
        )
        .with_for_update(skip_locked=True, of=ReminderDelivery)
    )
    if (
        existing is None
        or existing.state != "claimed"
        or as_utc(existing.lease_expires_at) > now
        or existing.attempts >= MAX_ATTEMPTS
    ):
        return None
    existing.attempts += 1
    _lease(existing, now)
    return existing
