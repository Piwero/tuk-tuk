"""Yesterday suggestion chips (issue #141): a pure read over completed Tasks
and Completed Occurrences logged on `date - 1` — no suggestion state is
persisted, so nothing needs seeding but the underlying completion data
itself. The completion endpoints stamp `completed_at` with the real clock
(unlike session expiry, Task completion isn't wired to the test `fake_clock`
— see app.models.utcnow), so these seed rows directly through the session
factory rather than backdating through the API.
"""

import asyncio
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import CompletedOccurrence, Task, TaskList

VIEW_DATE = "2026-08-11"
YESTERDAY = datetime(2026, 8, 10, 12, 0, tzinfo=UTC)
TWO_DAYS_AGO = datetime(2026, 8, 9, 12, 0, tzinfo=UTC)
TODAY = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)


def seed_completed_task(client: TestClient, title: str, completed_at: datetime) -> None:
    """Writes a completed one-off Task directly, bypassing the API."""

    async def _seed() -> None:
        session_factory = client.app.state.session_factory  # type: ignore[attr-defined]
        async with session_factory() as session:
            list_id = await session.scalar(select(TaskList.id).where(TaskList.is_inbox))
            session.add(
                Task(title=title, completed=True, completed_at=completed_at, list_id=list_id)
            )
            await session.commit()

    asyncio.run(_seed())


def seed_completed_occurrence(client: TestClient, title: str, completed_at: datetime) -> None:
    """Writes a still-open recurring Task with one Completed Occurrence,
    directly — mirroring how completing a recurring Task's occurrence
    leaves the Task itself open with an advanced date (ADR 0003).
    """

    async def _seed() -> None:
        session_factory = client.app.state.session_factory  # type: ignore[attr-defined]
        async with session_factory() as session:
            list_id = await session.scalar(select(TaskList.id).where(TaskList.is_inbox))
            task = Task(title=title, completed=False, list_id=list_id, recurrence="FREQ=DAILY")
            session.add(task)
            await session.flush()
            session.add(
                CompletedOccurrence(
                    task_id=task.id, completed_at=completed_at, due_date=completed_at
                )
            )
            await session.commit()

    asyncio.run(_seed())


def suggestions(client: TestClient, date: str) -> list[dict]:
    response = client.get(f"/api/v1/stand-up/suggestions/yesterday?date={date}")
    assert response.status_code == 200, response.text
    return response.json()


class TestYesterdaySuggestions:
    def test_a_completed_task_from_yesterday_appears(self, client: TestClient) -> None:
        seed_completed_task(client, "Ship the release notes", YESTERDAY)

        items = suggestions(client, VIEW_DATE)

        assert {"title": "Ship the release notes"} in items

    def test_a_completed_occurrence_from_yesterday_appears(self, client: TestClient) -> None:
        seed_completed_occurrence(client, "Water the plants", YESTERDAY)

        items = suggestions(client, VIEW_DATE)

        assert {"title": "Water the plants"} in items

    def test_items_from_other_days_are_excluded(self, client: TestClient) -> None:
        seed_completed_task(client, "Two days ago task", TWO_DAYS_AGO)
        seed_completed_occurrence(client, "Two days ago occurrence", TWO_DAYS_AGO)

        items = suggestions(client, VIEW_DATE)

        titles = [item["title"] for item in items]
        assert "Two days ago task" not in titles
        assert "Two days ago occurrence" not in titles

    def test_items_from_today_are_excluded(self, client: TestClient) -> None:
        seed_completed_task(client, "Today task", TODAY)
        seed_completed_occurrence(client, "Today occurrence", TODAY)

        items = suggestions(client, VIEW_DATE)

        titles = [item["title"] for item in items]
        assert "Today task" not in titles
        assert "Today occurrence" not in titles

    def test_open_one_off_tasks_are_not_suggested(self, client: TestClient) -> None:
        # A Task with a completed_at from yesterday but not marked completed
        # (e.g. reopened later without clearing completed_at) shouldn't count.
        seed_completed_task(client, "Reopened task", YESTERDAY)

        # Directly flip it back open without clearing completed_at.
        async def _reopen() -> None:
            session_factory = client.app.state.session_factory  # type: ignore[attr-defined]
            async with session_factory() as session:
                task = await session.scalar(select(Task).where(Task.title == "Reopened task"))
                assert task is not None
                task.completed = False
                await session.commit()

        asyncio.run(_reopen())

        items = suggestions(client, VIEW_DATE)

        assert {"title": "Reopened task"} not in items

    def test_the_query_reruns_identically_on_repeated_calls(self, client: TestClient) -> None:
        seed_completed_task(client, "Idempotent task", YESTERDAY)

        first = suggestions(client, VIEW_DATE)
        second = suggestions(client, VIEW_DATE)

        assert first == second


class TestYesterdaySuggestionsFromPriorTodayBullets:
    """issue #147: the prior day's own Stand-up "Today" bullets are also
    suggested — what gets typed as "Today" often isn't tracked as a
    completed Task/Occurrence at all.
    """

    def test_a_prior_day_today_bullet_appears(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/stand-up/entries/2026-08-10/bullets",
            json={"section": "today", "text": "Call Vinodh regarding ticket"},
        )
        assert response.status_code == 201, response.text

        items = suggestions(client, VIEW_DATE)

        assert {"title": "Call Vinodh regarding ticket"} in items

    def test_prior_day_yesterday_and_blockers_bullets_are_excluded(
        self, client: TestClient
    ) -> None:
        client.post(
            "/api/v1/stand-up/entries/2026-08-10/bullets",
            json={"section": "yesterday", "text": "Prior yesterday bullet"},
        )
        client.post(
            "/api/v1/stand-up/entries/2026-08-10/bullets",
            json={"section": "blockers", "text": "Prior blocker bullet"},
        )

        items = suggestions(client, VIEW_DATE)

        titles = [item["title"] for item in items]
        assert "Prior yesterday bullet" not in titles
        assert "Prior blocker bullet" not in titles

    def test_today_bullets_from_other_days_are_excluded(self, client: TestClient) -> None:
        client.post(
            "/api/v1/stand-up/entries/2026-08-09/bullets",
            json={"section": "today", "text": "Two days ago today bullet"},
        )

        items = suggestions(client, VIEW_DATE)

        titles = [item["title"] for item in items]
        assert "Two days ago today bullet" not in titles

    def test_duplicate_titles_from_both_sources_are_deduped(self, client: TestClient) -> None:
        seed_completed_task(client, "Ship the release notes", YESTERDAY)
        client.post(
            "/api/v1/stand-up/entries/2026-08-10/bullets",
            json={"section": "today", "text": "Ship the release notes"},
        )

        items = suggestions(client, VIEW_DATE)

        assert items.count({"title": "Ship the release notes"}) == 1
