"""Tasks collection endpoints."""

import re
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query
from sqlalchemy import delete, func, or_, select, update

from app.calendar_window import validate_range_pair
from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.models import (
    SORT_GAP,
    CheckItem,
    CompletedOccurrence,
    FocusSession,
    KeyResult,
    Section,
    Tag,
    Task,
    TaskList,
    Timer,
    utcnow,
)
from app.recurrence import advance_in_place, validate_recurrence
from app.schemas import Page, Priority, TaskCreate, TaskRead, TaskUpdate, as_utc

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])

# The built-in Smart Lists — computed queries, never storage.
SmartView = Literal["today", "next7", "all"]


def invalid_schedule(message: str) -> APIError:
    return APIError(status_code=422, code="invalid_schedule", message=message)


# A signed ISO-8601 duration in the day/time subset reminders use (iCalendar
# TRIGGER convention: "PT0S" at time, "-PT30M" 30 minutes before). Weeks,
# months and years are excluded: months/years have no fixed length, and the
# offset editor speaks minutes/hours/days, so weeks add nothing.
DURATION_RE = re.compile(r"^-?P(?=\d|T\d)(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$")


def invalid_reminders(message: str) -> APIError:
    return APIError(status_code=422, code="invalid_reminders", message=message)


def validate_reminders(reminders: list[str], due_date: datetime | None) -> list[str]:
    """Reminders are duration offsets from the task's date: check each offset's
    syntax, require a date while any exist, and collapse duplicates.
    """
    for offset in reminders:
        if DURATION_RE.match(offset) is None:
            raise invalid_reminders(f"Not an ISO-8601 duration offset: {offset!r}")
    if reminders and due_date is None:
        raise invalid_reminders("A task without a date cannot hold Reminders")
    return list(dict.fromkeys(reminders))


def validate_schedule(
    start_date: datetime | None,
    due_date: datetime | None,
    is_all_day: bool,
    time_zone: str | None,
) -> None:
    """The schedule invariants (per the PRD dates model):

    a start needs a due; start precedes due; the timezone is a known IANA key;
    all-day values are date-only (midnight UTC) with a due present; a timed
    start+due duration stays within one calendar day of the task's timezone.
    """
    zone: tzinfo = UTC
    if time_zone is not None:
        try:
            zone = ZoneInfo(time_zone)
        except (KeyError, ValueError):
            raise invalid_schedule(f"Unknown IANA timezone {time_zone!r}") from None
    if start_date is not None and due_date is None:
        raise invalid_schedule("A start date requires a due date")
    if start_date is not None and due_date is not None and as_utc(start_date) > as_utc(due_date):
        raise invalid_schedule("The start date must not be after the due date")
    if is_all_day:
        if due_date is None:
            raise invalid_schedule("An all-day task requires a due date")
        for value in (start_date, due_date):
            if value is not None and as_utc(value).time() != time(0, 0):
                raise invalid_schedule("All-day dates are date-only: use midnight UTC")
    elif start_date is not None and due_date is not None:
        if as_utc(start_date).astimezone(zone).date() != as_utc(due_date).astimezone(zone).date():
            raise invalid_schedule("A timed start+due duration must stay within one day")


async def validate_key_result(session: SessionDep, key_result_id: int | None) -> None:
    """Key Results are only reachable nested under a Goal, so this flat id is
    the one place the Goal scoping is bypassable — check it at the boundary."""
    if key_result_id is not None and await session.get(KeyResult, key_result_id) is None:
        raise NotFoundError(f"Key result {key_result_id} not found")


async def resolve_section(session: SessionDep, section_id: int, list_id: int) -> Section:
    """A Section belongs to one List: 404 when unknown, 409 when foreign."""
    section = await session.get(Section, section_id)
    if section is None:
        raise NotFoundError(f"Section {section_id} not found")
    if section.list_id != list_id:
        raise APIError(
            status_code=409,
            code="section_list_mismatch",
            message=f"Section {section.id} belongs to another list",
        )
    return section


