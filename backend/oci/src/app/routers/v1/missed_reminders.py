"""Missed reminder endpoints (issue #565, ADR 0019).

The app lists the Reminders whose delivery window closed unseen instead of
replaying them as late system notifications, and the User dismisses them
one by one. Every Task and ledger row read is the User's own (ADR 0018):
another User's Task is not on the list and cannot be dismissed.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from app.caller_zone import caller_zone_or_utc
from app.db import SessionDep
from app.errors import NotFoundError
from app.missed_reminders import dismiss_missed, missed_reminders, snooze_missed
from app.routers.v1.reminder_deliveries import ReminderDeliveryRead, SnoozeRequest, quiet_hours
from app.schemas import as_utc
from app.user_settings import CurrentUserSettings

router = APIRouter(prefix="/api/v1/reminder-deliveries/missed", tags=["reminder deliveries"])


class MissedReminder(BaseModel):
    """One Reminder of one Task occurrence that came due unseen. The key
    (`task_id`, `offset`, `occurrence_due`) names it for dismissal."""

    task_id: int
    task_title: str
    offset: str
    occurrence_due: datetime
    fire_at: datetime
    # The Task's, so the occurrence reads as the Task shows its date.
    is_all_day: bool
    time_zone: str | None
    # Its ledger row, when a tab ever claimed it: snooze that row through
    # the ordinary snooze. Null for a Reminder no tab was open for, which
    # is snoozed from the list by its key instead (#566).
    delivery_id: int | None


class MissedPage(BaseModel):
    items: list[MissedReminder]


class Dismissal(BaseModel):
    task_id: int
    offset: str
    occurrence_due: datetime


class MissedSnooze(Dismissal, SnoozeRequest):
    """A missed Reminder, by its key, and how long to snooze it."""


@router.get("")
async def list_missed(
    request: Request,
    session: SessionDep,
    user_settings: CurrentUserSettings,
    tz: Annotated[str | None, Query()] = None,
) -> MissedPage:
    """The Reminders missed so far, newest first. `tz` is the tab's IANA
    zone, the anchor of all-day Tasks. Empty while the User has Reminder
    notifications off: nothing was meant to notify."""
    zone = caller_zone_or_utc(tz)
    if not user_settings.reminder_notifications_enabled:
        return MissedPage(items=[])
    found = await missed_reminders(
        session,
        request.app.state.clock(),
        zone,
        user_settings.reminder_notifications_enabled_at,
        quiet_hours(user_settings),
    )
    return MissedPage(
        items=[
            MissedReminder(
                task_id=missed.due.task.id,
                task_title=missed.due.task.title,
                offset=missed.due.offset,
                occurrence_due=as_utc(missed.due.task.due_date),  # type: ignore[arg-type]
                fire_at=missed.due.fire_at,
                is_all_day=missed.due.task.is_all_day,
                time_zone=missed.due.task.time_zone,
                delivery_id=None if missed.row is None else missed.row.id,
            )
            for missed in found
        ]
    )


@router.post("/dismiss")
async def dismiss(
    payload: Dismissal,
    request: Request,
    session: SessionDep,
    user_settings: CurrentUserSettings,
    tz: Annotated[str | None, Query()] = None,
) -> ReminderDeliveryRead:
    """Dismisses one missed Reminder: recorded in the ledger, it never
    appears or notifies again. Repeating it changes nothing."""
    zone = caller_zone_or_utc(tz)
    row = await dismiss_missed(
        session,
        request.app.state.clock(),
        zone,
        payload.task_id,
        payload.offset,
        payload.occurrence_due,
        user_settings.reminder_notifications_enabled_at,
        quiet_hours(user_settings),
    )
    if row is None:
        raise NotFoundError("Missed reminder not found")
    return ReminderDeliveryRead.of(row)


@router.post("/snooze")
async def snooze(
    payload: MissedSnooze,
    request: Request,
    session: SessionDep,
    user_settings: CurrentUserSettings,
    tz: Annotated[str | None, Query()] = None,
) -> ReminderDeliveryRead:
    """Snoozes one missed Reminder (#566): it notifies once more `minutes`
    from now. Its ledger row is snoozed, or created already snoozed for a
    Reminder no tab ever claimed. Only the ledger changes, never the Task.
    404 when it is not on the User's missed list."""
    zone = caller_zone_or_utc(tz)
    row = await snooze_missed(
        session,
        request.app.state.clock(),
        zone,
        payload.task_id,
        payload.offset,
        payload.occurrence_due,
        payload.minutes,
        user_settings.reminder_notifications_enabled_at,
        quiet_hours(user_settings),
    )
    if row is None:
        raise NotFoundError("Missed reminder not found")
    return ReminderDeliveryRead.of(row)
