"""The week snapshot builder (ADR 0009; issue #186) — the data structure the
Assistant sees, and the only thing it can ever write to. No model is
involved here: given a database state, a local date, and an IANA timezone,
`build_week_snapshot` produces today + the next seven days exactly the way
`in_smart_view(task, "next7", ...)` already defines that window for the
`next7` Smart List (app.routers.v1.tasks) — the same "today" the caller
already resolved, never guessed from server time, per ADR 0009's snapshot
decision.

Two properties are load-bearing (ADR 0009):

1. Task `description` and Check Item titles are excluded *by construction*:
   `WeekSnapshotTask` simply has no field for either, so there is no filter
   to forget.
2. Every id in the snapshot is the model's entire writable surface — a
   later Suggestion can only ever reference a task id that appeared here.

Serialization: `WeekSnapshotTask.start_date`/`due_date` are ISO-8601 UTC
instant strings (`datetime.isoformat()`); `WeekSnapshotEvent.start`/`end`
are Google's own RFC3339 strings, passed through unchanged from
`CalendarEventEntry` — the same shape `app.routers.v1.events.EventRead`
already exposes. `priority` is one of `app.schemas.Priority`'s four names.

Today's Events reuse the same live, read-only Google fetch and per-account
failure isolation as `app.routers.v1.events` (ADR 0006, ADR 0007): a
failure reading one account's Events (network trouble, a revoked grant, an
unconfigured integration) never fails the snapshot — it just isn't part of
it, exactly as ADR 0007 already isolates one account's failure from every
other account's, and from Tasks entirely. Unlike `events.py`'s
calendar-range query (whose caller-side day boundaries are of unknown
timezone and so gets padded by a day on each side), the fetch window here
is computed as an exact UTC instant range from `local_date`/`time_zone` —
the caller's actual local midnight-to-midnight — since both are already
known here.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import google_configured, require_app_settings
from app.calendar_source import CalendarSource, CalendarSourceError
from app.config import Settings
from app.crypto import decrypt_credential
from app.event_cache import EventCache
from app.models import GoogleAccount, GoogleCalendar, Habit, Tag, Task, TaskList
from app.routers.v1.tasks import in_smart_view
from app.schemas import Priority


class WeekSnapshotTask(BaseModel):
    id: int
    title: str
    start_date: str | None
    due_date: str | None
    is_all_day: bool
    priority: Priority
    list_name: str
    tag_names: list[str]
    completed: bool


class WeekSnapshotEvent(BaseModel):
    title: str
    start: str
    end: str
    is_all_day: bool


class WeekSnapshot(BaseModel):
    """The Assistant's entire view of the world for one turn (ADR 0009).
    `local_date`/`time_zone` are echoed back rather than re-derived, so a
    caller can confirm what window a snapshot was built against."""

    local_date: date
    time_zone: str
    tasks: list[WeekSnapshotTask]
    events: list[WeekSnapshotEvent]
    list_names: list[str]
    tag_names: list[str]
    habits: list[str]


async def _week_tasks(session: AsyncSession, local_date: date) -> list[WeekSnapshotTask]:
    list_names = {row.id: row.name for row in await session.scalars(select(TaskList))}
    rows = await session.scalars(select(Task).order_by(Task.sort_order, Task.id))
    tasks = [task for task in rows if in_smart_view(task, "next7", local_date)]
    return [
        WeekSnapshotTask(
            id=task.id,
            title=task.title,
            start_date=task.start_date.isoformat() if task.start_date is not None else None,
            due_date=task.due_date.isoformat() if task.due_date is not None else None,
            is_all_day=task.is_all_day,
            priority=task.priority,
            list_name=list_names.get(task.list_id, ""),
            tag_names=[tag.name for tag in task.tags],
            completed=task.completed,
        )
        for task in tasks
    ]


async def _today_events(
    session: AsyncSession,
    request_settings: Settings,
    calendar_source: CalendarSource,
    event_cache: EventCache,
    local_date: date,
    time_zone: str,
) -> list[WeekSnapshotEvent]:
    """Today's Events only (not the whole week) — the Assistant plans
    around what's immovable *today*. The fetch window is the caller's own
    local midnight-to-midnight, converted to a UTC instant range — unlike
    Tasks (whose day membership is judged in Python via `in_smart_view`),
    Google itself filters Events by the window it's given, so getting that
    window wrong in `time_zone` would silently leak yesterday's or
    tomorrow's evening Events into "today"."""
    app_settings = await require_app_settings(session)
    if not google_configured(app_settings) or request_settings.app_master_key is None:
        return []
    calendars = list(
        await session.scalars(
            select(GoogleCalendar).where(GoogleCalendar.enabled).order_by(GoogleCalendar.id)
        )
    )
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
    calendars_by_account: dict[int, list[GoogleCalendar]] = defaultdict(list)
    for calendar in calendars:
        if calendar.google_account_id in accounts_by_id:
            calendars_by_account[calendar.google_account_id].append(calendar)

    zone = ZoneInfo(time_zone)
    day_start = datetime(local_date.year, local_date.month, local_date.day, tzinfo=zone)
    day_end = day_start + timedelta(days=1)
    time_min = day_start.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")
    time_max = day_end.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")

    events: list[WeekSnapshotEvent] = []
    for account_id, account_calendars in calendars_by_account.items():
        account = accounts_by_id[account_id]
        try:
            refresh_token = decrypt_credential(
                account.encrypted_refresh_token, key=request_settings.app_master_key
            )
            access_token = (await calendar_source.refresh(refresh_token)).access_token
            for calendar in account_calendars:
                cached = event_cache.get(calendar.google_calendar_id, time_min, time_max)
                if cached is None:
                    entries = await calendar_source.list_events(
                        access_token,
                        calendar.google_calendar_id,
                        time_min=time_min,
                        time_max=time_max,
                    )
                    event_cache.set(calendar.google_calendar_id, time_min, time_max, entries)
                else:
                    entries = cached
                events.extend(
                    WeekSnapshotEvent(
                        title=entry.summary,
                        start=entry.start,
                        end=entry.end,
                        is_all_day=entry.is_all_day,
                    )
                    for entry in entries
                )
        except CalendarSourceError:
            # ADR 0007: one account's failure is isolated — the snapshot
            # degrades to whatever the rest of the accounts (and Tasks)
            # still answer, never fails outright.
            continue
    return events


async def build_week_snapshot(
    session: AsyncSession,
    *,
    settings: Settings,
    calendar_source: CalendarSource,
    event_cache: EventCache,
    local_date: date,
    time_zone: str,
) -> WeekSnapshot:
    """Today + the next seven days, per ADR 0009's snapshot decision. Never
    raises: a Google failure degrades Events to empty, never the whole
    snapshot (ADR 0007)."""
    tasks = await _week_tasks(session, local_date)
    events = await _today_events(
        session, settings, calendar_source, event_cache, local_date, time_zone
    )
    list_names = [
        row.name
        for row in await session.scalars(
            select(TaskList).where(~TaskList.is_archived).order_by(TaskList.sort_order, TaskList.id)
        )
    ]
    tag_names = [row.name for row in await session.scalars(select(Tag).order_by(Tag.name, Tag.id))]
    habits = [
        row.name
        for row in await session.scalars(
            select(Habit).where(~Habit.is_archived).order_by(Habit.name, Habit.id)
        )
    ]
    return WeekSnapshot(
        local_date=local_date,
        time_zone=time_zone,
        tasks=tasks,
        events=events,
        list_names=list_names,
        tag_names=tag_names,
        habits=habits,
    )
