"""Now (issue #547): the one Task the acting User chose to do next in Today.

Endpoints over the User's own Now rows: the selection (`/api/v1/now`),
its resume note (`/api/v1/now/note`, #554), the shortlist
(`/api/v1/now/shortlist`, #551) and the Settings toggle
(`/api/v1/settings/now`). None touches `user_settings` or the Task.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.models import NowSelection, NowShortlistItem, Task
from app.now_rule import is_current, occurrence_of

router = APIRouter(tags=["now"])


class NowRead(BaseModel):
    task_id: int | None


class ResumeNote(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class NowToggle(BaseModel):
    enabled: bool


async def _open_task(session: SessionDep, task_id: int) -> Task:
    """A Task that may be picked: the User's own and not completed. A
    completed one reads exactly like an unknown id, as another User's does."""
    task = await session.get(Task, task_id)
    if task is None or task.completed:
        raise NotFoundError("Task not found")
    return task


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
    """A deleted, completed or advanced selection is pruned here (#549)."""
    row = await _current_row(session)
    return NowRead(task_id=row.task_id if row else None)


async def _current_row(session: SessionDep) -> NowSelection | None:
    """The User's row, with a stale selection (and its note) pruned."""
    row = await _row(session)
    if row is None:
        return None
    task = None if row.task_id is None else await session.get(Task, row.task_id)
    stale = task is None or not is_current(task, (row.task_start_date, row.task_due_date))
    if stale and (row.task_id is not None or row.resume_note is not None):
        row.task_id = None
        row.task_start_date = row.task_due_date = None
        row.resume_note = None
        await session.commit()
    return row


@router.put("/api/v1/now")
async def update_now(payload: NowRead, session: SessionDep) -> NowRead:
    """Selects, replaces or clears the Now Task. Another User's Task is
    invisible here, so it reads exactly like an unknown id."""
    task = None if payload.task_id is None else await _open_task(session, payload.task_id)
    row = await _row_for_write(session)
    occurrence = occurrence_of(task) if task else (None, None)
    if (row.task_id, (row.task_start_date, row.task_due_date)) != (payload.task_id, occurrence):
        row.resume_note = None  # a different selection or occurrence (#554)
    row.task_id = payload.task_id
    row.task_start_date, row.task_due_date = occurrence
    await session.commit()
    return NowRead(task_id=row.task_id)


@router.get("/api/v1/now/note")
async def read_resume_note(session: SessionDep) -> ResumeNote:
    row = await _current_row(session)
    return ResumeNote(note=row.resume_note if row else None)


@router.put("/api/v1/now/note")
async def update_resume_note(payload: ResumeNote, session: SessionDep) -> ResumeNote:
    """Saves, edits or (with null/blank) discards the resume note (#554).
    It belongs to the current selection, so there must be one."""
    row = await _current_row(session)
    note = (payload.note or "").strip() or None
    if row is None or row.task_id is None:
        if note is None:
            return ResumeNote(note=None)
        raise APIError(409, "no_now_selection", "Nothing is selected for Now")
    row.resume_note = note
    await session.commit()
    return ResumeNote(note=row.resume_note)


class ShortlistRead(BaseModel):
    task_ids: list[int]


async def _shortlist_rows(session: SessionDep) -> list[NowShortlistItem]:
    rows = await session.scalars(select(NowShortlistItem).order_by(NowShortlistItem.position))
    return list(rows)


@router.get("/api/v1/now/shortlist")
async def read_shortlist(session: SessionDep) -> ShortlistRead:
    """Ordered alternatives beside Now (issue #551). Entries that are
    deleted, completed, advanced, or now the Now Task are pruned here, by
    the same rule as the Now selection."""
    now = await _row(session)
    now_id = now.task_id if now else None
    kept: list[int] = []
    pruned = False
    for item in await _shortlist_rows(session):
        task = await session.get(Task, item.task_id)
        if item.task_id == now_id or not is_current(
            task, (item.task_start_date, item.task_due_date)
        ):
            await session.delete(item)
            pruned = True
        else:
            kept.append(item.task_id)
    if pruned:
        await session.commit()
    return ShortlistRead(task_ids=kept)


@router.put("/api/v1/now/shortlist")
async def update_shortlist(payload: ShortlistRead, session: SessionDep) -> ShortlistRead:
    """Replaces the whole ordered shortlist. Duplicates keep their first
    place and the Now Task is left out, so a Task is listed at most once.
    An unknown, completed or another User's Task is a 404, as for Now.

    An entry already listed keeps the occurrence it was listed for, so one
    advanced meanwhile by another client is still pruned; only new entries
    are snapshotted from the Task's current schedule."""
    now = await _row(session)
    wanted = [i for i in dict.fromkeys(payload.task_ids) if not (now and i == now.task_id)]
    listed = {item.task_id: item for item in await _shortlist_rows(session)}
    occurrences = {
        i: (listed[i].task_start_date, listed[i].task_due_date)
        if i in listed
        else occurrence_of(await _open_task(session, i))
        for i in wanted
    }
    for item in listed.values():
        await session.delete(item)
    await session.flush()
    for position, task_id in enumerate(wanted):
        start, due = occurrences[task_id]
        session.add(
            NowShortlistItem(
                task_id=task_id, position=position, task_start_date=start, task_due_date=due
            )
        )
    await session.commit()
    return ShortlistRead(task_ids=wanted)


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
