"""Builds GoalRead from a Goal ORM row, resolving each Key Result's
current_value: a stored column for "manual", computed on read for
"habit_checkins" (summed Check-ins in the Goal's window) and "task_count"
(count of completed Tasks) — ADR 0012. Never stored, never cached.

Also where a past-window `active` Goal transitions to `closed`, freezing
its Score (the one deliberate exception to "never store a computed
value") — every read is the seam, per ADR 0012.
"""

from datetime import UTC, datetime

from sqlalchemy import func, select

from app.db import SessionDep
from app.goal_score import goal_score, key_result_ratio
from app.models import CheckIn, Goal, KeyResult, Task
from app.schemas import GoalRead, KeyResultRead


async def _current_value(kr: KeyResult, goal: Goal, session: SessionDep) -> float:
    if kr.source == "habit_checkins":
        # A windowless Goal (the Sprint Goal seed, ADR 0012) has no in-window
        # sense, and in practice ships with no Key Results anyway.
        if kr.source_habit_id is None or goal.start_date is None or goal.end_date is None:
            return 0.0
        total = await session.scalar(
            select(func.coalesce(func.sum(CheckIn.value), 0.0)).where(
                CheckIn.habit_id == kr.source_habit_id,
                CheckIn.date >= goal.start_date,
                CheckIn.date <= goal.end_date,
            )
        )
        return float(total or 0.0)
    if kr.source == "task_count":
        count = await session.scalar(
            select(func.count()).where(Task.key_result_id == kr.id, Task.completed.is_(True))
        )
        return float(count or 0)
    return kr.current_value


def settle(goal: Goal, ratios: list[float]) -> None:
    """Leaving `active` freezes the Score and drops focus. Frozen, because a
    Check-in backfilled in March must not rewrite what January's Score was
    (ADR 0012). Unfocused, because the Stand-up must not keep showing an
    outcome the user has closed or abandoned — and the UI offers no Unfocus
    on a settled Goal, so a stuck flag would be unrecoverable."""
    goal.final_score = goal_score(ratios)
    goal.is_focused = False


def _close_if_past_window(goal: Goal, key_results: list[KeyResultRead]) -> bool:
    """A windowless Goal (the Sprint Goal seed) never auto-closes. Returns
    whether the Goal was just transitioned, so the caller knows to persist."""
    if goal.status != "active" or goal.end_date is None:
        return False
    if goal.end_date >= datetime.now(UTC).date():
        return False
    goal.status = "closed"
    settle(goal, [kr.ratio for kr in key_results])
    return True


async def build_goal_read(goal: Goal, session: SessionDep) -> GoalRead:
    key_results = []
    for kr in goal.key_results:
        current = await _current_value(kr, goal, session)
        key_results.append(
            KeyResultRead(
                id=kr.id,
                goal_id=kr.goal_id,
                name=kr.name,
                source=kr.source,
                start_value=kr.start_value,
                target_value=kr.target_value,
                current_value=current,
                source_habit_id=kr.source_habit_id,
                sort_order=kr.sort_order,
                ratio=key_result_ratio(kr.start_value, kr.target_value, current),
            )
        )
    if _close_if_past_window(goal, key_results):
        await session.commit()
    return GoalRead(
        id=goal.id,
        title=goal.title,
        description=goal.description,
        obstacle=goal.obstacle,
        if_then_plan=goal.if_then_plan,
        start_date=goal.start_date,
        end_date=goal.end_date,
        status=goal.status,
        is_focused=goal.is_focused,
        final_score=goal.final_score,
        retro=goal.retro,
        key_results=key_results,
        created_at=goal.created_at,
    )
