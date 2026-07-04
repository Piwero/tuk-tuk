"""Timers collection endpoints — saved Focus Session presets.

A Timer stores name + mode + duration (and an optional pre-link), so a
recurring scenario starts in one tap. The tap is client-side: these rows
are presets, never running state.
"""

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.models import Timer
from app.routers.focus_sessions import validate_link
from app.schemas import Page, TimerCreate, TimerRead, TimerUpdate

router = APIRouter(prefix="/api/v1/timers", tags=["timers"])


def invalid_timer(message: str) -> APIError:
    return APIError(status_code=422, code="invalid_timer", message=message)


def validate_preset(mode: str, duration_seconds: int | None) -> None:
    """A Pomo Timer carries its countdown length; a Stopwatch one counts up
    from zero, so it carries none."""
    if mode == "pomo" and duration_seconds is None:
        raise invalid_timer("A Pomo Timer requires a duration")
    if mode == "stopwatch" and duration_seconds is not None:
        raise invalid_timer("A Stopwatch Timer has no duration")


def reject_double_link(task_id: int | None, habit_id: int | None) -> None:
    """The both-sides case speaks Timer language here — validate_link's own
    wording (and error code) belongs to Focus Sessions."""
    if task_id is not None and habit_id is not None:
        raise invalid_timer("A Timer links to a Task or a Habit, never both")


@router.post("", status_code=201)
async def create_timer(payload: TimerCreate, session: SessionDep) -> TimerRead:
    validate_preset(payload.mode, payload.duration_seconds)
    reject_double_link(payload.task_id, payload.habit_id)
    await validate_link(session, payload.task_id, payload.habit_id)
    timer = Timer(
        name=payload.name,
        mode=payload.mode,
        duration_seconds=payload.duration_seconds,
        task_id=payload.task_id,
        habit_id=payload.habit_id,
    )
    session.add(timer)
    await session.commit()
    return TimerRead.model_validate(timer)


@router.get("")
async def read_timers(
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[TimerRead]:
    total = await session.scalar(select(func.count()).select_from(Timer)) or 0
    rows = await session.scalars(select(Timer).order_by(Timer.id).limit(limit).offset(offset))
    items = [TimerRead.model_validate(row) for row in rows]
    return Page(items=items, total=total, limit=limit, offset=offset)


async def get_timer_or_404(timer_id: int, session: SessionDep) -> Timer:
    timer = await session.get(Timer, timer_id)
    if timer is None:
        raise NotFoundError(f"Timer {timer_id} not found")
    return timer


@router.patch("/{timer_id}")
async def update_timer(timer_id: int, payload: TimerUpdate, session: SessionDep) -> TimerRead:
    timer = await get_timer_or_404(timer_id, session)
    changes = payload.model_dump(exclude_unset=True)
    # Validate the preset and link the timer would end up with.
    validate_preset(
        changes.get("mode", timer.mode),
        changes.get("duration_seconds", timer.duration_seconds),
    )
    new_task = changes.get("task_id", timer.task_id)
    new_habit = changes.get("habit_id", timer.habit_id)
    if new_task is not None and new_habit is not None:
        # Linking one side replaces the other; both explicit is a conflict.
        if "task_id" in changes and "habit_id" in changes:
            raise invalid_timer("A Timer links to a Task or a Habit, never both")
        changes["task_id" if "habit_id" in changes else "habit_id"] = None
        new_task, new_habit = changes.get("task_id", new_task), changes.get("habit_id", new_habit)
    await validate_link(session, new_task, new_habit)
    for field, value in changes.items():
        setattr(timer, field, value)
    await session.commit()
    return TimerRead.model_validate(timer)


@router.delete("/{timer_id}", status_code=204)
async def delete_timer(timer_id: int, session: SessionDep) -> None:
    timer = await get_timer_or_404(timer_id, session)
    await session.delete(timer)
    await session.commit()
