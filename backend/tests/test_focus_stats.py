"""Focus statistics: totals by day and week, and per-Task / per-Habit
breakdowns, computed server-side from persisted Focus Sessions (issue #35).

A session counts toward the calendar day it started on, read in the
caller's timezone (`tz`, IANA; UTC by default). Weeks start on Monday
(WKST=MO, like recurrence). Totals are honest focus: span minus pause.
"""

from fastapi.testclient import TestClient

from tests.conftest import make_task
from tests.test_focus_sessions import make_session
from tests.test_habits import make_habit


def stats(client: TestClient, start: str, end: str, tz: str | None = None) -> dict:
    params = {"start": start, "end": end}
    if tz is not None:
        params["tz"] = tz
    response = client.get("/api/v1/focus-stats", params=params)
    assert response.status_code == 200, response.text
    return response.json()


class TestDailyAndWeeklyTotals:
    def test_totals_by_day_are_honest_focus_time(self, client: TestClient) -> None:
        # Two sessions on the 2nd (one with pause), one on the 3rd.
        make_session(client, started_at="2026-07-02T09:00:00Z", ended_at="2026-07-02T09:30:00Z")
        make_session(
            client,
            started_at="2026-07-02T15:00:00Z",
            ended_at="2026-07-02T15:30:00Z",
            pause_seconds=600,
        )
        make_session(client, started_at="2026-07-03T09:00:00Z", ended_at="2026-07-03T09:25:00Z")

        body = stats(client, "2026-07-01", "2026-07-07")

        assert body["days"] == [
            {"date": "2026-07-02", "seconds": 3000},
            {"date": "2026-07-03", "seconds": 1500},
        ]

    def test_totals_by_week_start_on_monday(self, client: TestClient) -> None:
        # Sun 2026-06-28 and Mon 2026-06-29 fall in different ISO weeks.
        make_session(client, started_at="2026-06-28T09:00:00Z", ended_at="2026-06-28T09:30:00Z")
        make_session(client, started_at="2026-06-29T09:00:00Z", ended_at="2026-06-29T09:30:00Z")
        make_session(client, started_at="2026-07-03T09:00:00Z", ended_at="2026-07-03T09:30:00Z")

        body = stats(client, "2026-06-22", "2026-07-05")

        assert body["weeks"] == [
            {"start": "2026-06-22", "seconds": 1800},
            {"start": "2026-06-29", "seconds": 3600},
        ]

    def test_the_range_is_inclusive_and_excludes_the_rest(self, client: TestClient) -> None:
        make_session(client, started_at="2026-07-01T09:00:00Z", ended_at="2026-07-01T09:30:00Z")
        make_session(client, started_at="2026-07-08T09:00:00Z", ended_at="2026-07-08T09:30:00Z")

        body = stats(client, "2026-07-01", "2026-07-07")

        assert [day["date"] for day in body["days"]] == ["2026-07-01"]

    def test_days_are_read_in_the_callers_timezone(self, client: TestClient) -> None:
        # 23:30 UTC on the 3rd is already the 4th in Madrid (UTC+2 in July).
        make_session(client, started_at="2026-07-03T23:30:00Z", ended_at="2026-07-03T23:55:00Z")

        utc = stats(client, "2026-07-01", "2026-07-07")
        madrid = stats(client, "2026-07-01", "2026-07-07", tz="Europe/Madrid")

        assert [day["date"] for day in utc["days"]] == ["2026-07-03"]
        assert [day["date"] for day in madrid["days"]] == ["2026-07-04"]


class TestBreakdowns:
    def test_attributes_time_to_linked_tasks_and_habits(self, client: TestClient) -> None:
        task = make_task(client, "Write report")
        habit = make_habit(client, "Reading")
        make_session(
            client,
            started_at="2026-07-02T09:00:00Z",
            ended_at="2026-07-02T09:30:00Z",
            task_id=task["id"],
        )
        make_session(
            client,
            started_at="2026-07-03T09:00:00Z",
            ended_at="2026-07-03T09:25:00Z",
            task_id=task["id"],
        )
        make_session(
            client,
            started_at="2026-07-03T20:00:00Z",
            ended_at="2026-07-03T20:30:00Z",
            habit_id=habit["id"],
        )
        make_session(  # unlinked time appears in totals only
            client, started_at="2026-07-04T09:00:00Z", ended_at="2026-07-04T09:10:00Z"
        )

        body = stats(client, "2026-07-01", "2026-07-07")

        assert body["tasks"] == [{"task_id": task["id"], "title": "Write report", "seconds": 3300}]
        assert body["habits"] == [{"habit_id": habit["id"], "name": "Reading", "seconds": 1800}]

    def test_breakdowns_respect_the_range(self, client: TestClient) -> None:
        task = make_task(client, "Write report")
        make_session(
            client,
            started_at="2026-06-01T09:00:00Z",
            ended_at="2026-06-01T09:30:00Z",
            task_id=task["id"],
        )

        body = stats(client, "2026-07-01", "2026-07-07")

        assert body["tasks"] == []


class TestStatsValidation:
    def test_start_and_end_are_required_and_ordered(self, client: TestClient) -> None:
        assert client.get("/api/v1/focus-stats").status_code == 422
        assert (
            client.get(
                "/api/v1/focus-stats", params={"start": "2026-07-07", "end": "2026-07-01"}
            ).status_code
            == 422
        )

    def test_unknown_timezone_is_422(self, client: TestClient) -> None:
        response = client.get(
            "/api/v1/focus-stats",
            params={"start": "2026-07-01", "end": "2026-07-07", "tz": "Mars/Olympus"},
        )

        assert response.status_code == 422
