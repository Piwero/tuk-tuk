"""Missed reminders (issue #565, ADR 0019): Reminders whose delivery window
closed without the browser showing them. They are never replayed as late
system notifications; the app lists them in-app instead.

A Reminder of a Task's current, open occurrence is missed once its window
(its final delivery time + `DELIVERY_WINDOW`) has passed, unless the ledger
says it was shown, dismissed, or is still leased to a tab that may yet
report it. Only a Reminder delivered at or after the moment the User last
turned Reminder notifications on can have been missed (#535). Most misses
have no ledger row at all: no tab was open to claim them. So the list is
worked out from the Tasks, exactly as a claim is
(`app.reminder_delivery.scheduled_reminders`), and stale occurrences
(completed, deleted, advanced, moved, Reminder removed) drop out the same
way.

Dismissing records the entry in the ledger as `dismissed`: a new row for a
Reminder never claimed, or the existing one, whose lease it revokes.
Snoozing one from the list (#566) does the same with a `snoozed` row.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, tzinfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DeliveryState, ReminderDelivery
from app.quiet_hours import QuietHours
from app.reminder_delivery import (
    DELIVERY_WINDOW,
    Key,
    ScheduledReminder,
    ledger_row,
    new_lease_token,
    open_dated_tasks,
    scheduled_reminders,
    snooze,
    snoozes_of,
)
from app.schemas import as_utc

# Ledger states that take a Reminder off the missed list for good.
_SETTLED = (DeliveryState.SHOWN, DeliveryState.DISMISSED)


@dataclass(frozen=True)
class Missed:
    """One missed Reminder, with its ledger row when a tab ever claimed it
    (or the User acted on it): None for a Reminder no tab was open for."""

    reminder: ScheduledReminder
    row: ReminderDelivery | None


@dataclass(frozen=True)
class MissedRule:
    """What the missed list is read against: the caller's zone (all-day
    anchors and Quiet hours), when the User turned Reminder notifications on
    (None: never), and their Quiet hours (None: off)."""

    caller_zone: tzinfo
    since: datetime | None
    quiet: QuietHours | None = None


async def missed_reminders(session: AsyncSession, now: datetime, rule: MissedRule) -> list[Missed]:
    """The User's missed Reminders at `now`, newest first. The window is
    measured from each Reminder's final delivery time, after any snooze
    (#566) and Quiet hours (#567), exactly as a claim measures it: a held or
    snoozed Reminder is not missed before that window passes. Only one
    delivered at or after `rule.since` can have been missed (#535)."""
    since = rule.since
    if since is None:
        return []
    candidates = [
        reminder
        for reminder in scheduled_reminders(
            await open_dated_tasks(session),
            rule.caller_zone,
            await snoozes_of(session),
            rule.quiet,
        )
        if since <= reminder.deliver_at and reminder.deliver_at + DELIVERY_WINDOW <= now
    ]
    if not candidates:
        return []
    rows = await session.scalars(
        select(ReminderDelivery).where(
            ReminderDelivery.task_id.in_({reminder.task.id for reminder in candidates})
        )
    )
    ledger = {(row.task_id, row.offset, as_utc(row.occurrence_due)): row for row in rows}
    found = [
        Missed(reminder=reminder, row=ledger.get(reminder.key))
        for reminder in candidates
        if not _accounted_for(ledger.get(reminder.key), now)
    ]
    return sorted(found, key=lambda m: (m.reminder.fire_at, m.reminder.task.id), reverse=True)


def _accounted_for(row: ReminderDelivery | None, now: datetime) -> bool:
    """Shown, dismissed, or leased to a tab that may still report it."""
    if row is None:
        return False
    if row.state in _SETTLED:
        return True
    return row.state == DeliveryState.CLAIMED and as_utc(row.lease_expires_at) > now


async def dismiss_missed(
    session: AsyncSession, now: datetime, rule: MissedRule, key: Key
) -> ReminderDelivery | None:
    """Records the dismissal of one missed Reminder, or of one already
    dismissed (idempotent). None when no such entry is on the list: not
    the User's Task, not missed, or not the current occurrence. Commits."""
    existing = await ledger_row(session, key)
    if existing is not None and existing.state == DeliveryState.DISMISSED:
        return existing
    return await _act_on_missed(session, now, rule, key, lambda row: _settle(row, now))


async def snooze_missed(
    session: AsyncSession, now: datetime, rule: MissedRule, key: Key, delay: timedelta
) -> ReminderDelivery | None:
    """Snoozes one missed Reminder from the list (#566): its ledger row,
    or for a Reminder no tab ever claimed, a new row created already
    snoozed under the same key. None when no such entry is on the list.
    Commits."""
    return await _act_on_missed(session, now, rule, key, lambda row: snooze(row, now, delay))


async def _act_on_missed(
    session: AsyncSession,
    now: datetime,
    rule: MissedRule,
    key: Key,
    act: Callable[[ReminderDelivery], None],
) -> ReminderDelivery | None:
    """Applies `act` to the ledger row of the missed Reminder under `key`,
    creating the row first for a Reminder no tab ever claimed. None when
    no such entry is on the list. Commits."""
    missed = next(
        (m for m in await missed_reminders(session, now, rule) if m.reminder.key == key), None
    )
    if missed is None:
        return None
    row = missed.row
    if row is None:
        row = _unclaimed_row(missed.reminder, now)
        act(row)
        try:
            async with session.begin_nested():
                session.add(row)
        except IntegrityError:
            # Another tab acted on it at the same moment: act on that row.
            if row in session:
                session.expunge(row)
            row = await ledger_row(session, key)
            if row is None:
                return None
            act(row)
    else:
        act(row)
    await session.commit()
    return row


def _unclaimed_row(reminder: ScheduledReminder, now: datetime) -> ReminderDelivery:
    """A ledger row for a Reminder no tab ever claimed. The lease columns
    are required, so it gets an already-expired lease and no attempts."""
    row = ReminderDelivery(
        task_id=reminder.task.id,
        offset=reminder.offset,
        occurrence_due=reminder.key[2],
        fire_at=reminder.fire_at,
        attempts=0,
        claimed_at=now,
        lease_token=new_lease_token(),
        lease_expires_at=now,
    )
    row.task = reminder.task
    return row


def _settle(row: ReminderDelivery, now: datetime) -> None:
    """Marks a row dismissed. A fresh token revokes any lease still out, so
    a late `shown` report from an abandoned tab gets `409 lease_lost`."""
    row.state = DeliveryState.DISMISSED
    row.lease_token = new_lease_token()
    row.lease_expires_at = now
    row.reported_at = now
