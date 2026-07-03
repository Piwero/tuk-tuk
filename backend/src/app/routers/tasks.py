"""Tasks collection endpoints."""

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.models import SORT_GAP, Section, Tag, Task, TaskList
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
    # Initialize collections so serialization never triggers an async lazy load.
    # Append within the target List (mirrors create_section's per-List scope).
    max_order = await session.scalar(
        select(func.max(Task.sort_order)).where(Task.list_id == list_id)
    )
    task = Task(
        title=payload.title,
        list_id=list_id,
        sort_order=(max_order or 0) + SORT_GAP,
        check_items=[],
        tags=[],
    )
    session.add(task)
    await session.commit()
    return TaskRead.model_validate(task)


@router.get("")
async def read_tasks(
    session: SessionDep,
    list_id: int | None = Query(default=None),
    tag_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[TaskRead]:
    query = select(Task)
    if list_id is not None:
        query = query.where(Task.list_id == list_id)
    if tag_id is not None:
        query = query.where(Task.tags.any(Tag.id == tag_id))
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = await session.scalars(
        query.order_by(Task.sort_order, Task.id).limit(limit).offset(offset)
    )
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
        # A Section belongs to one List: moving Lists drops the Section unless
        # the caller assigns a valid one in the same request.
        if changes["list_id"] != task.list_id and "section_id" not in changes:
            changes["section_id"] = None
    if changes.get("section_id") is not None:
        section = await session.get(Section, changes["section_id"])
        if section is None:
            raise NotFoundError(f"Section {changes['section_id']} not found")
        if section.list_id != changes.get("list_id", task.list_id):
            raise APIError(
                status_code=409,
                code="section_list_mismatch",
                message=f"Section {section.id} belongs to another list",
            )
    if "tag_ids" in changes:
        tag_ids: list[int] = changes.pop("tag_ids")
        tags = list((await session.scalars(select(Tag).where(Tag.id.in_(tag_ids)))).all())
        missing = set(tag_ids) - {tag.id for tag in tags}
        if missing:
            raise NotFoundError(f"Tag {min(missing)} not found")
        task.tags = tags
    for field, value in changes.items():
        setattr(task, field, value)
    await session.commit()
    await session.refresh(task)
    return TaskRead.model_validate(task)


@router.delete("/{task_id}", status_code=204)
async def delete_task(task_id: int, session: SessionDep) -> None:
    task = await get_task_or_404(task_id, session)
    await session.delete(task)
    await session.commit()
