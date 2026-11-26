"""Missed reminders (issue #565, ADR 0019): Reminders whose delivery window
closed without the browser showing them. They are never replayed as late
system notifications; the app lists them in-app instead.

A Reminder of a Task's current, open occurrence is missed once its window
(its final delivery time + `DELIVERY_WINDOW`) has passed, unless the ledger says it was
shown, dismissed, or is still leased to a tab that may yet report it. Most
misses have no ledger row at all: no tab was open to claim them. So the
list is worked out from the Tasks, exactly as a claim is, and stale
occurrences (completed, deleted, advanced, moved, Reminder removed) drop
out the same way.

Dismissing records the entry in the ledger as `dismissed`: a new row for a
Reminder never claimed, or the existing one, whose lease it revokes.
"""

import secrets
from datetime import datetime, tzinfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ReminderDelivery
from app.quiet_hours import QuietHours
from app.reminder_delivery import (
    DELIVERY_WINDOW,
    Due,
    deliver_at,
    open_dated_tasks,
    open_reminders,
    snoozes_of,
)
from app.schemas import as_utc

# Ledger states that take a Reminder off the missed list for good.
_SETTLED = ("shown", "dismissed")


async def missed_reminders(
    session: AsyncSession,
    now: datetime,
    caller_zone: tzinfo,
    quiet: QuietHours | None = None,
) -> list[Due]:
    """The User's missed Reminders at `now`, newest first. The window is
    measured from each Reminder's final delivery time, after any snooze
    (#566) and Quiet hours (#567), exactly as a claim measures it: a held or
    snoozed Reminder is not missed before that window passes."""
    tasks = await open_dated_tasks(session)
    snoozes = await snoozes_of(session)
    candidates = []
    for task, offset, nominal, at in open_reminders(tasks, caller_zone, snoozes):
        when = deliver_at(at, quiet, caller_zone)
        if when + DELIVERY_WINDOW <= now:
            candidates.append(Due(task=task, offset=offset, fire_at=nominal, deliver_at=when))
    if not candidates:
        return []
    rows = await session.scalars(
        select(ReminderDelivery).where(
            ReminderDelivery.task_id.in_({due.task.id for due in candidates})
        )
    )
    ledger = {(row.task_id, row.offset, as_utc(row.occurrence_due)): row for row in rows}
    found = [due for due in candidates if not _accounted_for(ledger.get(_key(due)), now)]
    return sorted(found, key=lambda due: (due.fire_at, due.task.id), reverse=True)


def _key(due: Due) -> tuple[int, str, datetime]:
    return (due.task.id, due.offset, as_utc(due.task.due_date))  # type: ignore[arg-type]


def _accounted_for(row: ReminderDelivery | None, now: datetime) -> bool:
    """Shown, dismissed, or leased to a tab that may still report it."""
    if row is None:
        return False
    if row.state in _SETTLED:
        return True
    return row.state == "claimed" and as_utc(row.lease_expires_at) > now


async def dismiss_missed(
    session: AsyncSession,
    now: datetime,
    caller_zone: tzinfo,
    task_id: int,
    offset: str,
    occurrence_due: datetime,
    quiet: QuietHours | None = None,
) -> ReminderDelivery | None:
    """Records the dismissal of one missed Reminder, or of one already
    dismissed (idempotent). None when no such entry is on the list: not
    the User's Task, not missed, or not the current occurrence. Commits."""
    key = (task_id, offset, as_utc(occurrence_due))
    existing = await _ledger_row(session, *key)
    if existing is not None and existing.state == "dismissed":
        return existing
    due = next(
        (d for d in await missed_reminders(session, now, caller_zone, quiet) if _key(d) == key),
        None,
    )
    if due is None:
        return None
    if existing is None:
        row = ReminderDelivery(
            task_id=task_id,
            offset=offset,
            occurrence_due=key[2],
            fire_at=due.fire_at,
            attempts=0,
            claimed_at=now,
        )
        row.task = due.task
        _settle(row, now)
        try:
            async with session.begin_nested():
                session.add(row)
        except IntegrityError:
            # Another tab dismissed it at the same moment.
            if row in session:
                session.expunge(row)
            return await _ledger_row(session, *key)
        await session.commit()
        return row
    _settle(existing, now)
    await session.commit()
    return existing


def _settle(row: ReminderDelivery, now: datetime) -> None:
    """Marks a row dismissed. A fresh token revokes any lease still out, so
    a late `shown` report from an abandoned tab gets `409 lease_lost`. The
    lease columns are required; a never-claimed row gets an expired lease
    at the moment of dismissal."""
    row.state = "dismissed"
    row.lease_token = secrets.token_urlsafe(24)
    row.lease_expires_at = now
    row.reported_at = now


async def _ledger_row(
    session: AsyncSession, task_id: int, offset: str, occurrence_due: datetime
) -> ReminderDelivery | None:
    return await session.scalar(
        select(ReminderDelivery).where(
            ReminderDelivery.task_id == task_id,
            ReminderDelivery.offset == offset,
            ReminderDelivery.occurrence_due == occurrence_due,
        )
    )
