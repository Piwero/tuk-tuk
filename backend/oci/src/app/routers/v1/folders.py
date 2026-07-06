"""Folders collection endpoints."""

from fastapi import APIRouter, Query
from sqlalchemy import func, select, update

from app.db import SessionDep
from app.errors import NotFoundError
from app.models import SORT_GAP, Folder, TaskList
from app.schemas import FolderCreate, FolderRead, FolderUpdate, Page

router = APIRouter(prefix="/api/v1/folders", tags=["folders"])


@router.post("", status_code=201)
async def create_folder(payload: FolderCreate, session: SessionDep) -> FolderRead:
    max_order = await session.scalar(select(func.max(Folder.sort_order)))
    folder = Folder(name=payload.name, sort_order=(max_order or 0) + SORT_GAP)
    session.add(folder)
    await session.commit()
    return FolderRead.model_validate(folder)


@router.get("")
async def read_folders(
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[FolderRead]:
    total = await session.scalar(select(func.count()).select_from(Folder)) or 0
    rows = await session.scalars(
        select(Folder).order_by(Folder.sort_order, Folder.id).limit(limit).offset(offset)
    )
    items = [FolderRead.model_validate(row) for row in rows]
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.patch("/{folder_id}")
async def update_folder(folder_id: int, payload: FolderUpdate, session: SessionDep) -> FolderRead:
    folder = await session.get(Folder, folder_id)
    if folder is None:
        raise NotFoundError(f"Folder {folder_id} not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(folder, field, value)
    await session.commit()
    return FolderRead.model_validate(folder)


@router.delete("/{folder_id}", status_code=204)
async def delete_folder(folder_id: int, session: SessionDep) -> None:
    """Delete the Folder; its Lists survive, moved back to the top level."""
    folder = await session.get(Folder, folder_id)
    if folder is None:
        raise NotFoundError(f"Folder {folder_id} not found")
    await session.execute(
        update(TaskList).where(TaskList.folder_id == folder_id).values(folder_id=None)
    )
    await session.delete(folder)
    await session.commit()
