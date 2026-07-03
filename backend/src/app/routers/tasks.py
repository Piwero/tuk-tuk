"""Tasks collection endpoints."""

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.db import SessionDep
from app.errors import NotFoundError
from app.models import Task, TaskList
from app.schemas import Page, TaskCreate, TaskRead, TaskUpdate

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])


@router.post("", status_code=201)
async def create_task(payload: TaskCreate, session: SessionDep) -> TaskRead:
    if payload.list_id is None:
        list_id = await session.scalar(select(TaskList.id).where(TaskList.is_inbox))
    else:
        list_id = await session.scalar(select(TaskList.id).where(TaskList.id == payload.list_id))
        if list_id is None:
            raise NotFoundError(f"List {payload.list_id} not found")
    task = Task(title=payload.title, list_id=list_id)
    session.add(task)
    await session.commit()
    return TaskRead.model_validate(task)


@router.get("")
async def read_tasks(
    session: SessionDep,
    list_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[TaskRead]:
    query = select(Task)
    if list_id is not None:
        query = query.where(Task.list_id == list_id)
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = await session.scalars(query.order_by(Task.id).limit(limit).offset(offset))
    items = [TaskRead.model_validate(row) for row in rows]
    return Page(items=items, total=total, limit=limit, offset=offset)


async def get_task_or_404(task_id: int, session: SessionDep) -> Task:
    task = await session.get(Task, task_id)
    if task is None:
        raise NotFoundError(f"Task {task_id} not found")
    return task


@router.patch("/{task_id}")
async def update_task(task_id: int, payload: TaskUpdate, session: SessionDep) -> TaskRead:
    task = await get_task_or_404(task_id, session)
    changes = payload.model_dump(exclude_unset=True)
    if "list_id" in changes:
        target = await session.scalar(select(TaskList.id).where(TaskList.id == changes["list_id"]))
        if target is None:
            raise NotFoundError(f"List {changes['list_id']} not found")
    for field, value in changes.items():
        setattr(task, field, value)
    await session.commit()
    return TaskRead.model_validate(task)


@router.delete("/{task_id}", status_code=204)
async def delete_task(task_id: int, session: SessionDep) -> None:
    task = await get_task_or_404(task_id, session)
    await session.delete(task)
    await session.commit()
