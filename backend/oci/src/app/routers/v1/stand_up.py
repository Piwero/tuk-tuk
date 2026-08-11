"""Stand-up Entry and Bullet endpoints.

A Stand-up Entry is keyed by calendar date and lazily persisted: it exists
only once its first Bullet is saved (or via the explicit upsert). Bullet
mutations return the full parent Entry, like Check Items return their
parent Task.
"""

from datetime import date

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.db import SessionDep
from app.errors import NotFoundError
from app.models import DEFAULT_OWNER, SORT_GAP, StandupBullet, StandupEntry
from app.schemas import (
    Page,
    StandupBulletCreate,
    StandupBulletUpdate,
    StandupEntryRead,
    StandupEntrySummary,
)

router = APIRouter(prefix="/api/v1/stand-up", tags=["stand-up"])


async def get_entry_by_date(day: date, session: SessionDep) -> StandupEntry | None:
    result = await session.execute(
        select(StandupEntry).where(StandupEntry.date == day, StandupEntry.owner == DEFAULT_OWNER)
    )
    return result.scalar_one_or_none()


async def get_entry_or_404(day: date, session: SessionDep) -> StandupEntry:
    entry = await get_entry_by_date(day, session)
    if entry is None:
        raise NotFoundError(f"No stand-up entry on {day.isoformat()}")
    return entry


async def get_or_create_entry(day: date, session: SessionDep) -> StandupEntry:
    entry = await get_entry_by_date(day, session)
    if entry is None:
        # bullets defaults to [] here without a query, since the relationship
        # is touched on a still-transient object — but it must be touched,
        # or a post-commit read of a freshly-flushed, never-queried Entry
        # would trigger the async "selectin" loader outside of await.
        entry = StandupEntry(date=day, bullets=[])
        session.add(entry)
    return entry


def get_bullet_or_404(entry: StandupEntry, bullet_id: int) -> StandupBullet:
    for bullet in entry.bullets:
        if bullet.id == bullet_id:
            return bullet
    raise NotFoundError(f"Bullet {bullet_id} not found on stand-up entry {entry.id}")


@router.get("/entries")
async def read_entries(
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[StandupEntrySummary]:
    """The history list — only dates with an actual persisted Entry, newest first."""
    query = select(StandupEntry).where(StandupEntry.owner == DEFAULT_OWNER)
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = await session.scalars(
        query.order_by(StandupEntry.date.desc()).limit(limit).offset(offset)
    )
    items = [StandupEntrySummary.model_validate(row) for row in rows]
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.get("/entries/{day}")
async def read_entry(day: date, session: SessionDep) -> StandupEntryRead:
    entry = await get_entry_or_404(day, session)
    return StandupEntryRead.model_validate(entry)


@router.put("/entries/{day}")
async def upsert_entry(day: date, session: SessionDep) -> StandupEntryRead:
    entry = await get_or_create_entry(day, session)
    await session.commit()
    return StandupEntryRead.model_validate(entry)


@router.delete("/entries/{day}", status_code=204)
async def delete_entry(day: date, session: SessionDep) -> None:
    entry = await get_entry_or_404(day, session)
    await session.delete(entry)
    await session.commit()


@router.post("/entries/{day}/bullets", status_code=201)
async def create_bullet(
    day: date, payload: StandupBulletCreate, session: SessionDep
) -> StandupEntryRead:
    entry = await get_or_create_entry(day, session)
    # bullets is eagerly loaded and ordered, so the section's last row has the max order.
    siblings = [bullet for bullet in entry.bullets if bullet.section == payload.section]
    last = siblings[-1] if siblings else None
    sort_order = (last.sort_order if last is not None else 0) + SORT_GAP
    entry.bullets.append(
        StandupBullet(section=payload.section, text=payload.text, sort_order=sort_order)
    )
    await session.commit()
    return StandupEntryRead.model_validate(entry)


@router.patch("/entries/{day}/bullets/{bullet_id}")
async def update_bullet(
    day: date, bullet_id: int, payload: StandupBulletUpdate, session: SessionDep
) -> StandupEntryRead:
    entry = await get_entry_or_404(day, session)
    bullet = get_bullet_or_404(entry, bullet_id)
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(bullet, field, value)
    await session.commit()
    await session.refresh(entry)
    return StandupEntryRead.model_validate(entry)


@router.delete("/entries/{day}/bullets/{bullet_id}", status_code=204)
async def delete_bullet(day: date, bullet_id: int, session: SessionDep) -> None:
    entry = await get_entry_or_404(day, session)
    bullet = get_bullet_or_404(entry, bullet_id)
    entry.bullets.remove(bullet)
    await session.commit()
