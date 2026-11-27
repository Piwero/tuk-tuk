"""Check Item endpoints — composition under a Task, never standalone.

Every mutation returns the full parent Task, so callers see aggregate
effects (ordering, auto-complete) in one response.
"""

from fastapi import APIRouter, HTTPException
from sqlalchemy import select, text

from app.db import SessionDep
from app.errors import NotFoundError
from app.models import CheckItem, CheckItemCreation, Task, utcnow
from app.recurrence import advance_in_place
from app.routers.v1.tasks import get_task_or_404
from app.schemas import CheckItemCreate, CheckItemRead, CheckItemUpdate, TaskRead
from app.sparse_order import append_order

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
    # Resolve ownership before looking up a receipt, preserving 404 isolation.
    task = await get_task_or_404(task_id, session)
    if payload.request_id is not None:
        # Serialize same-key retries, then refresh aggregate after a concurrent commit.
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": f"check-item:{payload.request_id}"},
        )
        await session.refresh(task, attribute_names=["check_items"])
    if payload.request_id is not None:
        receipt = await session.scalar(
            select(CheckItemCreation).where(CheckItemCreation.request_id == payload.request_id)
        )
        if receipt is not None:
            if receipt.task_id != task_id or receipt.title != payload.title:
                raise HTTPException(409, "Request identifier already used for another Check Item")
            return TaskRead.model_validate(task)
        session.add(
            CheckItemCreation(request_id=payload.request_id, task_id=task_id, title=payload.title)
        )
    # check_items is eagerly loaded and ordered, so the last row has the max order.
    last = task.check_items[-1] if task.check_items else None
    sort_order = append_order(last.sort_order if last is not None else None)
    task.check_items.append(CheckItem(title=payload.title, sort_order=sort_order))
    await session.commit()
    return TaskRead.model_validate(task)


@router.get("/{check_item_id}")
async def read_check_item(task_id: int, check_item_id: int, session: SessionDep) -> CheckItemRead:
    task = await get_task_or_404(task_id, session)
    item = get_check_item_or_404(task, check_item_id)
    return CheckItemRead.model_validate(item)


@router.patch("/{check_item_id}")
async def update_check_item(
    task_id: int,
    check_item_id: int,
    payload: CheckItemUpdate,
    session: SessionDep,
    auto_complete: bool = True,
) -> TaskRead:
    """`auto_complete=false` ticks without completing the parent: Now (issue
    #550) advances to the next step and leaves completion to the User."""
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
    if auto_complete and ticked_open_item and all(sibling.done for sibling in task.check_items):
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
