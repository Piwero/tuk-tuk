"""Lists collection endpoints."""

from fastapi import APIRouter, Query
from sqlalchemy import delete, func, select, update

from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.models import (
    SORT_GAP,
    CompletedOccurrence,
    FocusSession,
    Folder,
    Section,
    Task,
    TaskList,
    Timer,
)
from app.schemas import ListCreate, ListRead, ListUpdate, Page

router = APIRouter(prefix="/api/v1/lists", tags=["lists"])


@router.post("", status_code=201)
async def create_list(payload: ListCreate, session: SessionDep) -> ListRead:
    max_order = await session.scalar(select(func.max(TaskList.sort_order)))
    task_list = TaskList(
        name=payload.name,
        color=payload.color,
        emoji=payload.emoji,
        sort_order=(max_order or 0) + SORT_GAP,
    )
    session.add(task_list)
    await session.commit()
    return ListRead.model_validate(task_list)


@router.get("")
async def read_lists(
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[ListRead]:
    total = await session.scalar(select(func.count()).select_from(TaskList)) or 0
    rows = await session.scalars(
        select(TaskList)
        .order_by(TaskList.is_inbox.desc(), TaskList.sort_order, TaskList.id)
        .limit(limit)
        .offset(offset)
    )
    items = [ListRead.model_validate(row) for row in rows]
    return Page(items=items, total=total, limit=limit, offset=offset)


async def get_list_or_404(list_id: int, session: SessionDep) -> TaskList:
    task_list = await session.get(TaskList, list_id)
    if task_list is None:
        raise NotFoundError(f"List {list_id} not found")
    return task_list


@router.get("/{list_id}")
async def read_list(list_id: int, session: SessionDep) -> ListRead:
    task_list = await get_list_or_404(list_id, session)
    return ListRead.model_validate(task_list)


@router.patch("/{list_id}")
async def update_list(list_id: int, payload: ListUpdate, session: SessionDep) -> ListRead:
    task_list = await get_list_or_404(list_id, session)
    changes = payload.model_dump(exclude_unset=True)
    # view_mode is a display preference, not part of the Inbox's protected
    # identity — it is the one field the Inbox accepts.
    if task_list.is_inbox and set(changes) - {"view_mode"}:
        raise APIError(
            status_code=403, code="inbox_immutable", message="The Inbox cannot be modified"
        )
    if changes.get("folder_id") is not None:
        folder = await session.get(Folder, changes["folder_id"])
        if folder is None:
            raise NotFoundError(f"Folder {changes['folder_id']} not found")
    for field, value in changes.items():
        setattr(task_list, field, value)
    await session.commit()
    return ListRead.model_validate(task_list)


@router.delete("/{list_id}", status_code=204)
async def delete_list(list_id: int, session: SessionDep) -> None:
    task_list = await get_list_or_404(list_id, session)
    if task_list.is_inbox:
        raise APIError(
            status_code=403, code="inbox_undeletable", message="The Inbox cannot be deleted"
        )
    # History travels with its Task, and the tasks go with the List (SQLite
    # leaves ON DELETE CASCADE unenforced, so sweep the occurrences by hand).
    task_ids = select(Task.id).where(Task.list_id == list_id)
    await session.execute(
        delete(CompletedOccurrence).where(CompletedOccurrence.task_id.in_(task_ids))
    )
    # Focus Sessions and Timers are history/presets of their own: they outlive
    # the Task, only the link goes (mirrors the single-Task delete path).
    await session.execute(
        update(FocusSession).where(FocusSession.task_id.in_(task_ids)).values(task_id=None)
    )
    await session.execute(update(Timer).where(Timer.task_id.in_(task_ids)).values(task_id=None))
    # A Section has no meaning outside its List; it goes with it.
    await session.execute(delete(Section).where(Section.list_id == list_id))
    await session.delete(task_list)
    await session.commit()
