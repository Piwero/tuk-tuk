"""Reminder delivery ledger endpoints (issue #561, ADR 0019).

An open, signed-in tab claims the Reminders due now, shows each one, and
reports how that went. Every row is the User's own (ADR 0018): another
User's id is a 404.
"""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from sqlalchemy import select

from app.caller_zone import caller_zone_or_utc
from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.models import ReminderDelivery
from app.reminder_delivery import claim_due
from app.user_settings import CurrentUserSettings

router = APIRouter(prefix="/api/v1/reminder-deliveries", tags=["reminder deliveries"])

DeliveryState = Literal["claimed", "shown", "failed"]


class ReminderDeliveryRead(BaseModel):
    id: int
    task_id: int
    task_title: str
    offset: str
    occurrence_due: datetime
    fire_at: datetime
    state: DeliveryState
    attempt: int

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
        )


class ReminderClaim(ReminderDeliveryRead):
    """A lease on one delivery: report it with `lease_token` before
    `lease_expires_at`, or a later claim may retry it."""

    lease_token: str
    lease_expires_at: datetime


class ClaimPage(BaseModel):
    items: list[ReminderClaim]


class LedgerPage(BaseModel):
    items: list[ReminderDeliveryRead]


class DeliveryReport(BaseModel):
    lease_token: str


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
    rows = await claim_due(session, request.app.state.clock(), zone)
    return ClaimPage(
        items=[
            ReminderClaim(
                **ReminderDeliveryRead.of(row).model_dump(),
                lease_token=row.lease_token,
                lease_expires_at=row.lease_expires_at,
            )
            for row in rows
        ]
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
    outcome: DeliveryState,
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
