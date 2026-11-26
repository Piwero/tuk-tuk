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
- `MAX_SNOOZE`: the longest a snooze may delay one occurrence's alert.

Quiet hours (issue #567) move when a Reminder is delivered, never its
`fire_at`: one falling due inside the band is held, its window opens at the
band's end instead (`deliver_at`), and nothing at all is claimed while the
band is on. The ledger key is unchanged, so a held Reminder notifies once.

The ledger's unique key (Task, offset, occurrence due date) is what makes
one occurrence claimable once: two tabs inserting the same key race on the
index and only one wins.

Overrides of when a Reminder comes due compose in one order:
`effective_fire_at` applies a snooze (issue #566), which replaces the nominal
fire time of its one occurrence, then `deliver_at` applies Quiet hours. The
window is measured from that final time. Task dates are never changed to get
there. `scheduled_reminders` is the one place that composes them; the claim,
the held list and the missed list (app.missed_reminders) only filter what it
returns.
"""

import re
import secrets
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, tzinfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DeliveryState, ReminderDelivery, Task
from app.quiet_hours import QuietHours, held_until
from app.recurrence import local_zone
from app.schemas import as_utc

DELIVERY_WINDOW = timedelta(minutes=5)
LEASE = timedelta(seconds=60)
MAX_ATTEMPTS = 3
# A snooze is a short delay, at most a day: anything longer is a new date,
# which the User sets on the Task itself.
MAX_SNOOZE = timedelta(days=1)

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


# A ledger key: (task id, offset, occurrence due date in UTC).
Key = tuple[int, str, datetime]


def ledger_key(task_id: int, offset: str, occurrence_due: datetime) -> Key:
    """The ledger key naming one Reminder of one Task occurrence."""
    return (task_id, offset, as_utc(occurrence_due))


def occurrence_key(task: Task, offset: str) -> Key:
    """The ledger key of `offset` on the Task's current occurrence."""
    return ledger_key(task.id, offset, task.due_date)  # type: ignore[arg-type]  # dated Tasks only


def effective_fire_at(nominal: datetime, key: Key, snoozes: Mapping[Key, datetime]) -> datetime:
    """When this occurrence's Reminder actually comes due: its snooze, if the
    User snoozed it (issue #566), else its nominal fire time. Quiet hours
    then apply on top of it, in `deliver_at`."""
    return snoozes.get(key, nominal)


def deliver_at(at: datetime, quiet: QuietHours | None, caller_zone: tzinfo) -> datetime:
    """When a Reminder coming due at `at` (its effective fire time) is
    delivered: `at` itself, or the end of the Quiet hours band it falls in
    (issue #567). Its delivery window opens here."""
    return held_until(at, quiet, caller_zone) or at


@dataclass(frozen=True)
class ScheduledReminder:
    """One Reminder of one open Task occurrence and its times: `fire_at` is
    the nominal time (Task date plus offset), `effective_at` that time after
    any snooze, and `deliver_at` the final one, after Quiet hours too. Due,
    held and missed Reminders are all ScheduledReminders, read at different
    moments against `deliver_at`."""

    task: Task
    offset: str
    fire_at: datetime
    effective_at: datetime
    deliver_at: datetime

    @property
    def key(self) -> Key:
        return occurrence_key(self.task, self.offset)


def scheduled_reminders(
    tasks: list[Task],
    caller_zone: tzinfo,
    snoozes: Mapping[Key, datetime] | None = None,
    quiet: QuietHours | None = None,
) -> list[ScheduledReminder]:
    """Every Reminder of these open, dated Tasks with its nominal, effective
    and delivery times: the one place the overrides compose."""
    found = []
    for task in tasks:
        if task.completed or task.due_date is None:
            continue
        for offset in task.reminders:
            nominal = fire_at(task, offset, caller_zone)
            if nominal is None:
                continue
            at = effective_fire_at(nominal, occurrence_key(task, offset), snoozes or {})
            found.append(
                ScheduledReminder(
                    task=task,
                    offset=offset,
                    fire_at=nominal,
                    effective_at=at,
                    deliver_at=deliver_at(at, quiet, caller_zone),
                )
            )
    return found


def due_reminders(
    tasks: list[Task],
    now: datetime,
    caller_zone: tzinfo,
    snoozes: Mapping[Key, datetime] | None = None,
    quiet: QuietHours | None = None,
) -> list[ScheduledReminder]:
    """The Reminders of these Tasks inside their delivery window at `now`,
    the window measured from each one's delivery time: after any snooze,
    then Quiet hours. None while `now` is inside Quiet hours."""
    if quiet is not None and quiet.contains(now, caller_zone):
        return []
    return [
        reminder
        for reminder in scheduled_reminders(tasks, caller_zone, snoozes, quiet)
        if reminder.deliver_at <= now < reminder.deliver_at + DELIVERY_WINDOW
    ]


def held_reminders(
    tasks: list[Task],
    now: datetime,
    caller_zone: tzinfo,
    quiet: QuietHours | None,
    snoozes: Mapping[Key, datetime] | None = None,
) -> list[ScheduledReminder]:
    """The Reminders that came due (after any snooze) but are held by Quiet
    hours at `now`, soonest delivery first: what the app lists while the
    band is on."""
    found = [
        reminder
        for reminder in scheduled_reminders(tasks, caller_zone, snoozes, quiet)
        if reminder.effective_at <= now < reminder.deliver_at
    ]
    return sorted(found, key=lambda r: (r.deliver_at, r.fire_at, r.task.id))


async def snoozes_of(session: AsyncSession) -> dict[Key, datetime]:
    """Every snoozed occurrence's new fire time, by ledger key."""
    rows = await session.execute(
        select(
            ReminderDelivery.task_id,
            ReminderDelivery.offset,
            ReminderDelivery.occurrence_due,
            ReminderDelivery.snoozed_until,
        ).where(ReminderDelivery.snoozed_until.is_not(None))
    )
    return {
        ledger_key(task_id, offset, occurrence): as_utc(until)  # type: ignore[arg-type]  # filtered non-null
        for task_id, offset, occurrence, until in rows
    }


async def ledger_row(
    session: AsyncSession, key: Key, *, skip_locked: bool = False
) -> ReminderDelivery | None:
    """The ledger row under `key`, if any. With `skip_locked`, a row another
    transaction is writing right now reads as absent (it is theirs)."""
    task_id, offset, occurrence_due = key
    query = select(ReminderDelivery).where(
        ReminderDelivery.task_id == task_id,
        ReminderDelivery.offset == offset,
        ReminderDelivery.occurrence_due == occurrence_due,
    )
    if skip_locked:
        query = query.with_for_update(skip_locked=True, of=ReminderDelivery)
    return await session.scalar(query)


def new_lease_token() -> str:
    return secrets.token_urlsafe(24)


def is_stale(row: ReminderDelivery) -> bool:
    """Whether the row's occurrence is gone: the Task was completed,
    advanced or redated, or the Reminder removed. Such a row never notifies
    again and can't be snoozed."""
    task = row.task
    return (
        task.completed
        or task.due_date is None
        or as_utc(task.due_date) != as_utc(row.occurrence_due)
        or row.offset not in task.reminders
    )


def snooze(row: ReminderDelivery, now: datetime, delay: timedelta) -> None:
    """Snoozes the row's occurrence (issue #566): it comes due again `delay`
    from now and is claimed then as a fresh delivery. A new token revokes
    any lease still out, so a tab holding it gets `lease_lost`."""
    row.snoozed_until = now + delay
    row.state = DeliveryState.SNOOZED
    row.lease_token = new_lease_token()


def _lease(row: ReminderDelivery, now: datetime) -> None:
    row.lease_token = new_lease_token()
    row.lease_expires_at = now + LEASE
    row.claimed_at = now


async def open_dated_tasks(session: AsyncSession) -> list[Task]:
    """The User's open Tasks with a date: every Task a Reminder can be due on."""
    return list(
        (
            await session.scalars(
                select(Task).where(Task.completed.is_(False), Task.due_date.is_not(None))
            )
        ).all()
    )


async def claim_due(
    session: AsyncSession,
    now: datetime,
    caller_zone: tzinfo,
    quiet: QuietHours | None = None,
) -> list[ReminderDelivery]:
    """Claims every Reminder due now that no tab holds: new ones, and
    unreported ones whose lease expired with attempts left. Commits."""
    tasks = await open_dated_tasks(session)
    claimed = []
    for due in due_reminders(tasks, now, caller_zone, await snoozes_of(session), quiet):
        row = await _claim_one(session, due, now)
        if row is not None:
            claimed.append(row)
    await session.commit()
    return claimed


async def _claim_one(
    session: AsyncSession, due: ScheduledReminder, now: datetime
) -> ReminderDelivery | None:
    row = ReminderDelivery(
        task_id=due.task.id,
        offset=due.offset,
        occurrence_due=due.key[2],
        fire_at=due.fire_at,
        state=DeliveryState.CLAIMED,
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
    existing = await ledger_row(session, due.key, skip_locked=True)
    if existing is not None and existing.state == DeliveryState.SNOOZED:
        # The snooze came due: a fresh delivery of the same occurrence.
        existing.state = DeliveryState.CLAIMED
        existing.attempts = 1
        existing.reported_at = None
        _lease(existing, now)
        return existing
    if (
        existing is None
        or existing.state != DeliveryState.CLAIMED
        or as_utc(existing.lease_expires_at) > now
        or existing.attempts >= MAX_ATTEMPTS
    ):
        return None
    existing.attempts += 1
    _lease(existing, now)
    return existing
