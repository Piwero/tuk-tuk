"""Events render in the Calendar view (issue #107).

Events are fetched live from Google for the visible window and never
persisted (ADR 0006), so this endpoint is entirely separate from the task
range query — Google's reachability never affects Task rendering speed.
`range_start`/`range_end` are the same inclusive calendar-day parameters
`GET /api/v1/tasks` takes; padded by a day on each side before being sent to
Google as `timeMin`/`timeMax`, since the caller's calendar day is read in
the viewer's own timezone (unknown to the backend) and a day at either
timezone extreme can fall up to a day outside its UTC-only reading.

When Google isn't configured, or no account is connected, the endpoint
answers an empty list rather than 404ing like the /google/* routes do —
unlike those settings routes, the Calendar view always calls this one and
must render fine whether or not Google Calendar is set up at all.
"""

from datetime import date, timedelta

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import select

from app.calendar_source import CalendarSource
from app.calendar_window import validate_range_pair
from app.config import Settings, google_configured
from app.crypto import decrypt_credential
from app.db import SessionDep
from app.errors import APIError
from app.models import GoogleAccount, GoogleCalendar

router = APIRouter(prefix="/api/v1/events", tags=["events"])


class EventRead(BaseModel):
    id: str
    title: str
    start_date: str
    due_date: str
    is_all_day: bool
    color: str


async def _enabled_calendars(session: SessionDep) -> list[GoogleCalendar]:
    rows = await session.scalars(
        select(GoogleCalendar).where(GoogleCalendar.enabled).order_by(GoogleCalendar.id)
    )
    return list(rows)


@router.get("")
async def read_events(
    request: Request,
    session: SessionDep,
    range_start: date | None = None,
    range_end: date | None = None,
) -> list[EventRead]:
    """Events from every enabled calendar of every connected Google Account,
    whose window overlaps the inclusive [range_start, range_end] calendar-day
    span."""
    validate_range_pair(range_start, range_end)
    if range_start is None or range_end is None:
        raise APIError(
            status_code=422,
            code="validation_error",
            message="range_start and range_end are required",
        )

    settings: Settings = request.app.state.settings
    if not google_configured(settings):
        return []

    calendars = await _enabled_calendars(session)
    if not calendars:
        return []

    accounts_by_id = {
        account.id: account
        for account in await session.scalars(
            select(GoogleAccount).where(
                GoogleAccount.id.in_({calendar.google_account_id for calendar in calendars})
            )
        )
    }

    calendar_source: CalendarSource = request.app.state.calendar_source
    assert settings.google_encryption_key is not None
    time_min = f"{range_start - timedelta(days=1)}T00:00:00Z"
    time_max = f"{range_end + timedelta(days=2)}T00:00:00Z"

    tokens_by_account: dict[int, str] = {}
    events: list[EventRead] = []
    for calendar in calendars:
        account = accounts_by_id.get(calendar.google_account_id)
        if account is None:
            continue
        access_token = tokens_by_account.get(account.id)
        if access_token is None:
            refresh_token = decrypt_credential(
                account.encrypted_refresh_token, key=settings.google_encryption_key
            )
            access_token = (await calendar_source.refresh(refresh_token)).access_token
            tokens_by_account[account.id] = access_token
        entries = await calendar_source.list_events(
            access_token, calendar.google_calendar_id, time_min=time_min, time_max=time_max
        )
        for entry in entries:
            events.append(
                EventRead(
                    id=f"{calendar.id}:{entry.google_event_id}",
                    title=entry.summary,
                    start_date=entry.start,
                    due_date=entry.end,
                    is_all_day=entry.is_all_day,
                    color=calendar.color,
                )
            )
    return events
