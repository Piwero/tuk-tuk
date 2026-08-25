"""The week snapshot builder (ADR 0009; issue #186) — no model involved.
Seeds a throwaway database over the real HTTP API (the same fixtures every
other test file uses), then calls `build_week_snapshot` directly against
the app's own session factory, calendar source, and event cache.
"""

import asyncio
from collections.abc import Iterator
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.assistant_snapshot import WeekSnapshot, WeekSnapshotTask, build_week_snapshot
from app.calendar_source import CalendarEventEntry, CalendarListEntry, TransientCalendarSourceError
from tests.conftest import FakeCalendarSource, FakeClock
from tests.test_events import seed_one_enabled_calendar
from tests.test_google_accounts import make_client
from tests.test_google_calendars import connect_account


@pytest.fixture
def configured_client(
    database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
) -> Iterator[TestClient]:
    with make_client(
        database_url,
        fake_clock,
        fake_calendar_source,
        google_client_id="a-client-id",
        google_client_secret="a-client-secret",
        cors_origins=["http://localhost:5900"],
    ) as test_client:
        yield test_client


def snapshot(client: TestClient, local_date: date, time_zone: str = "UTC") -> WeekSnapshot:
    app = client.app  # type: ignore[attr-defined]

    async def _build() -> WeekSnapshot:
        session_factory = app.state.session_factory
        async with session_factory() as session:
            return await build_week_snapshot(
                session,
                settings=app.state.settings,
                calendar_source=app.state.calendar_source,
                event_cache=app.state.event_cache,
                local_date=local_date,
                time_zone=time_zone,
            )

    return asyncio.run(_build())


