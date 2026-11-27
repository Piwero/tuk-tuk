"""Repository Views (issue #580, spec #576).

A Repository View is a named subset of the User's Watched Repositories,
listed under GitHub in the sidebar, that remembers its display options:
the author, label and assignee filters, hide drafts, hide bots and the
active tab. The filters themselves are applied in the browser; this only
keeps them. The GitHub view reads a Repository View's repositories through
`?view=<id>` on its read endpoints (app.routers.v1.github_view).
"""

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select

from app.db import SessionDep
from app.errors import NotFoundError
from app.models import (
    SORT_GAP,
    RepositoryView,
    RepositoryViewMember,
    RepositoryViewTab,
    WatchedRepository,
)
from app.schemas import reject_explicit_null

router = APIRouter(prefix="/api/v1/github/views", tags=["github"])


class RepositoryViewCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    watched_repository_ids: list[int] = Field(default_factory=list)


# PATCH fields: absent means "leave unchanged"; an explicit JSON null is
# rejected, except for the author, label and assignee filters, where it
# clears the filter.
class RepositoryViewUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    sort_order: int | None = None
    watched_repository_ids: list[int] | None = None
    author: str | None = Field(default=None, max_length=255)
    label: str | None = Field(default=None, max_length=255)
    assignee: str | None = Field(default=None, max_length=255)
    hide_drafts: bool | None = None
    hide_bots: bool | None = None
    active_tab: RepositoryViewTab | None = None

    _reject_nulls = field_validator(
        "name", "sort_order", "watched_repository_ids", "hide_drafts", "hide_bots", "active_tab"
    )(reject_explicit_null)


class RepositoryViewRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    sort_order: int
    watched_repository_ids: list[int]
    author: str | None
    label: str | None
    assignee: str | None
    hide_drafts: bool
    hide_bots: bool
    active_tab: RepositoryViewTab


async def _members(session: SessionDep, ids: list[int]) -> list[RepositoryViewMember]:
    """A member per Watched Repository in `ids`; an id that is not one of
    the User's Watched Repositories is not found."""
    wanted = set(ids)
    found = set(
        (
            await session.scalars(
                select(WatchedRepository.id).where(WatchedRepository.id.in_(wanted))
            )
        ).all()
    )
    missing = sorted(wanted - found)
    if missing:
        raise NotFoundError(f"Watched Repository {missing[0]} not found")
    return [RepositoryViewMember(watched_repository_id=i) for i in sorted(wanted)]


@router.get("")
async def list_views(session: SessionDep) -> list[RepositoryViewRead]:
    """The User's Repository Views in their sidebar order."""
    rows = await session.scalars(
        select(RepositoryView).order_by(RepositoryView.sort_order, RepositoryView.id)
    )
    return [RepositoryViewRead.model_validate(row) for row in rows]


@router.post("", status_code=201)
async def create_view(payload: RepositoryViewCreate, session: SessionDep) -> RepositoryViewRead:
    """A new Repository View, last in the sidebar, with no saved filters."""
    max_order = await session.scalar(select(func.max(RepositoryView.sort_order)))
    row = RepositoryView(
        name=payload.name,
        sort_order=(max_order or 0) + SORT_GAP,
        members=await _members(session, payload.watched_repository_ids),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row, ["members"])
    return RepositoryViewRead.model_validate(row)


async def _get(session: SessionDep, view_id: int) -> RepositoryView:
    row = await session.get(RepositoryView, view_id)
    if row is None:
        raise NotFoundError(f"Repository View {view_id} not found")
    return row


@router.get("/{view_id}")
async def get_view(view_id: int, session: SessionDep) -> RepositoryViewRead:
    return RepositoryViewRead.model_validate(await _get(session, view_id))


@router.patch("/{view_id}")
async def update_view(
    view_id: int, payload: RepositoryViewUpdate, session: SessionDep
) -> RepositoryViewRead:
    """Renames, reorders or saves the display options of a Repository View."""
    row = await _get(session, view_id)
    changes = payload.model_dump(exclude_unset=True)
    if "watched_repository_ids" in changes:
        wanted = await _members(session, changes.pop("watched_repository_ids"))
        kept = {m.watched_repository_id for m in wanted}
        current = {m.watched_repository_id for m in row.members}
        row.members = [m for m in row.members if m.watched_repository_id in kept] + [
            m for m in wanted if m.watched_repository_id not in current
        ]
    for field, value in changes.items():
        setattr(row, field, value)
    await session.commit()
    await session.refresh(row, ["members"])
    return RepositoryViewRead.model_validate(row)


@router.delete("/{view_id}", status_code=204)
async def delete_view(view_id: int, session: SessionDep) -> None:
    """Deletes a Repository View. Its Watched Repositories stay watched."""
    await session.delete(await _get(session, view_id))
    await session.commit()
