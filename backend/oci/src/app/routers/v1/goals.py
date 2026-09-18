"""Goal collection endpoints (ADR 0012). Clean REST per ADR 0001. Key
Results nest under a Goal — see app.routers.v1.key_results.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Query
from sqlalchemy import func, select, update

from app.db import SessionDep
from app.errors import NotFoundError
from app.goal_read import build_goal_read, settle
from app.models import Goal, Task
from app.quarter import current_quarter
from app.schemas import GoalCreate, GoalRead, GoalUpdate, Page

router = APIRouter(prefix="/api/v1/goals", tags=["goals"])


async def get_goal_or_404(goal_id: int, session: SessionDep) -> Goal:
    goal = await session.get(Goal, goal_id)
    if goal is None:
        raise NotFoundError(f"Goal {goal_id} not found")
    return goal


async def detach_tasks(key_result_ids: list[int], session: SessionDep) -> None:
    """Explicitly clear Task.key_result_id rather than trusting ON DELETE SET
    NULL: SQLite only enforces foreign keys with PRAGMA foreign_keys=ON, which
    this app does not set, so a deleted Key Result would otherwise leave Tasks
    pointing at a dead row — and SQLite recycles rowids, so the next Key Result
    created would inherit them as a phantom count. Same pattern as Habit
    deletion clearing source_habit_id."""
    if not key_result_ids:
        return
    await session.execute(
        update(Task).where(Task.key_result_id.in_(key_result_ids)).values(key_result_id=None)
    )


async def focus_goal_or_404(goal_id: int, session: SessionDep) -> Goal:
    """Applies the single-focus rule (ADR 0012): clearing the previous
    focused Goal happens in the same transaction as setting the new one,
    enforced here at the service layer rather than by a partial unique
    index."""
    await session.execute(
        update(Goal).where(Goal.id != goal_id, Goal.is_focused.is_(True)).values(is_focused=False)
    )
    return await get_goal_or_404(goal_id, session)


@router.post("", status_code=201)
async def create_goal(payload: GoalCreate, session: SessionDep) -> GoalRead:
    quarter_start, quarter_end = current_quarter(datetime.now(UTC).date())
    goal = Goal(
        title=payload.title,
        description=payload.description,
        obstacle=payload.obstacle,
        if_then_plan=payload.if_then_plan,
        start_date=payload.start_date or quarter_start,
        end_date=payload.end_date or quarter_end,
        key_results=[],
    )
    session.add(goal)
    await session.commit()
    return await build_goal_read(goal, session)


@router.get("")
async def read_goals(
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[GoalRead]:
    total = await session.scalar(select(func.count()).select_from(Goal)) or 0
    rows = await session.scalars(select(Goal).order_by(Goal.id).limit(limit).offset(offset))
    items = [await build_goal_read(row, session) for row in rows]
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.get("/{goal_id}")
async def read_goal(goal_id: int, session: SessionDep) -> GoalRead:
    goal = await get_goal_or_404(goal_id, session)
    return await build_goal_read(goal, session)


@router.patch("/{goal_id}")
async def update_goal(goal_id: int, payload: GoalUpdate, session: SessionDep) -> GoalRead:
    goal = await get_goal_or_404(goal_id, session)
    changes = payload.model_dump(exclude_unset=True)
    was_active = goal.status == "active"
    if changes.get("is_focused") is True:
        goal = await focus_goal_or_404(goal_id, session)
    for field, value in changes.items():
        setattr(goal, field, value)
    if was_active and goal.status != "active":
        # Closing or abandoning settles the Goal: Score frozen, focus dropped.
        read = await build_goal_read(goal, session)
        settle(goal, [kr.ratio for kr in read.key_results])
    await session.commit()
    return await build_goal_read(goal, session)


@router.delete("/{goal_id}", status_code=204)
async def delete_goal(goal_id: int, session: SessionDep) -> None:
    """Delete the Goal and its Key Results (cascade). Tasks and Habits are
    left alone: losing a Goal never costs the user work."""
    goal = await get_goal_or_404(goal_id, session)
    await detach_tasks([kr.id for kr in goal.key_results], session)
    await session.delete(goal)
    await session.commit()
