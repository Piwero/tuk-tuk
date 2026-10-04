"""Focus Sessions collection endpoints.

Timers tick client-side (per the PRD): the API stores finished or
retroactively added sessions only, so every row is a completed period —
mode, start/end, pause duration, optional note, and at most one link to a
Task or Habit.
"""

from datetime import UTC, date, datetime, tzinfo
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.focus_stats import daily_totals, linked_totals, session_day, weekly_totals
from app.models import FocusSession, Habit, Task
from app.schemas import (
    FocusDayTotal,
    FocusHabitTotal,
    FocusSessionCreate,
    FocusSessionRead,
    FocusSessionUpdate,
    FocusStats,
    FocusTaskTotal,
    FocusWeekTotal,
    Page,
    as_utc,
)

router = APIRouter(prefix="/api/v1/focus-sessions", tags=["focus-sessions"])


def invalid_session(message: str) -> APIError:
    return APIError(status_code=422, code="invalid_session", message=message)


def validate_period(started_at: datetime, ended_at: datetime, pause_seconds: int) -> None:
    """A session is a real period: the end strictly follows the start, and
    the paused part leaves actual focus time inside the wall-clock span."""
    span = int((as_utc(ended_at) - as_utc(started_at)).total_seconds())
    if span <= 0:
        raise invalid_session("The end must follow the start")
    if pause_seconds >= span:
        raise invalid_session("The pause cannot consume the whole session")


async def validate_link(session: SessionDep, task_id: int | None, habit_id: int | None) -> None:
    """At most one link, and it must point at a real row."""
    if task_id is not None and habit_id is not None:
        raise invalid_session("A session links to a Task or a Habit, never both")
    if task_id is not None and await session.get(Task, task_id) is None:
        raise NotFoundError(f"Task {task_id} not found")
    if habit_id is not None and await session.get(Habit, habit_id) is None:
        raise NotFoundError(f"Habit {habit_id} not found")


@router.post("", status_code=201)
async def create_focus_session(
    payload: FocusSessionCreate, session: SessionDep
) -> FocusSessionRead:
    validate_period(payload.started_at, payload.ended_at, payload.pause_seconds)
    await validate_link(session, payload.task_id, payload.habit_id)
    focus_session = FocusSession(
        mode=payload.mode,
        task_id=payload.task_id,
        habit_id=payload.habit_id,
        started_at=payload.started_at,
        ended_at=payload.ended_at,
        pause_seconds=payload.pause_seconds,
        note=payload.note,
    )
    session.add(focus_session)
    await session.commit()
    return FocusSessionRead.model_validate(focus_session)


@router.get("")
async def read_focus_sessions(
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[FocusSessionRead]:
    """List Focus Sessions, most recently started first — the history view."""
    total = await session.scalar(select(func.count()).select_from(FocusSession)) or 0
    rows = await session.scalars(
        select(FocusSession)
        .order_by(FocusSession.started_at.desc(), FocusSession.id.desc())
        .limit(limit)
        .offset(offset)
    )
    items = [FocusSessionRead.model_validate(row) for row in rows]
    return Page(items=items, total=total, limit=limit, offset=offset)


async def get_focus_session_or_404(session_id: int, session: SessionDep) -> FocusSession:
    focus_session = await session.get(FocusSession, session_id)
    if focus_session is None:
        raise NotFoundError(f"Focus session {session_id} not found")
    return focus_session


@router.get("/{session_id}")
async def read_focus_session(session_id: int, session: SessionDep) -> FocusSessionRead:
    focus_session = await get_focus_session_or_404(session_id, session)
    return FocusSessionRead.model_validate(focus_session)


@router.patch("/{session_id}")
async def update_focus_session(
    session_id: int, payload: FocusSessionUpdate, session: SessionDep
) -> FocusSessionRead:
    """Edit a session retroactively: times, note, and the link (null unlinks;
    linking one side clears the other — at most one link ever)."""
    focus_session = await get_focus_session_or_404(session_id, session)
    changes = payload.model_dump(exclude_unset=True)
    # Validate the period and link the session would end up with.
    validate_period(
        changes.get("started_at", focus_session.started_at),
        changes.get("ended_at", focus_session.ended_at),
        changes.get("pause_seconds", focus_session.pause_seconds),
    )
    new_task = changes.get("task_id", focus_session.task_id)
    new_habit = changes.get("habit_id", focus_session.habit_id)
    if new_task is not None and new_habit is not None:
        # Linking one side replaces the other; both explicit is a conflict.
        if "task_id" in changes and "habit_id" in changes:
            raise invalid_session("A session links to a Task or a Habit, never both")
        changes["task_id" if "habit_id" in changes else "habit_id"] = None
        new_task, new_habit = changes.get("task_id", new_task), changes.get("habit_id", new_habit)
    await validate_link(session, new_task, new_habit)
    for field, value in changes.items():
        setattr(focus_session, field, value)
    await session.commit()
    return FocusSessionRead.model_validate(focus_session)


@router.delete("/{session_id}", status_code=204)
async def delete_focus_session(session_id: int, session: SessionDep) -> None:
    focus_session = await get_focus_session_or_404(session_id, session)
    await session.delete(focus_session)
    await session.commit()


stats_router = APIRouter(prefix="/api/v1/focus-stats", tags=["focus-stats"])


@stats_router.get("")
async def read_focus_stats(
    session: SessionDep,
    start: date,
    end: date,
    tz: str | None = None,
) -> FocusStats:
    """Focus statistics over the inclusive [start, end] day range (per the
    PRD: computed, never stored): totals by day and Monday-started week, and
    per-Task / per-Habit attribution of linked time. A session counts toward
    the day it started, read in `tz` (the caller's IANA timezone; UTC when
    absent).
    """
    if start > end:
        raise APIError(
            status_code=422,
            code="validation_error",
            message="start must not be after end",
        )
    zone: tzinfo = UTC
    if tz is not None:
        try:
            zone = ZoneInfo(tz)
        except (KeyError, ValueError):
            raise APIError(
                status_code=422,
                code="validation_error",
                message=f"Unknown IANA timezone {tz!r}",
            ) from None
    rows = (await session.scalars(select(FocusSession).order_by(FocusSession.id))).all()
    # Day membership needs the caller's timezone, which portable SQL can't
    # reach — the range filter runs in Python (like the Smart Lists).
    in_range = [(row, day) for row in rows if start <= (day := session_day(row, zone)) <= end]
    task_totals = linked_totals(in_range, "task_id")
    habit_totals = linked_totals(in_range, "habit_id")
    task_titles = {
        task.id: task.title
        for task in await session.scalars(select(Task).where(Task.id.in_(task_totals)))
    }
    habit_names = {
        habit.id: habit.name
        for habit in await session.scalars(select(Habit).where(Habit.id.in_(habit_totals)))
    }
    return FocusStats(
        days=[
            FocusDayTotal(date=day, seconds=seconds)
            for day, seconds in daily_totals(in_range).items()
        ],
        weeks=[
            FocusWeekTotal(start=monday, seconds=seconds)
            for monday, seconds in weekly_totals(in_range).items()
        ],
        tasks=[
            FocusTaskTotal(task_id=task_id, title=task_titles[task_id], seconds=seconds)
            for task_id, seconds in task_totals.items()
        ],
        habits=[
            FocusHabitTotal(habit_id=habit_id, name=habit_names[habit_id], seconds=seconds)
            for habit_id, seconds in habit_totals.items()
        ],
    )