async def resolve_tags(session: SessionDep, tag_ids: list[int]) -> list[Tag]:
    """The Tag rows for an id set; 404 on the first unknown id."""
    tags = list((await session.scalars(select(Tag).where(Tag.id.in_(tag_ids)))).all())
    missing = set(tag_ids) - {tag.id for tag in tags}
    if missing:
        raise NotFoundError(f"Tag {min(missing)} not found")
    return tags


@router.post("", status_code=201)
async def create_task(payload: TaskCreate, session: SessionDep) -> TaskRead:
    if payload.list_id is None:
        list_id = await session.scalar(select(TaskList.id).where(TaskList.is_inbox))
    else:
        list_id = await session.scalar(select(TaskList.id).where(TaskList.id == payload.list_id))
        if list_id is None:
            raise NotFoundError(f"List {payload.list_id} not found")
    if list_id is None:  # unreachable while the Inbox is seeded at startup
        raise NotFoundError("Inbox not found")
    if payload.section_id is not None:
        await resolve_section(session, payload.section_id, list_id)
    await validate_key_result(session, payload.key_result_id)
    validate_schedule(payload.start_date, payload.due_date, payload.is_all_day, payload.time_zone)
    validate_recurrence(payload.recurrence, payload.due_date)
    reminders = validate_reminders(payload.reminders, payload.due_date)
    tags = await resolve_tags(session, payload.tag_ids) if payload.tag_ids else []
    # Initialize collections so serialization never triggers an async lazy load.
    # Append within the target List (mirrors create_section's per-List scope).
    max_order = await session.scalar(
        select(func.max(Task.sort_order)).where(Task.list_id == list_id)
    )
    task = Task(
        title=payload.title,
        description=payload.description,
        list_id=list_id,
        section_id=payload.section_id,
        priority=payload.priority,
        start_date=payload.start_date,
        due_date=payload.due_date,
        is_all_day=payload.is_all_day,
        time_zone=payload.time_zone,
        reminders=reminders,
        recurrence=payload.recurrence,
        source_google_calendar_id=payload.source_google_calendar_id,
        source_google_event_id=payload.source_google_event_id,
        key_result_id=payload.key_result_id,
        sort_order=(max_order or 0) + SORT_GAP,
        check_items=[],
        tags=tags,
    )
    session.add(task)
    await session.commit()
    return TaskRead.model_validate(task)


