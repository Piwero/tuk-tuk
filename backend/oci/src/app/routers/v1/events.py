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
answers no events rather than 404ing like the /google/* routes do — unlike
those settings routes, the Calendar view always calls this one and must
render fine whether or not Google Calendar is set up at all.

Issue #109: one account's Events are read independently of every other
account's. A failure on one account's read never blanks the others — it's
reported in `failures` alongside whatever `events` the rest of the accounts
still answered. If an account has several calendars and only one of them
fails mid-read, whatever calendars already succeeded for that account still
contribute their events, and the account is still reported as failed — a
partial read is never silently upgraded to "this account is fine". A
`TerminalCalendarSourceError` (the grant is revoked or expired) additionally
flips that account's `connection_state`, so Settings and the Calendar
banner agree on which accounts need reconnecting.
`list_events` reads pass through a short-lived cache (`app.state.event_cache`)
keyed on the exact calendar and window, so paging quickly through the
Calendar view doesn't refetch on every render; an account whose calendars
are all cached skips its credential refresh too, since that's itself a
request to Google. `force=true` (the toolbar's manual refresh, and its
Retry affordance for a failed account) bypasses the cache entirely.
"""

from collections import defaultdict
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import select

from app.calendar_source import (
    CalendarSource,
    TerminalCalendarSourceError,
    TransientCalendarSourceError,
)
from app.calendar_source import EventAttendee as CalendarEventAttendee
from app.calendar_window import validate_range_pair
from app.config import Settings, google_configured
from app.crypto import decrypt_credential
from app.db import SessionDep
from app.errors import APIError
from app.event_cache import EventCache
from app.models import GoogleAccount, GoogleCalendar

router = APIRouter(prefix="/api/v1/events", tags=["events"])


class EventAttendeeRead(BaseModel):
    email: str
    display_name: str | None


class EventRead(BaseModel):
    id: str
    title: str
    start_date: str
    due_date: str
    is_all_day: bool
    color: str
    # Everything below exists only for the read-only Event detail popover
    # (issue #110) — no other part of tuk-tuk reads it.
    location: str | None
    description: str | None
    attendees: list[EventAttendeeRead]
    organizer: EventAttendeeRead | None
    html_link: str
    account_email: str
    calendar_summary: str


class EventFailureRead(BaseModel):
    """One connected account whose Events couldn't be read this time.
    `kind` names why: "transient" for network trouble, a server error, or
    rate limiting (retry-safe, the account stays connected); "terminal" for
    a revoked or expired grant (the account now needs reconnecting)."""

    account_id: int
    email: str
    kind: Literal["transient", "terminal"]
    message: str


class EventsRead(BaseModel):
    events: list[EventRead]
    failures: list[EventFailureRead]


async def _enabled_calendars(session: SessionDep) -> list[GoogleCalendar]:
    rows = await session.scalars(
        select(GoogleCalendar).where(GoogleCalendar.enabled).order_by(GoogleCalendar.id)
    )
    return list(rows)


def _attendee_read(attendee: CalendarEventAttendee) -> EventAttendeeRead:
    return EventAttendeeRead(email=attendee.email, display_name=attendee.display_name)


@router.get("")
async def read_events(
    request: Request,
    session: SessionDep,
    range_start: date | None = None,
    range_end: date | None = None,
    force: bool = False,
) -> EventsRead:
    """Events from every enabled calendar of every connected Google Account,
    whose window overlaps the inclusive [range_start, range_end] calendar-day
    span. `force=true` bypasses the short-lived cache and re-reads Google."""
    validate_range_pair(range_start, range_end)
    if range_start is None or range_end is None:
        raise APIError(
            status_code=422,
            code="validation_error",
            message="range_start and range_end are required",
        )

    settings: Settings = request.app.state.settings
    if not google_configured(settings):
        return EventsRead(events=[], failures=[])

    calendars = await _enabled_calendars(session)
    if not calendars:
        return EventsRead(events=[], failures=[])

    accounts_by_id = {
        account.id: account
        for account in await session.scalars(
            select(GoogleAccount).where(
                GoogleAccount.id.in_({calendar.google_account_id for calendar in calendars})
            )
        )
    }
    calendars_by_account: dict[int, list[GoogleCalendar]] = defaultdict(list)
    for calendar in calendars:
        if calendar.google_account_id in accounts_by_id:
            calendars_by_account[calendar.google_account_id].append(calendar)

    calendar_source: CalendarSource = request.app.state.calendar_source
    event_cache: EventCache = request.app.state.event_cache
    assert settings.google_encryption_key is not None
    time_min = f"{range_start - timedelta(days=1)}T00:00:00Z"
    time_max = f"{range_end + timedelta(days=2)}T00:00:00Z"

    events: list[EventRead] = []
    failures: list[EventFailureRead] = []
    for account_id, account_calendars in calendars_by_account.items():
        account = accounts_by_id[account_id]
        cached_by_calendar = {
            calendar.id: (
                None if force else event_cache.get(calendar.google_calendar_id, time_min, time_max)
            )
            for calendar in account_calendars
        }
        try:
            # A credential refresh is itself a request to Google (the token
            # endpoint) — skipped entirely when every one of this account's
            # calendars is already cached, so rapid navigation within the
            # cache window never re-hits Google at all, not even to refresh.
            access_token = None
            if any(entries is None for entries in cached_by_calendar.values()):
                refresh_token = decrypt_credential(
                    account.encrypted_refresh_token, key=settings.google_encryption_key
                )
                access_token = (await calendar_source.refresh(refresh_token)).access_token
            for calendar in account_calendars:
                cached = cached_by_calendar[calendar.id]
                if cached is None:
                    assert access_token is not None
                    entries = await calendar_source.list_events(
                        access_token,
                        calendar.google_calendar_id,
                        time_min=time_min,
                        time_max=time_max,
                    )
                    event_cache.set(calendar.google_calendar_id, time_min, time_max, entries)
                else:
                    entries = cached
                for entry in entries:
                    events.append(
                        EventRead(
                            id=f"{calendar.id}:{entry.google_event_id}",
                            title=entry.summary,
                            start_date=entry.start,
                            due_date=entry.end,
                            is_all_day=entry.is_all_day,
                            color=calendar.color,
                            location=entry.location,
                            description=entry.description,
                            attendees=[_attendee_read(a) for a in entry.attendees],
                            organizer=(
                                None if entry.organizer is None else _attendee_read(entry.organizer)
                            ),
                            html_link=entry.html_link,
                            account_email=account.email,
                            calendar_summary=calendar.summary,
                        )
                    )
        except TerminalCalendarSourceError as exc:
            account.connection_state = "needs_reconnect"
            await session.commit()
            failures.append(
                EventFailureRead(
                    account_id=account.id, email=account.email, kind="terminal", message=str(exc)
                )
            )
        except TransientCalendarSourceError as exc:
            failures.append(
                EventFailureRead(
                    account_id=account.id, email=account.email, kind="transient", message=str(exc)
                )
            )
    return EventsRead(events=events, failures=failures)
