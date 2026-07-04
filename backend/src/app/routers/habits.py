"""Habits collection endpoints, and Check-in upserts under each Habit.

A Check-in is keyed by (habit, date) and PUT replaces the day's whole value,
so re-taps and backfill corrections are idempotent by construction.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.habit_frequency import due_on, validate_frequency
from app.habit_stats import current_streak, intensity
from app.models import CheckIn, Habit
from app.schemas import (
    CheckInPut,
    CheckInRead,
    HabitCreate,
    HabitRead,
    HabitStats,
    HabitType,
    HabitUpdate,
    HeatmapDay,
    Page,
)

router = APIRouter(prefix="/api/v1/habits", tags=["habits"])


def invalid_habit(message: str) -> APIError:
    return APIError(status_code=422, code="invalid_habit", message=message)


def validate_goal_fields(
    type_: HabitType,
    goal: float | None,
    step: float | None,
    unit: str | None,
) -> tuple[float, float, str | None]:
    """The goal/step/unit a habit stores: Numeric habits need a Goal (step
    defaults to 1); Boolean habits may not carry any of them — a check-in
    is the whole goal.
    """
    if type_ == "boolean":
        if goal is not None or step is not None or unit is not None:
            raise invalid_habit("A Boolean habit has no goal, step or unit")
        return 1.0, 1.0, None
    if goal is None:
        raise invalid_habit("A Numeric habit requires a goal")
    return goal, step if step is not None else 1.0, unit


@router.post("", status_code=201)
async def create_habit(payload: HabitCreate, session: SessionDep) -> HabitRead:
    validate_frequency(payload.frequency)
    goal, step, unit = validate_goal_fields(payload.type, payload.goal, payload.step, payload.unit)
    habit = Habit(
        name=payload.name,
        type=payload.type,
        goal=goal,
        step=step,
        unit=unit,
        icon=payload.icon,
        color=payload.color,
        encouragement=payload.encouragement,
        frequency=payload.frequency,
    )
    session.add(habit)
    await session.commit()
    return HabitRead.model_validate(habit)


@router.get("")
async def read_habits(
    session: SessionDep,
    due: date | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[HabitRead]:
    """List Habits; `due` keeps the active ones scheduled on that day (the
    caller's local day) — the today's-Habits screen's query, which archived
    Habits leave.
    """
    # The due filter parses each habit's frequency, which SQL can't reach —
    # it runs in Python and paginates the filtered rows (like the Smart Lists).
    rows = (await session.scalars(select(Habit).order_by(Habit.id))).all()
    matches = [
        habit
        for habit in rows
        if due is None or (not habit.is_archived and due_on(habit.frequency, due))
    ]
    items = [HabitRead.model_validate(habit) for habit in matches[offset : offset + limit]]
    return Page(items=items, total=len(matches), limit=limit, offset=offset)


async def get_habit_or_404(habit_id: int, session: SessionDep) -> Habit:
    habit = await session.get(Habit, habit_id)
    if habit is None:
        raise NotFoundError(f"Habit {habit_id} not found")
    return habit


@router.patch("/{habit_id}")
async def update_habit(habit_id: int, payload: HabitUpdate, session: SessionDep) -> HabitRead:
    habit = await get_habit_or_404(habit_id, session)
    changes = payload.model_dump(exclude_unset=True)
    if "frequency" in changes:
        validate_frequency(changes["frequency"])
    # Validate the goal fields the habit would end up with after this patch.
    # Stored values carry over only while the habit stays Numeric: becoming
    # Numeric requires a goal in the same request (the Boolean defaults are
    # not a real target), and becoming Boolean sweeps the fields back.
    new_type = changes.get("type", habit.type)
    carry = habit.type == "numeric" and new_type == "numeric"
    goal, step, unit = validate_goal_fields(
        new_type,
        changes.get("goal", habit.goal if carry else None),
        changes.get("step", habit.step if carry else None),
        changes.get("unit", habit.unit if carry else None),
    )
    changes.update(goal=goal, step=step, unit=unit)
    for field, value in changes.items():
        setattr(habit, field, value)
    await session.commit()
    return HabitRead.model_validate(habit)


@router.delete("/{habit_id}", status_code=204)
async def delete_habit(habit_id: int, session: SessionDep) -> None:
    """Delete the Habit and its whole Check-in history."""
    habit = await get_habit_or_404(habit_id, session)
    await session.delete(habit)
    await session.commit()


@router.put("/{habit_id}/check-ins/{day}")
async def put_check_in(
    habit_id: int, day: date, payload: CheckInPut, session: SessionDep
) -> CheckInRead:
    """Upsert the day's Check-in: one row per (habit, date), whatever the tap
    count. A Boolean check-in is always value 1; a Numeric one stores the
    day's accumulated value (the client sends current + step).
    """
    habit = await get_habit_or_404(habit_id, session)
    if habit.type == "boolean" and payload.value != 1:
        raise invalid_habit("A Boolean check-in is always value 1")
    check_in = await session.scalar(
        select(CheckIn).where(CheckIn.habit_id == habit_id, CheckIn.date == day)
    )
    if check_in is None:
        check_in = CheckIn(habit_id=habit_id, date=day, value=payload.value)
        session.add(check_in)
    else:
        check_in.value = payload.value
    await session.commit()
    return CheckInRead.model_validate(check_in)


@router.delete("/{habit_id}/check-ins/{day}", status_code=204)
async def delete_check_in(habit_id: int, day: date, session: SessionDep) -> None:
    """Undo the day's Check-in (a Boolean re-tap, or a backfill correction)."""
    await get_habit_or_404(habit_id, session)
    check_in = await session.scalar(
        select(CheckIn).where(CheckIn.habit_id == habit_id, CheckIn.date == day)
    )
    if check_in is None:
        raise NotFoundError(f"No check-in on {day.isoformat()} for habit {habit_id}")
    await session.delete(check_in)
    await session.commit()


@router.get("/{habit_id}/stats")
async def read_habit_stats(
    habit_id: int,
    today: date,
    session: SessionDep,
    year: int | None = Query(default=None, ge=1, le=9999),
) -> HabitStats:
    """The Habit's computed statistics (per the PRD: computed, never stored):
    the current Streak as of `today` (the caller's local day), and the heatmap
    of one calendar year's Check-ins — `year` picks which, defaulting to
    today's. Sparse: only days with Check-ins appear.
    """
    habit = await get_habit_or_404(habit_id, session)
    rows = (await session.scalars(select(CheckIn).where(CheckIn.habit_id == habit_id))).all()
    heatmap_year = year if year is not None else today.year
    return HabitStats(
        streak=current_streak(habit.frequency, {row.date for row in rows}, today),
        heatmap=[
            HeatmapDay(date=row.date, value=row.value, intensity=intensity(row.value, habit.goal))
            for row in sorted(rows, key=lambda row: row.date)
            if row.date.year == heatmap_year
        ],
    )


check_ins_router = APIRouter(prefix="/api/v1/check-ins", tags=["check-ins"])


@check_ins_router.get("")
async def read_check_ins(
    session: SessionDep,
    date_: Annotated[date | None, Query(alias="date")] = None,
    habit_id: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[CheckInRead]:
    """List Check-ins across Habits; `date` is the today's-screen query,
    `habit_id` a single Habit's history.
    """
    query = select(CheckIn)
    if date_ is not None:
        query = query.where(CheckIn.date == date_)
    if habit_id is not None:
        query = query.where(CheckIn.habit_id == habit_id)
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = await session.scalars(
        query.order_by(CheckIn.date, CheckIn.id).limit(limit).offset(offset)
    )
    items = [CheckInRead.model_validate(row) for row in rows]
    return Page(items=items, total=total, limit=limit, offset=offset)
