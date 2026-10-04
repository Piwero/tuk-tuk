"""Sections collection endpoints. A Section is a named, ordered sub-group
inside a List; the same rows serve as Kanban columns."""

from fastapi import APIRouter, Query
from sqlalchemy import func, select, update

from app.db import SessionDep
from app.errors import NotFoundError
from app.models import SORT_GAP, Section, Task, TaskList
from app.schemas import Page, SectionCreate, SectionRead, SectionUpdate

router = APIRouter(prefix="/api/v1/sections", tags=["sections"])


@router.post("", status_code=201)
async def create_section(payload: SectionCreate, session: SessionDep) -> SectionRead:
    task_list = await session.get(TaskList, payload.list_id)
    if task_list is None:
        raise NotFoundError(f"List {payload.list_id} not found")
    max_order = await session.scalar(
        select(func.max(Section.sort_order)).where(Section.list_id == payload.list_id)
    )
    section = Section(
        list_id=payload.list_id, name=payload.name, sort_order=(max_order or 0) + SORT_GAP
    )
    session.add(section)
    await session.commit()
    return SectionRead.model_validate(section)


@router.get("")
async def read_sections(
    session: SessionDep,
    list_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[SectionRead]:
    query = select(Section)
    if list_id is not None:
        query = query.where(Section.list_id == list_id)
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = await session.scalars(
        query.order_by(Section.sort_order, Section.id).limit(limit).offset(offset)
    )
    items = [SectionRead.model_validate(row) for row in rows]
    return Page(items=items, total=total, limit=limit, offset=offset)


async def get_section_or_404(section_id: int, session: SessionDep) -> Section:
    section = await session.get(Section, section_id)
    if section is None:
        raise NotFoundError(f"Section {section_id} not found")
    return section


@router.get("/{section_id}")
async def read_section(section_id: int, session: SessionDep) -> SectionRead:
    section = await get_section_or_404(section_id, session)
    return SectionRead.model_validate(section)


@router.patch("/{section_id}")
async def update_section(
    section_id: int, payload: SectionUpdate, session: SessionDep
) -> SectionRead:
    section = await get_section_or_404(section_id, session)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(section, field, value)
    await session.commit()
    return SectionRead.model_validate(section)


@router.delete("/{section_id}", status_code=204)
async def delete_section(section_id: int, session: SessionDep) -> None:
    """Delete the Section; its tasks stay in the List, ungrouped."""
    section = await get_section_or_404(section_id, session)
    await session.execute(update(Task).where(Task.section_id == section_id).values(section_id=None))
    await session.delete(section)
    await session.commit()
