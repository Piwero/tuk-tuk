"""Key Result endpoints — composition under a Goal, never standalone (ADR
0012). Mirrors app.routers.v1.check_items: every mutation returns the full
parent (here, the Goal, built via app.goal_read since automatic Key Result
values require a read-time aggregate), and there is no top-level collection.
"""

from fastapi import APIRouter

from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.goal_read import build_goal_read
from app.models import Goal, KeyResult
from app.routers.v1.goals import detach_tasks, get_goal_or_404
from app.schemas import GoalRead, KeyResultCreate, KeyResultUpdate
from app.sparse_order import append_order

router = APIRouter(prefix="/api/v1/goals/{goal_id}/key-results", tags=["key-results"])


def get_key_result_or_404(goal: Goal, key_result_id: int) -> KeyResult:
    for kr in goal.key_results:
        if kr.id == key_result_id:
            return kr
    raise NotFoundError(f"Key result {key_result_id} not found on goal {goal.id}")


@router.post("", status_code=201)
async def create_key_result(
    goal_id: int, payload: KeyResultCreate, session: SessionDep
) -> GoalRead:
    goal = await get_goal_or_404(goal_id, session)
    source_habit_id = payload.source_habit_id if payload.source == "habit_checkins" else None
    last = goal.key_results[-1] if goal.key_results else None
    sort_order = append_order(last.sort_order if last is not None else None)
    goal.key_results.append(
        KeyResult(
            name=payload.name,
            source=payload.source,
            start_value=payload.start_value,
            target_value=payload.target_value,
            current_value=payload.current_value,
            source_habit_id=source_habit_id,
            sort_order=sort_order,
        )
    )
    await session.commit()
    return await build_goal_read(goal, session)


@router.patch("/{key_result_id}")
async def update_key_result(
    goal_id: int, key_result_id: int, payload: KeyResultUpdate, session: SessionDep
) -> GoalRead:
    goal = await get_goal_or_404(goal_id, session)
    kr = get_key_result_or_404(goal, key_result_id)
    changes = payload.model_dump(exclude_unset=True)
    if "current_value" in changes and kr.source != "manual":
        raise APIError(
            409,
            "automatic_key_result",
            "current_value is computed for automatic Key Results and cannot be written",
        )
    for field, value in changes.items():
        setattr(kr, field, value)
    await session.commit()
    await session.refresh(goal)
    return await build_goal_read(goal, session)


@router.delete("/{key_result_id}", status_code=204)
async def delete_key_result(goal_id: int, key_result_id: int, session: SessionDep) -> None:
    goal = await get_goal_or_404(goal_id, session)
    kr = get_key_result_or_404(goal, key_result_id)
    await detach_tasks([kr.id], session)
    goal.key_results.remove(kr)
    await session.commit()
