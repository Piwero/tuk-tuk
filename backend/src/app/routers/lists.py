"""Lists collection endpoints."""

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.models import TaskList
from app.schemas import ListRead, Page

router = APIRouter(prefix="/api/v1/lists", tags=["lists"])


@router.get("")
async def read_lists(
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[ListRead]:
    total = await session.scalar(select(func.count()).select_from(TaskList)) or 0
    rows = await session.scalars(
        select(TaskList).order_by(TaskList.is_inbox.desc(), TaskList.id).limit(limit).offset(offset)
    )
    items = [ListRead.model_validate(row) for row in rows]
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.delete("/{list_id}", status_code=204)
async def delete_list(list_id: int, session: SessionDep) -> None:
    task_list = await session.get(TaskList, list_id)
    if task_list is None:
        raise NotFoundError(f"List {list_id} not found")
    if task_list.is_inbox:
        raise APIError(
            status_code=403, code="inbox_undeletable", message="The Inbox cannot be deleted"
        )
    await session.delete(task_list)
    await session.commit()
