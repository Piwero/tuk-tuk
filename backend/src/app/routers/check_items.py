"""Check Item endpoints — composition under a Task, never standalone.

Every mutation returns the full parent Task, so callers see aggregate
effects (ordering, auto-complete) in one response.
"""

from fastapi import APIRouter
from sqlalchemy import func, select

from app.db import SessionDep
from app.errors import NotFoundError
from app.models import SORT_GAP, CheckItem, Task
from app.routers.tasks import get_task_or_404
from app.schemas import CheckItemCreate, CheckItemUpdate, TaskRead

router = APIRouter(prefix="/api/v1/tasks/{task_id}/check-items", tags=["check-items"])


def get_check_item_or_404(task: Task, check_item_id: int) -> CheckItem:
    for item in task.check_items:
        if item.id == check_item_id:
            return item
    raise NotFoundError(f"Check item {check_item_id} not found on task {task.id}")


@router.post("", status_code=201)
async def create_check_item(
    task_id: int, payload: CheckItemCreate, session: SessionDep
) -> TaskRead:
    task = await get_task_or_404(task_id, session)
    max_order = await session.scalar(
        select(func.max(CheckItem.sort_order)).where(CheckItem.task_id == task_id)
    )
    task.check_items.append(CheckItem(title=payload.title, sort_order=(max_order or 0) + SORT_GAP))
    await session.commit()
    return TaskRead.model_validate(task)


@router.patch("/{check_item_id}")
async def update_check_item(
    task_id: int, check_item_id: int, payload: CheckItemUpdate, session: SessionDep
) -> TaskRead:
    task = await get_task_or_404(task_id, session)
    item = get_check_item_or_404(task, check_item_id)
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(item, field, value)
    # Ticking the last open Check Item completes the parent Task. Un-ticking
    # never reopens it — the parent stays as the user set it.
    if changes.get("done") is True and all(sibling.done for sibling in task.check_items):
        task.completed = True
    await session.commit()
    await session.refresh(task)
    return TaskRead.model_validate(task)


@router.delete("/{check_item_id}", status_code=204)
async def delete_check_item(task_id: int, check_item_id: int, session: SessionDep) -> None:
    task = await get_task_or_404(task_id, session)
    item = get_check_item_or_404(task, check_item_id)
    task.check_items.remove(item)
    await session.commit()
