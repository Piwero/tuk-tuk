"""Wire shapes shared by the Reminder delivery endpoints (issue #561, ADR
0019): the ledger and claim routes (app.routers.v1.reminder_deliveries) and
the missed list (app.routers.v1.missed_reminders) answer with the same row,
and take the same snooze.
"""

from datetime import datetime, timedelta

from pydantic import BaseModel, Field

from app.models import DeliveryState, ReminderDelivery
from app.reminder_delivery import MAX_SNOOZE


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
            state=DeliveryState(row.state),
            attempt=row.attempts,
            snoozed_until=row.snoozed_until,
        )


class SnoozeRequest(BaseModel):
    minutes: int = Field(ge=1, le=MAX_SNOOZE // timedelta(minutes=1))
