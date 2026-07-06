"""Tags collection endpoints. Renames and deletes propagate to every task
by construction: tasks reference the tag row, never a copy of the name."""

from fastapi import APIRouter, Query
from sqlalchemy import delete, func, select

from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.models import Tag, task_tags
from app.schemas import Page, TagCreate, TagRead, TagUpdate

router = APIRouter(prefix="/api/v1/tags", tags=["tags"])


async def ensure_name_free(session: SessionDep, name: str, tag_id: int | None = None) -> None:
    query = select(Tag.id).where(Tag.name == name)
    if tag_id is not None:
        query = query.where(Tag.id != tag_id)
    if await session.scalar(query) is not None:
        raise APIError(
            status_code=409, code="tag_exists", message=f'A tag named "{name}" already exists'
        )


@router.post("", status_code=201)
async def create_tag(payload: TagCreate, session: SessionDep) -> TagRead:
    await ensure_name_free(session, payload.name)
    tag = Tag(name=payload.name, color=payload.color)
    session.add(tag)
    await session.commit()
    return TagRead.model_validate(tag)


@router.get("")
async def read_tags(
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[TagRead]:
    total = await session.scalar(select(func.count()).select_from(Tag)) or 0
    rows = await session.scalars(select(Tag).order_by(Tag.name, Tag.id).limit(limit).offset(offset))
    items = [TagRead.model_validate(row) for row in rows]
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.patch("/{tag_id}")
async def update_tag(tag_id: int, payload: TagUpdate, session: SessionDep) -> TagRead:
    tag = await session.get(Tag, tag_id)
    if tag is None:
        raise NotFoundError(f"Tag {tag_id} not found")
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        await ensure_name_free(session, changes["name"], tag_id=tag_id)
    for field, value in changes.items():
        setattr(tag, field, value)
    await session.commit()
    return TagRead.model_validate(tag)


@router.delete("/{tag_id}", status_code=204)
async def delete_tag(tag_id: int, session: SessionDep) -> None:
    """Delete the Tag and detach it from every task; the tasks are unaffected."""
    tag = await session.get(Tag, tag_id)
    if tag is None:
        raise NotFoundError(f"Tag {tag_id} not found")
    await session.execute(delete(task_tags).where(task_tags.c.tag_id == tag_id))
    await session.delete(tag)
    await session.commit()
