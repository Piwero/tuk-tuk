"""Reminder delivery ledger endpoints (issue #561, ADR 0019).

An open, signed-in tab claims the Reminders due now, shows each one, and
reports how that went. Every row is the User's own (ADR 0018): another
User's id is a 404.
"""

from datetime import datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field, field_serializer
from sqlalchemy import select

from app.caller_zone import caller_zone_or_utc
from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.models import ReminderDelivery, UserSettings
from app.quiet_hours import QuietHours, held_until
from app.reminder_delivery import (
    claim_due,
    held_reminders,
    new_lease_token,
    open_dated_tasks,
    snoozes_of,
)
from app.schemas import as_utc, utc_z
from app.user_settings import CurrentUserSettings

router = APIRouter(prefix="/api/v1/reminder-deliveries", tags=["reminder deliveries"])

DeliveryState = Literal["claimed", "shown", "failed", "snoozed"]
ReportOutcome = Literal["shown", "failed"]


class ReminderDeliveryRead(BaseModel):
    id: int
    task_id: int
    task_title: str
    offset: str
    occurrence_due: datetime
    fire_at: datetime
    state: DeliveryState
    attempt: int
    # Set once the User snoozed it (issue #566): when it comes due again.
    snoozed_until: datetime | None = None

    @classmethod
    def of(cls, row: ReminderDelivery) -> "ReminderDeliveryRead":
        return cls(
            id=row.id,
            task_id=row.task_id,
            task_title=row.task.title,
            offset=row.offset,
            occurrence_due=row.occurrence_due,
            fire_at=row.fire_at,
            state=row.state,
            attempt=row.attempts,
            snoozed_until=row.snoozed_until,
        )


class ReminderClaim(ReminderDeliveryRead):
    """A lease on one delivery: report it with `lease_token` before
    `lease_expires_at`, or a later claim may retry it."""

    lease_token: str
    lease_expires_at: datetime


class HeldReminder(BaseModel):
    """A Reminder that fired inside Quiet hours (issue #567) and waits for
    the band's end, listed in-app while it waits."""

    task_id: int
    task_title: str
    offset: str
    fire_at: datetime
    deliver_at: datetime

    @field_serializer("fire_at", "deliver_at")
    def serialize_instants(self, value: datetime) -> str:
        return utc_z(value)


class ClaimPage(BaseModel):
    items: list[ReminderClaim]
    # Quiet hours (issue #567): what is held right now, and when the band
    # holding `now` ends (null outside the band or with Quiet hours off).
    held: list[HeldReminder] = []
    quiet_until: datetime | None = None

    @field_serializer("quiet_until")
    def serialize_quiet_until(self, value: datetime | None) -> str | None:
        return None if value is None else utc_z(value)


class LedgerPage(BaseModel):
    items: list[ReminderDeliveryRead]


class DeliveryReport(BaseModel):
    lease_token: str


def quiet_hours(user_settings: UserSettings) -> QuietHours | None:
    """The User's Quiet hours band, or None while it is off. Active hours
    are never read: they shape the Calendar only."""
    if not user_settings.quiet_hours_enabled:
        return None
    return QuietHours.parse(user_settings.quiet_hours_start, user_settings.quiet_hours_end)


# A snooze is a short delay, at most a day: anything longer is a new date,
# which the User sets on the Task itself.
MAX_SNOOZE_MINUTES = 24 * 60


class SnoozeRequest(BaseModel):
    minutes: int = Field(ge=1, le=MAX_SNOOZE_MINUTES)


