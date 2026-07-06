"""Completed Occurrences — the history a recurring Task writes as it repeats.

Read-only in v1: occurrences are created by completing a recurring Task and
deleted with it, never edited directly.
"""

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.db import SessionDep
from app.models import CompletedOccurrence, Task
from app.schemas import CompletedOccurrenceRead, Page

router = APIRouter(prefix="/api/v1/completed-occurrences", tags=["completed-occurrences"])


@router.get("")
async def read_completed_occurrences(
    session: SessionDep,
    list_id: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[CompletedOccurrenceRead]:
    """The completed view's history rows, newest completion first. The title
    and List are the owning task's current ones — history follows the task.
    """
    query = select(CompletedOccurrence, Task.title, Task.list_id).join(
        Task, CompletedOccurrence.task_id == Task.id
    )
    if list_id is not None:
        query = query.where(Task.list_id == list_id)
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = await session.execute(
        query.order_by(CompletedOccurrence.completed_at.desc(), CompletedOccurrence.id.desc())
        .limit(limit)
        .offset(offset)
    )
    items = [
        CompletedOccurrenceRead(
            id=occurrence.id,
            task_id=occurrence.task_id,
            title=title,
            list_id=task_list_id,
            completed_at=occurrence.completed_at,
            due_date=occurrence.due_date,
            is_all_day=occurrence.is_all_day,
        )
        for occurrence, title, task_list_id in rows.all()
    ]
    return Page(items=items, total=total, limit=limit, offset=offset)