def make_list(client: TestClient, name: str) -> int:
    response = client.post("/api/v1/lists", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def make_tag(client: TestClient, name: str) -> int:
    response = client.post("/api/v1/tags", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def make_habit(client: TestClient, name: str) -> int:
    response = client.post("/api/v1/habits", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


class TestTasks:
    def test_task_in_the_seven_day_window_appears_with_its_full_shape(
        self, client: TestClient
    ) -> None:
        list_id = make_list(client, "Work")
        tag_id = make_tag(client, "urgent")
        response = client.post(
            "/api/v1/tasks",
            json={
                "title": "Ship the report",
                "description": "very private notes",
                "list_id": list_id,
                "tag_ids": [tag_id],
                "priority": "high",
                "due_date": "2026-03-05T00:00:00Z",
                "is_all_day": True,
            },
        )
        assert response.status_code == 201, response.text
        task_id = response.json()["id"]

        result = snapshot(client, date(2026, 3, 1))

        assert len(result.tasks) == 1
        snapshot_task = result.tasks[0]
        assert snapshot_task.id == task_id
        assert snapshot_task.title == "Ship the report"
        assert snapshot_task.priority == "high"
        assert snapshot_task.list_name == "Work"
        assert snapshot_task.tag_names == ["urgent"]
        assert snapshot_task.completed is False
        assert snapshot_task.is_all_day is True
        assert snapshot_task.due_date is not None

    def test_task_outside_the_window_is_excluded(self, client: TestClient) -> None:
        client.post(
            "/api/v1/tasks",
            json={"title": "Next month", "due_date": "2026-04-01T00:00:00Z", "is_all_day": True},
        )

        result = snapshot(client, date(2026, 3, 1))

        assert result.tasks == []

    def test_undated_task_is_excluded(self, client: TestClient) -> None:
        client.post("/api/v1/tasks", json={"title": "Someday"})

        result = snapshot(client, date(2026, 3, 1))

        assert result.tasks == []

    def test_task_description_and_check_item_titles_are_never_present(
        self, client: TestClient
    ) -> None:
        """ADR 0009: excluded by construction — `WeekSnapshotTask` has no
        field either could ever land in, so this asserts the shape itself
        rather than scanning for the string."""
        response = client.post(
            "/api/v1/tasks",
            json={
                "title": "Plan the offsite",
                "description": "the actual private substance of this task",
                "due_date": "2026-03-05T00:00:00Z",
                "is_all_day": True,
            },
        )
        task_id = response.json()["id"]
        client.post(
            f"/api/v1/tasks/{task_id}/check-items", json={"title": "a very private checklist line"}
        )

        result = snapshot(client, date(2026, 3, 1))

        assert "description" not in WeekSnapshotTask.model_fields
        dumped = result.model_dump_json()
        assert "the actual private substance of this task" not in dumped
        assert "a very private checklist line" not in dumped

    def test_completed_task_still_appears_with_its_completion_state(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/api/v1/tasks",
            json={"title": "Done already", "due_date": "2026-03-01T00:00:00Z", "is_all_day": True},
        )
        task_id = response.json()["id"]
        client.patch(f"/api/v1/tasks/{task_id}", json={"completed": True})

        result = snapshot(client, date(2026, 3, 1))

        assert len(result.tasks) == 1
        assert result.tasks[0].completed is True


class TestListsTagsHabits:
    def test_list_tag_and_habit_names_are_included(self, client: TestClient) -> None:
        make_list(client, "Groceries")
        make_tag(client, "errand")
        make_habit(client, "Drink water")

        result = snapshot(client, date(2026, 3, 1))

        assert "Groceries" in result.list_names
        assert "Inbox" in result.list_names  # the built-in list, seeded on first boot
        assert result.tag_names == ["errand"]
        assert result.habits == ["Drink water"]

    def test_archived_list_and_habit_are_excluded(self, client: TestClient) -> None:
        list_id = make_list(client, "Old project")
        client.patch(f"/api/v1/lists/{list_id}", json={"is_archived": True})
        habit_id = make_habit(client, "Stopped habit")
        client.patch(f"/api/v1/habits/{habit_id}", json={"is_archived": True})

        result = snapshot(client, date(2026, 3, 1))

        assert "Old project" not in result.list_names
        assert "Stopped habit" not in result.habits


class TestEvents:
    def test_todays_event_appears(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        seed_one_enabled_calendar(configured_client, fake_calendar_source)
        fake_calendar_source.register_events(
            "rt-1",
            "cal-1",
            [
                CalendarEventEntry(
                    google_event_id="evt-1",
                    summary="Dentist",
                    start="2026-03-01T15:00:00Z",
                    end="2026-03-01T15:30:00Z",
                    is_all_day=False,
                )
            ],
        )

        result = snapshot(configured_client, date(2026, 3, 1))

        assert len(result.events) == 1
        assert result.events[0].title == "Dentist"
        assert result.events[0].start == "2026-03-01T15:00:00Z"

    def test_unconfigured_google_degrades_to_no_events_never_errors(
        self, client: TestClient
    ) -> None:
        result = snapshot(client, date(2026, 3, 1))

        assert result.events == []

    def test_google_failure_degrades_to_tasks_only_snapshot(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        client = configured_client
        client.post(
            "/api/v1/tasks",
            json={"title": "Still here", "due_date": "2026-03-01T00:00:00Z", "is_all_day": True},
        )
        seed_one_enabled_calendar(client, fake_calendar_source)
        fake_calendar_source.register_refresh_error(
            "rt-1", TransientCalendarSourceError("Google is down")
        )

        result = snapshot(client, date(2026, 3, 1))

        assert result.events == []
        assert len(result.tasks) == 1

    def test_one_failed_account_does_not_blank_another_accounts_events(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        client = configured_client
        seed_one_enabled_calendar(client, fake_calendar_source, refresh_token="rt-broken")
        fake_calendar_source.register_refresh_error(
            "rt-broken", TransientCalendarSourceError("nope")
        )

        connect_account(
            client,
            fake_calendar_source,
            refresh_token="rt-2",
            google_account_id="google-2",
            email="second@example.com",
        )
        fake_calendar_source.register_calendars(
            "rt-2",
            [CalendarListEntry(google_calendar_id="cal-2", summary="Personal", selected=True)],
        )
        account_id_2 = next(
            account["id"]
            for account in client.get("/api/v1/google/accounts").json()
            if account["email"] == "second@example.com"
        )
        client.get(f"/api/v1/google/accounts/{account_id_2}/calendars")
        fake_calendar_source.register_events(
            "rt-2",
            "cal-2",
            [
                CalendarEventEntry(
                    google_event_id="evt-2",
                    summary="Standup",
                    start="2026-03-01T13:00:00Z",
                    end="2026-03-01T13:15:00Z",
                    is_all_day=False,
                )
            ],
        )

        result = snapshot(client, date(2026, 3, 1))

        assert [event.title for event in result.events] == ["Standup"]

    def test_events_window_is_the_callers_local_day_not_the_utc_day(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        """A caller in America/New_York (EST, UTC-5 in March) asking for
        "today" on 2026-03-01 means the UTC instant range
        2026-03-01T05:00:00Z .. 2026-03-02T05:00:00Z — local
        midnight-to-midnight, not the UTC calendar day. Asserted on the
        exact window sent to Google, since the fake doesn't filter by it
        (Google does) — this is what would have let yesterday's or
        tomorrow's evening Events leak into "today" for a non-UTC caller."""
        seed_one_enabled_calendar(configured_client, fake_calendar_source)

        snapshot(configured_client, date(2026, 3, 1), time_zone="America/New_York")

        assert fake_calendar_source.list_events_calls == [
            ("cal-1", "2026-03-01T05:00:00Z", "2026-03-02T05:00:00Z")
        ]

    def test_events_window_spans_the_dst_boundary_correctly(
        self, configured_client: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        """US DST began 2026-03-08 at 2am local (EST -> EDT). Asking for
        "today" on that date must still resolve to the caller's real local
        midnight-to-midnight — 05:00Z (EST, UTC-5) through the *next* day's
        04:00Z (EDT, UTC-4), a 23-hour UTC span, not a naive 24-hour one."""
        seed_one_enabled_calendar(configured_client, fake_calendar_source)

        snapshot(configured_client, date(2026, 3, 8), time_zone="America/New_York")

        assert fake_calendar_source.list_events_calls == [
            ("cal-1", "2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z")
        ]


class TestTimezones:
    def test_window_is_judged_in_the_callers_own_timezone(self, client: TestClient) -> None:
        """A task due at 01:00 UTC on Mar 2 is still "Mar 1, 8pm" in
        America/New_York — the day it's due in the caller's own zone, per
        ADR 0009's "today is never guessed" contract."""
        client.post(
            "/api/v1/tasks",
            json={
                "title": "Late night in UTC, evening in NY",
                "due_date": "2026-03-02T01:00:00Z",
                "time_zone": "America/New_York",
            },
        )

        result = snapshot(client, date(2026, 3, 1), time_zone="America/New_York")

        assert len(result.tasks) == 1

    def test_window_spans_a_dst_boundary(self, client: TestClient) -> None:
        """US DST began 2026-03-08. A task due the following Sunday still
        falls inside the seven-day window spanning the spring-forward."""
        client.post(
            "/api/v1/tasks",
            json={
                "title": "Across the DST boundary",
                "due_date": "2026-03-08T12:00:00Z",
                "time_zone": "America/New_York",
            },
        )

        result = snapshot(client, date(2026, 3, 2), time_zone="America/New_York")

        assert len(result.tasks) == 1
