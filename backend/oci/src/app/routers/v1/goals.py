"""Goal collection endpoints (ADR 0012). Clean REST per ADR 0001, shaped to
take nested Key Results later (`/api/v1/goals/{id}/key-results/...`, not yet
built).
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Query
from sqlalchemy import func, select, update

from app.db import SessionDep
from app.errors import NotFoundError
from app.models import Goal
from app.quarter import current_quarter
from app.schemas import GoalCreate, GoalRead, GoalUpdate, Page

router = APIRouter(prefix="/api/v1/goals", tags=["goals"])


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
    )
    session.add(goal)
    await session.commit()
    return GoalRead.model_validate(goal)


@router.get("")
async def read_goals(
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[GoalRead]:
    total = await session.scalar(select(func.count()).select_from(Goal)) or 0
    rows = await session.scalars(select(Goal).order_by(Goal.id).limit(limit).offset(offset))
    items = [GoalRead.model_validate(row) for row in rows]
    return Page(items=items, total=total, limit=limit, offset=offset)


async def get_goal_or_404(goal_id: int, session: SessionDep) -> Goal:
    goal = await session.get(Goal, goal_id)
    if goal is None:
        raise NotFoundError(f"Goal {goal_id} not found")
    return goal


@router.get("/{goal_id}")
async def read_goal(goal_id: int, session: SessionDep) -> GoalRead:
    goal = await get_goal_or_404(goal_id, session)
    return GoalRead.model_validate(goal)


@router.patch("/{goal_id}")
async def update_goal(goal_id: int, payload: GoalUpdate, session: SessionDep) -> GoalRead:
    goal = await get_goal_or_404(goal_id, session)
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("is_focused") is True:
        # ADR 0012: only one Goal may be focused at a time.
        await session.execute(
            update(Goal)
            .where(Goal.id != goal_id, Goal.is_focused.is_(True))
            .values(is_focused=False)
        )
    for field, value in changes.items():
        setattr(goal, field, value)
    await session.commit()
    return GoalRead.model_validate(goal)


@router.delete("/{goal_id}", status_code=204)
async def delete_goal(goal_id: int, session: SessionDep) -> None:
    """Delete the Goal. Tasks and Habits carry no link to a Goal in this
    slice, so nothing else is touched."""
    goal = await get_goal_or_404(goal_id, session)
    await session.delete(goal)
    await session.commit()