@router.post("/claim")
async def claim(
    request: Request,
    session: SessionDep,
    user_settings: CurrentUserSettings,
    tz: Annotated[str | None, Query()] = None,
) -> ClaimPage:
    """Claims the Reminders due now that no other tab holds. `tz` is the
    tab's IANA zone, the anchor of all-day Tasks. Nothing is claimed while
    the User has Reminder notifications off."""
    zone = caller_zone_or_utc(tz)
    if not user_settings.reminder_notifications_enabled:
        return ClaimPage(items=[])
    now = request.app.state.clock()
    quiet = quiet_hours(user_settings)
    rows = await claim_due(session, now, zone, quiet)
    held = held_reminders(
        await open_dated_tasks(session), now, zone, quiet, await snoozes_of(session)
    )
    return ClaimPage(
        held=[
            HeldReminder(
                task_id=due.task.id,
                task_title=due.task.title,
                offset=due.offset,
                fire_at=due.fire_at,
                deliver_at=due.deliver_at,
            )
            for due in held
        ],
        quiet_until=held_until(now, quiet, zone),
        items=[
            ReminderClaim(
                **ReminderDeliveryRead.of(row).model_dump(),
                lease_token=row.lease_token,
                lease_expires_at=row.lease_expires_at,
            )
            for row in rows
        ],
    )


@router.get("")
async def list_deliveries(session: SessionDep) -> LedgerPage:
    """The User's delivery ledger, newest Reminder first."""
    rows = await session.scalars(
        select(ReminderDelivery).order_by(
            ReminderDelivery.fire_at.desc(), ReminderDelivery.id.desc()
        )
    )
    return LedgerPage(items=[ReminderDeliveryRead.of(row) for row in rows])


async def report(
    delivery_id: int,
    payload: DeliveryReport,
    outcome: ReportOutcome,
    request: Request,
    session: SessionDep,
) -> ReminderDeliveryRead:
    row = await session.get(ReminderDelivery, delivery_id)
    if row is None:
        raise NotFoundError(f"Reminder delivery {delivery_id} not found")
    if row.lease_token != payload.lease_token:
        raise APIError(
            status_code=409,
            code="lease_lost",
            message="Another tab has claimed this reminder since",
        )
    if row.state == "claimed":
        row.state = outcome
        row.reported_at = request.app.state.clock()
        await session.commit()
    return ReminderDeliveryRead.of(row)


@router.post("/{delivery_id}/shown")
async def report_shown(
    delivery_id: int, payload: DeliveryReport, request: Request, session: SessionDep
) -> ReminderDeliveryRead:
    """The browser reported the notification shown, as far as a page can
    tell; never proof the operating system displayed it."""
    return await report(delivery_id, payload, "shown", request, session)


@router.post("/{delivery_id}/failed")
async def report_failed(
    delivery_id: int, payload: DeliveryReport, request: Request, session: SessionDep
) -> ReminderDeliveryRead:
    """The browser refused to show it. Final: it is not retried."""
    return await report(delivery_id, payload, "failed", request, session)


@router.post("/{delivery_id}/snooze")
async def snooze(
    delivery_id: int, payload: SnoozeRequest, request: Request, session: SessionDep
) -> ReminderDeliveryRead:
    """Snoozes this occurrence's Reminder (issue #566): it comes due again
    `minutes` from now and is claimed once more then, like a first
    delivery. Only the ledger row changes; the Task's dates, Reminder
    offsets and recurrence stay as they are. Snoozing again moves the time.
    Refused with 409 `reminder_stale` when the occurrence is gone: the Task
    was completed, advanced or redated, or the Reminder removed."""
    row = await session.get(ReminderDelivery, delivery_id)
    if row is None:
        raise NotFoundError(f"Reminder delivery {delivery_id} not found")
    task = row.task
    if (
        task.completed
        or task.due_date is None
        or as_utc(task.due_date) != as_utc(row.occurrence_due)
        or row.offset not in task.reminders
    ):
        raise APIError(
            status_code=409,
            code="reminder_stale",
            message="This reminder's Task occurrence has changed since it was delivered",
        )
    row.snoozed_until = request.app.state.clock() + timedelta(minutes=payload.minutes)
    row.state = "snoozed"
    # Any tab still holding the old lease can no longer report on it.
    row.lease_token = new_lease_token()
    await session.commit()
    return ReminderDeliveryRead.of(row)
