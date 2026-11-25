"""Habits collection endpoints, and Check-in upserts under each Habit.

A Check-in is keyed by (habit, date) and PUT replaces the day's whole value,
so re-taps and backfill corrections are idempotent by construction.
"""

from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.caller_zone import caller_zone
from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.habit_days import Pause, is_paused
from app.habit_frequency import due_on, validate_frequency
from app.habit_stats import current_streak, eligible_from, intensity
from app.models import CheckIn, Habit, HabitPause
from app.schemas import (
    CheckInPut,
    CheckInRead,
    HabitCreate,
    HabitPauseCreate,
    HabitPauseRead,
    HabitPauseResume,
    HabitPauseUpdate,
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


def validate_target_fields(
    type_: HabitType,
    target: float | None,
    step: float | None,
    unit: str | None,
) -> tuple[float, float, str | None]:
    """The target/step/unit a habit stores: Numeric habits need a Target
    (step defaults to 1); Boolean habits may not carry any of them — a
    check-in is the whole target.
    """
    if type_ == "boolean":
        if target is not None or step is not None or unit is not None:
            raise invalid_habit("A Boolean habit has no target, step or unit")
        return 1.0, 1.0, None
    if target is None:
        raise invalid_habit("A Numeric habit requires a target")
    return target, step if step is not None else 1.0, unit


@router.post("", status_code=201)
async def create_habit(payload: HabitCreate, session: SessionDep) -> HabitRead:
    validate_frequency(payload.frequency)
    target, step, unit = validate_target_fields(
        payload.type, payload.target, payload.step, payload.unit
    )
    habit = Habit(
        name=payload.name,
        type=payload.type,
        target=target,
        step=step,
        unit=unit,
        icon=payload.icon,
        color=payload.color,
        encouragement=payload.encouragement,
        frequency=payload.frequency,
        pauses=[],
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


@router.get("/{habit_id}")
async def read_habit(habit_id: int, session: SessionDep) -> HabitRead:
    habit = await get_habit_or_404(habit_id, session)
    return HabitRead.model_validate(habit)


@router.patch("/{habit_id}")
async def update_habit(habit_id: int, payload: HabitUpdate, session: SessionDep) -> HabitRead:
    habit = await get_habit_or_404(habit_id, session)
    changes = payload.model_dump(exclude_unset=True)
    if "frequency" in changes:
        validate_frequency(changes["frequency"])
    # Validate the target fields the habit would end up with after this patch.
    # Stored values carry over only while the habit stays Numeric: becoming
    # Numeric requires a target in the same request (the Boolean defaults are
    # not a real target), and becoming Boolean sweeps the fields back.
    new_type = changes.get("type", habit.type)
    carry = habit.type == "numeric" and new_type == "numeric"
    target, step, unit = validate_target_fields(
        new_type,
        changes.get("target", habit.target if carry else None),
        changes.get("step", habit.step if carry else None),
        changes.get("unit", habit.unit if carry else None),
    )
    changes.update(target=target, step=step, unit=unit)
    for field, value in changes.items():
        setattr(habit, field, value)
    await session.commit()
    return HabitRead.model_validate(habit)


@router.delete("/{habit_id}", status_code=204)
async def delete_habit(habit_id: int, session: SessionDep) -> None:
    """Delete the Habit and its whole Check-in history. Focus Sessions are
    history of their own: they outlive the Habit, only the link goes."""
    habit = await get_habit_or_404(habit_id, session)
    # The database takes its Check-ins and unlinks its Focus Sessions, Timers
    # and Key Results: a habit_checkins Key Result stops counting rather than
    # breaking its Goal (ADR 0012, issue #508).
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
    if is_paused(day, pauses_of(habit)):
        raise APIError(
            status_code=409,
            code="habit_day_paused",
            message=f"{habit.name} is paused on {day.isoformat()}; "
            "remove or edit the pause to check in",
        )
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


async def validate_pause(
    habit: Habit,
    interval: Pause,
    session: SessionDep,
    *,
    replacing: HabitPause | None = None,
) -> None:
    """The rules a pause's interval must meet before it is stored (issue
    #559): it runs forwards, it overlaps none of the Habit's other pauses,
    and it covers no date holding a Check-in — existing Check-ins stay
    authoritative, so the conflict names their dates and deletes nothing.
    `replacing` is the pause being edited, which may overlap itself.
    """
    if interval.end is not None and interval.end < interval.start:
        raise APIError(
            status_code=422, code="invalid_pause", message="A pause cannot end before it starts"
        )
    for other in habit.pauses:
        if other is not replacing and interval.overlaps(pause_of(other)):
            raise APIError(
                status_code=409,
                code="pause_overlaps",
                message="This Habit is already paused over some of those dates",
            )
    query = select(CheckIn.date).where(CheckIn.habit_id == habit.id, CheckIn.date >= interval.start)
    if interval.end is not None:
        query = query.where(CheckIn.date <= interval.end)
    conflicts = sorted((await session.scalars(query)).all())
    if conflicts:
        listed = ", ".join(day.isoformat() for day in conflicts)
        raise APIError(
            status_code=409,
            code="pause_conflicts_with_check_ins",
            message=f"Check-ins on {listed} prevent this pause; remove them first "
            "or choose other dates",
            details={"dates": [day.isoformat() for day in conflicts]},
        )


def pause_of(habit_pause: HabitPause) -> Pause:
    return Pause(start=habit_pause.start_date, end=habit_pause.end_date)


def pauses_of(habit: Habit) -> tuple[Pause, ...]:
    return tuple(pause_of(habit_pause) for habit_pause in habit.pauses)


@router.post("/{habit_id}/pauses", status_code=201)
async def create_pause(
    habit_id: int, payload: HabitPauseCreate, session: SessionDep
) -> HabitPauseRead:
    """Pause the Habit over a date interval (issue #559): its days are
    neither done nor missed."""
    habit = await get_habit_or_404(habit_id, session)
    await validate_pause(habit, Pause(start=payload.start_date, end=payload.end_date), session)
    habit_pause = HabitPause(start_date=payload.start_date, end_date=payload.end_date)
    habit.pauses.append(habit_pause)
    await session.commit()
    return HabitPauseRead.model_validate(habit_pause)


async def get_pause_or_404(habit: Habit, pause_id: int) -> HabitPause:
    for habit_pause in habit.pauses:
        if habit_pause.id == pause_id:
            return habit_pause
    raise NotFoundError(f"Pause {pause_id} not found on habit {habit.id}")


@router.patch("/{habit_id}/pauses/{pause_id}")
async def update_pause(
    habit_id: int, pause_id: int, payload: HabitPauseUpdate, session: SessionDep
) -> HabitPauseRead:
    """Edit pause: move either end, or make it open-ended with a null end.
    The edited interval meets the same rules as a new one."""
    habit = await get_habit_or_404(habit_id, session)
    habit_pause = await get_pause_or_404(habit, pause_id)
    changes = payload.model_dump(exclude_unset=True)
    interval = Pause(
        start=changes.get("start_date", habit_pause.start_date),
        end=changes.get("end_date", habit_pause.end_date),
    )
    await validate_pause(habit, interval, session, replacing=habit_pause)
    habit_pause.start_date = interval.start
    habit_pause.end_date = interval.end
    await session.commit()
    return HabitPauseRead.model_validate(habit_pause)


@router.post("/{habit_id}/pauses/{pause_id}/resume")
async def resume_pause(
    habit_id: int, pause_id: int, payload: HabitPauseResume, session: SessionDep
) -> HabitRead:
    """Resume today: the caller's `today` is eligible again, so the pause
    ends yesterday — or goes altogether when it had not begun before today.
    A pause already over is left alone. Answers with the Habit, since the
    pause may be gone."""
    habit = await get_habit_or_404(habit_id, session)
    habit_pause = await get_pause_or_404(habit, pause_id)
    if habit_pause.start_date >= payload.today:
        habit.pauses.remove(habit_pause)
    elif habit_pause.end_date is None or habit_pause.end_date >= payload.today:
        habit_pause.end_date = payload.today - timedelta(days=1)
    await session.commit()
    return HabitRead.model_validate(habit)


@router.delete("/{habit_id}/pauses/{pause_id}", status_code=204)
async def delete_pause(habit_id: int, pause_id: int, session: SessionDep) -> None:
    """Remove the pause: its days are eligible again, and accept Check-ins."""
    habit = await get_habit_or_404(habit_id, session)
    habit_pause = await get_pause_or_404(habit, pause_id)
    habit.pauses.remove(habit_pause)
    await session.commit()


@router.get("/{habit_id}/stats")
async def read_habit_stats(
    habit_id: int,
    today: date,
    tz: str,
    session: SessionDep,
    year: int | None = Query(default=None, ge=1, le=9999),
) -> HabitStats:
    """The Habit's computed statistics (per the PRD: computed, never stored):
    the current Streak as of `today` (the caller's local day), the heatmap
    of one calendar year's Check-ins — `year` picks which, defaulting to
    today's; sparse: only days with Check-ins appear — and the Habit start
    `eligible_from`, the creation instant read in `tz` (the caller's IANA
    timezone, required).
    """
    # Required, never defaulted: server UTC midnight is not the User's day.
    zone = caller_zone(tz)
    habit = await get_habit_or_404(habit_id, session)
    rows = (await session.scalars(select(CheckIn).where(CheckIn.habit_id == habit_id))).all()
    values = {row.date: row.value for row in rows}
    checked = set(values)
    heatmap_year = year if year is not None else today.year
    return HabitStats(
        streak=current_streak(habit.frequency, habit.target, pauses_of(habit), values, today),
        eligible_from=eligible_from(habit.created_at, zone, checked, today),
        heatmap=[
            HeatmapDay(date=row.date, value=row.value, intensity=intensity(row.value, habit.target))
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