def like_escaped(text: str) -> str:
    """The text with LIKE wildcards escaped, so a query matches literally."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("")
async def read_tasks(
    session: SessionDep,
    list_id: int | None = None,
    tag_id: int | None = None,
    key_result_id: int | None = None,
    completed: bool | None = None,
    priority: Priority | None = None,
    scheduled: bool | None = None,
    search: str | None = None,
    view: SmartView | None = None,
    today: date | None = None,
    range_start: date | None = None,
    range_end: date | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[TaskRead]:
    """List tasks; `view` computes a Smart List (open tasks only, so it
    overrides `completed`), judged against the caller's local day `today`.
    `range_start`/`range_end` (inclusive calendar days) keep tasks whose
    scheduled days intersect the window — the calendar's query.
    `scheduled=false` keeps only undated tasks — the unscheduled panel's query.
    `search` matches titles, descriptions and Check Item titles (an empty
    query matches nothing); it combines with the List / Tag / Priority /
    completion filters. `priority` also filters on its own, like `list_id`,
    `tag_id` and `key_result_id` — the last being what a Key Result's count
    is made of, so the user can see it rather than trust it. `completed=true` is the completed view: newest
    completion first.
    """
    if view is not None:
        completed = False
    if view in ("today", "next7") and today is None:
        raise APIError(
            status_code=422,
            code="validation_error",
            message=f"view={view} requires the today parameter (the caller's local day)",
        )
    validate_range_pair(range_start, range_end)
    if view is not None and range_start is not None:
        raise APIError(
            status_code=422,
            code="validation_error",
            message="view and range filters are exclusive",
        )
    if scheduled is not None and (view is not None or range_start is not None):
        raise APIError(
            status_code=422,
            code="validation_error",
            message="the scheduled filter is exclusive with view and range filters",
        )
    if search is not None and (
        view is not None or range_start is not None or scheduled is not None
    ):
        raise APIError(
            status_code=422,
            code="validation_error",
            message="search is exclusive with view, range and scheduled filters",
        )
    if search is not None and search.strip() == "":
        # An empty query matches nothing — never a full dump.
        return page_of([], limit, offset)
    query = select(Task)
    if search is not None:
        pattern = f"%{like_escaped(search)}%"
        query = query.where(
            or_(
                Task.title.ilike(pattern, escape="\\"),
                Task.description.ilike(pattern, escape="\\"),
                Task.check_items.any(CheckItem.title.ilike(pattern, escape="\\")),
            )
        )
    if list_id is not None:
        query = query.where(Task.list_id == list_id)
    if tag_id is not None:
        query = query.where(Task.tags.any(Tag.id == tag_id))
    if key_result_id is not None:
        query = query.where(Task.key_result_id == key_result_id)
    if completed is not None:
        query = query.where(Task.completed == completed)
    if priority is not None:
        query = query.where(Task.priority == priority)
    if scheduled is not None:
        query = query.where(Task.due_date.is_not(None) if scheduled else Task.due_date.is_(None))
    order = (
        (Task.completed_at.desc(), Task.id.desc())
        if completed is True
        else (Task.sort_order, Task.id)
    )
    # Day membership needs each task's own timezone, which portable SQL
    # can't reach — these filters run in Python and paginate the filtered rows.
    if view in ("today", "next7") and today is not None:
        rows = await session.scalars(query.order_by(*order))
        matches = [task for task in rows if in_smart_view(task, view, today)]
        return page_of(matches, limit, offset)
    if range_start is not None and range_end is not None:
        rows = await session.scalars(query.order_by(*order))
        matches = [task for task in rows if in_range_window(task, range_start, range_end)]
        return page_of(matches, limit, offset)
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = await session.scalars(query.order_by(*order).limit(limit).offset(offset))
    items = [TaskRead.model_validate(row) for row in rows]
    return Page(items=items, total=total, limit=limit, offset=offset)


def page_of(matches: list[Task], limit: int, offset: int) -> Page[TaskRead]:
    """One page of an already-filtered row list (Python-side filters)."""
    items = [TaskRead.model_validate(task) for task in matches[offset : offset + limit]]
    return Page(items=items, total=len(matches), limit=limit, offset=offset)


def schedule_days(task: Task) -> tuple[date, date] | None:
    """The calendar-day window [first, last] a task occupies, or None when
    unscheduled. All-day values are date-only; timed instants are read in the
    task's own timezone (UTC when it has none).
    """
    if task.due_date is None:
        return None
    if task.is_all_day:
        due_day = as_utc(task.due_date).date()
        first = as_utc(task.start_date).date() if task.start_date is not None else due_day
        return (first, due_day)
    zone: tzinfo = ZoneInfo(task.time_zone) if task.time_zone is not None else UTC
    due_day = as_utc(task.due_date).astimezone(zone).date()
    first = (
        as_utc(task.start_date).astimezone(zone).date() if task.start_date is not None else due_day
    )
    return (first, due_day)


def in_smart_view(task: Task, view: SmartView, today: date) -> bool:
    window = schedule_days(task)
    if window is None:
        return False
    first, last = window
    if view == "today":
        # Dated today (the window covers today) or overdue (window entirely in
        # the past; only open tasks reach here) — both mean it started by today.
        return first <= today
    return first <= today + timedelta(days=6) and last >= today


def in_range_window(task: Task, range_start: date, range_end: date) -> bool:
    """Calendar-window intersection: any scheduled day falls inside the
    inclusive [range_start, range_end] span.
    """
    window = schedule_days(task)
    if window is None:
        return False
    first, last = window
    return first <= range_end and last >= range_start


async def get_task_or_404(task_id: int, session: SessionDep) -> Task:
    task = await session.get(Task, task_id)
    if task is None:
        raise NotFoundError(f"Task {task_id} not found")
    return task


@router.get("/{task_id}")
async def read_task(task_id: int, session: SessionDep) -> TaskRead:
    task = await get_task_or_404(task_id, session)
    return TaskRead.model_validate(task)


@router.patch("/{task_id}")
async def update_task(task_id: int, payload: TaskUpdate, session: SessionDep) -> TaskRead:
    task = await get_task_or_404(task_id, session)
    changes = payload.model_dump(exclude_unset=True)
    # Completion is handled last, against the task the patch produces —
    # completing a recurring task advances it in place instead (ADR 0003).
    completing = changes.pop("completed", None)
    if "list_id" in changes:
        target = await session.scalar(select(TaskList.id).where(TaskList.id == changes["list_id"]))
        if target is None:
            raise NotFoundError(f"List {changes['list_id']} not found")
        # A Section belongs to one List: moving Lists drops the Section unless
        # the caller assigns a valid one in the same request.
        if changes["list_id"] != task.list_id and "section_id" not in changes:
            changes["section_id"] = None
    if changes.get("section_id") is not None:
        await resolve_section(session, changes["section_id"], changes.get("list_id", task.list_id))
    if "key_result_id" in changes:
        await validate_key_result(session, changes["key_result_id"])
    # Validate the schedule the task would end up with after this patch.
    validate_schedule(
        changes.get("start_date", task.start_date),
        changes.get("due_date", task.due_date),
        changes.get("is_all_day", task.is_all_day),
        changes.get("time_zone", task.time_zone),
    )
    effective_due = changes.get("due_date", task.due_date)
    if "reminders" in changes:
        changes["reminders"] = validate_reminders(changes["reminders"], effective_due)
    elif effective_due is None and task.reminders:
        # Clearing the date sweeps the Reminders with it: no dateless Reminders.
        changes["reminders"] = []
    if "recurrence" in changes:
        validate_recurrence(changes["recurrence"], effective_due)
    elif effective_due is None and task.recurrence is not None:
        # Clearing the date sweeps the recurrence with it: no dateless repeats.
        changes["recurrence"] = None
    if "tag_ids" in changes:
        task.tags = await resolve_tags(session, changes.pop("tag_ids"))
    for field, value in changes.items():
        setattr(task, field, value)
    if completing is not None and completing != task.completed:
        occurrence = advance_in_place(task) if completing else None
        if occurrence is not None:
            session.add(occurrence)
        else:
            # Completion transitions stamp/clear completed_at (the completed
            # view's order). A recurring task only gets here when its
            # recurrence has ended: the completed row is the final history entry.
            task.completed = completing
            task.completed_at = utcnow() if completing else None
    await session.commit()
    await session.refresh(task)
    return TaskRead.model_validate(task)


async def detach_task_history(task_ids: list[int], session: SessionDep) -> None:
    """The cleanup a Task's deletion carries with it, shared by the single
    and bulk delete routes: its own history goes (SQLite leaves ON DELETE
    CASCADE unenforced), while Focus Sessions/Timer presets outlive it —
    only their link does."""
    if not task_ids:
        return
    await session.execute(
        delete(CompletedOccurrence).where(CompletedOccurrence.task_id.in_(task_ids))
    )
    await session.execute(
        update(FocusSession).where(FocusSession.task_id.in_(task_ids)).values(task_id=None)
    )
    await session.execute(update(Timer).where(Timer.task_id.in_(task_ids)).values(task_id=None))


@router.delete("/{task_id}", status_code=204)
async def delete_task(task_id: int, session: SessionDep) -> None:
    task = await get_task_or_404(task_id, session)
    await detach_task_history([task.id], session)
    await session.delete(task)
    await session.commit()


@router.delete("", status_code=204)
async def delete_completed_tasks(
    session: SessionDep,
    completed: bool | None = None,
    list_id: int | None = None,
) -> None:
    """Bulk-deletes every completed Task, optionally scoped to one List —
    the Completed view's "Clear completed". `completed=true` is required:
    without it, a bare `DELETE /api/v1/tasks` would read as "delete
    everything", which this endpoint refuses to do.
    """
    if completed is not True:
        raise APIError(
            status_code=422,
            code="validation_error",
            message="Bulk delete requires completed=true — open Tasks can't be bulk-deleted",
        )
    ids = list(
        await session.scalars(
            select(Task.id).where(
                Task.completed.is_(True),
                *([Task.list_id == list_id] if list_id is not None else []),
            )
        )
    )
    await detach_task_history(ids, session)
    if ids:
        await session.execute(delete(Task).where(Task.id.in_(ids)))
    await session.commit()
