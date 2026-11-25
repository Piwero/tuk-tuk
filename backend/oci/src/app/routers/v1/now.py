"""Now (issue #547): the one Task the acting User chose to do next in Today.

Two small endpoints over the User's own `now_selections` row: the
selection itself (`/api/v1/now`) and the Settings toggle
(`/api/v1/settings/now`). Neither touches `user_settings` or the Task.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from app.db import SessionDep
from app.errors import NotFoundError
from app.models import NowSelection, Task

router = APIRouter(tags=["now"])


class NowRead(BaseModel):
    task_id: int | None


class NowToggle(BaseModel):
    enabled: bool


async def _row(session: SessionDep) -> NowSelection | None:
    # Row-level isolation scopes this to the acting User (app.ownership).
    row: NowSelection | None = await session.scalar(select(NowSelection))
    return row


async def _row_for_write(session: SessionDep) -> NowSelection:
    row = await _row(session)
    if row is None:
        row = NowSelection()
        session.add(row)
    return row


@router.get("/api/v1/now")
async def read_now(session: SessionDep) -> NowRead:
    row = await _row(session)
    return NowRead(task_id=row.task_id if row else None)


@router.put("/api/v1/now")
async def update_now(payload: NowRead, session: SessionDep) -> NowRead:
    """Selects, replaces or clears the Now Task. Another User's Task is
    invisible here, so it reads exactly like an unknown id."""
    if payload.task_id is not None and await session.get(Task, payload.task_id) is None:
        raise NotFoundError("Task not found")
    row = await _row_for_write(session)
    row.task_id = payload.task_id
    await session.commit()
    return NowRead(task_id=row.task_id)


@router.get("/api/v1/settings/now")
async def read_now_toggle(session: SessionDep) -> NowToggle:
    row = await _row(session)
    return NowToggle(enabled=row.enabled if row else False)


@router.put("/api/v1/settings/now")
async def update_now_toggle(payload: NowToggle, session: SessionDep) -> NowToggle:
    """UI visibility only: turning Now off keeps the stored selection."""
    row = await _row_for_write(session)
    row.enabled = payload.enabled
    await session.commit()
    return NowToggle(enabled=row.enabled)
