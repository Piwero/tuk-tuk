"""Stand-up Entry and Bullet endpoints.

A Stand-up Entry is keyed by calendar date and lazily persisted: it exists
only once its first Bullet is saved (or via the explicit upsert). Bullet
mutations return the full parent Entry, like Check Items return their
parent Task.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.db import SessionDep
from app.errors import NotFoundError
from app.goal_read import build_goal_read
from app.models import (
    DEFAULT_OWNER,
    CompletedOccurrence,
    Goal,
    StandupBullet,
    StandupEntry,
    Task,
)
from app.routers.v1.tasks import in_smart_view
from app.schemas import (
    GoalRead,
    Page,
    StandupBulletCreate,
    StandupBulletUpdate,
    StandupEntryRead,
    StandupEntrySummary,
    StandupSuggestionRead,
    StandupYesterdaySuggestion,
)
from app.sparse_order import append_order

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
        # Sprint Goal is superseded by the focused Goal (ADR 0012, issue
        # #238) — new Entries no longer snapshot it. Existing Entries keep
        # whatever they were created with, unbackfilled.
        # bullets defaults to [] here without a query, since the relationship
        # is touched on a still-transient object — but it must be touched,
        # or a post-commit read of a freshly-flushed, never-queried Entry
        # would trigger the async "selectin" loader outside of await.
        entry = StandupEntry(date=day, bullets=[], sprint_goal_snapshot="")
        session.add(entry)
    return entry


async def get_focused_goal(session: SessionDep) -> Goal | None:
    result = await session.execute(select(Goal).where(Goal.is_focused.is_(True)))
    return result.scalar_one_or_none()


def get_bullet_or_404(entry: StandupEntry, bullet_id: int) -> StandupBullet:
    for bullet in entry.bullets:
        if bullet.id == bullet_id:
            return bullet
    raise NotFoundError(f"Bullet {bullet_id} not found on stand-up entry {entry.id}")


@router.get("/suggestions/today")
async def read_today_suggestions(
    day: Annotated[date, Query(alias="date")],
    session: SessionDep,
) -> list[StandupSuggestionRead]:
    """Opt-in chip suggestions for the Today section, sourced from the Today
    Smart List (open Tasks whose scheduled window has started by `day`). Pure
    read — no dismissal/seen-state tracking.
    """
    rows = await session.scalars(select(Task).where(Task.completed.is_(False)))
    matches = [task for task in rows if in_smart_view(task, "today", day)]
    return [StandupSuggestionRead(task_id=task.id, title=task.title) for task in matches]


@router.get("/suggestions/yesterday")
async def read_yesterday_suggestions(
    day: Annotated[date, Query(alias="date")], session: SessionDep
) -> list[StandupYesterdaySuggestion]:
    """Suggestion chips for the Yesterday section (issue #141): titles of
    one-off Tasks completed, and Completed Occurrences logged, on the prior
    calendar day (`day - 1`), plus the prior day's own Stand-up Today
    bullets (issue #147) — what was actually typed as "Today" often isn't
    tracked as a completed Task at all. A pure read — no suggestion state
    is persisted, so this reruns and repopulates identically every time the
    section is viewed. Deduped by title, preserving first-seen order.
    """
    prior_day = day - timedelta(days=1)
    day_start = datetime(day.year, day.month, day.day, tzinfo=UTC) - timedelta(days=1)
    day_end = day_start + timedelta(days=1)

    completed_tasks = await session.scalars(
        select(Task.title).where(
            Task.completed.is_(True),
            Task.completed_at >= day_start,
            Task.completed_at < day_end,
        )
    )
    completed_occurrences = await session.scalars(
        select(Task.title)
        .join(CompletedOccurrence, CompletedOccurrence.task_id == Task.id)
        .where(
            CompletedOccurrence.completed_at >= day_start,
            CompletedOccurrence.completed_at < day_end,
        )
    )
    prior_entry = await get_entry_by_date(prior_day, session)
    prior_today_bullets = (
        [b.text for b in prior_entry.bullets if b.section == "today"]
        if prior_entry is not None
        else []
    )
    titles = [*completed_tasks.all(), *completed_occurrences.all(), *prior_today_bullets]
    seen: set[str] = set()
    deduped: list[str] = []
    for title in titles:
        if title not in seen:
            seen.add(title)
            deduped.append(title)
    return [StandupYesterdaySuggestion(title=title) for title in deduped]


@router.get("/focused-goal")
async def read_focused_goal(session: SessionDep) -> GoalRead | None:
    """The Goal Stand-up shows (ADR 0012, issue #238): only the focused one,
    with its Key Result progress — never every active Goal, and never null
    to mean "no Key Results" (that's an empty key_results list with a null
    score instead)."""
    goal = await get_focused_goal(session)
    if goal is None:
        return None
    return await build_goal_read(goal, session)


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
    sort_order = append_order(last.sort_order if last is not None else None)
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
