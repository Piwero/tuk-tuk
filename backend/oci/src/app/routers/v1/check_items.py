"""Check Item endpoints — composition under a Task, never standalone.

Every mutation returns the full parent Task, so callers see aggregate
effects (ordering, auto-complete) in one response.
"""

from fastapi import APIRouter

from app.db import SessionDep
from app.errors import NotFoundError
from app.models import SORT_GAP, CheckItem, Task, utcnow
from app.recurrence import advance_in_place
from app.routers.v1.tasks import get_task_or_404
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
    # check_items is eagerly loaded and ordered, so the last row has the max order.
    last = task.check_items[-1] if task.check_items else None
    sort_order = (last.sort_order if last is not None else 0) + SORT_GAP
    task.check_items.append(CheckItem(title=payload.title, sort_order=sort_order))
    await session.commit()
    return TaskRead.model_validate(task)


@router.patch("/{check_item_id}")
async def update_check_item(
    task_id: int, check_item_id: int, payload: CheckItemUpdate, session: SessionDep
) -> TaskRead:
    task = await get_task_or_404(task_id, session)
    item = get_check_item_or_404(task, check_item_id)
    changes = payload.model_dump(exclude_unset=True)
    ticked_open_item = changes.get("done") is True and not item.done
    for field, value in changes.items():
        setattr(item, field, value)
    # Ticking the last open Check Item completes the parent Task — which, for
    # a recurring Task, means advancing it in place (ADR 0003). Un-ticking
    # never reopens it, and re-ticking an already-done item changes nothing —
    # the parent stays as the user set it.
    if ticked_open_item and all(sibling.done for sibling in task.check_items):
        occurrence = advance_in_place(task)
        if occurrence is not None:
            session.add(occurrence)
        else:
            task.completed = True
            task.completed_at = utcnow()
    await session.commit()
    await session.refresh(task)
    return TaskRead.model_validate(task)


@router.delete("/{check_item_id}", status_code=204)
async def delete_check_item(task_id: int, check_item_id: int, session: SessionDep) -> None:
    task = await get_task_or_404(task_id, session)
    item = get_check_item_or_404(task, check_item_id)
    task.check_items.remove(item)
    await session.commit()
