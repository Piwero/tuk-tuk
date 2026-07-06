"""Habit statistics: server-computed Streak and yearly heatmap (issue #33).

The Streak counts consecutive scheduled days checked in, walking back from
`today`: a missed scheduled day resets it, unscheduled days are skipped, and
an unticked today is graced (the day isn't over yet).
"""

from fastapi.testclient import TestClient

from tests.test_habits import make_habit


def check_in(client: TestClient, habit_id: int, day: str, value: float | None = None) -> None:
    body = {} if value is None else {"value": value}
    response = client.put(f"/api/v1/habits/{habit_id}/check-ins/{day}", json=body)
    assert response.status_code == 200, response.text


def stats(client: TestClient, habit_id: int, today: str, year: int | None = None) -> dict:
    params: dict[str, object] = {"today": today}
    if year is not None:
        params["year"] = year
    response = client.get(f"/api/v1/habits/{habit_id}/stats", params=params)
    assert response.status_code == 200, response.text
    return response.json()


class TestStreak:
    def test_counts_consecutive_scheduled_days_up_to_today(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        for day in ("2026-07-01", "2026-07-02", "2026-07-03"):
            check_in(client, habit["id"], day)

        assert stats(client, habit["id"], "2026-07-03")["streak"] == 3

    def test_a_missed_scheduled_day_resets_it(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        for day in ("2026-06-30", "2026-07-01", "2026-07-03"):  # missed the 2nd
            check_in(client, habit["id"], day)

        assert stats(client, habit["id"], "2026-07-03")["streak"] == 1

    def test_unscheduled_days_are_skipped_not_broken(self, client: TestClient) -> None:
        # Mon 2026-06-29, Wed 2026-07-01, Fri 2026-07-03: Tue and Thu are
        # unscheduled and must not break the run.
        habit = make_habit(client, "Lift", frequency="FREQ=WEEKLY;BYDAY=MO,WE,FR")
        for day in ("2026-06-29", "2026-07-01", "2026-07-03"):
            check_in(client, habit["id"], day)

        assert stats(client, habit["id"], "2026-07-03")["streak"] == 3

    def test_an_unticked_today_is_graced_not_broken(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        for day in ("2026-07-01", "2026-07-02"):
            check_in(client, habit["id"], day)

        assert stats(client, habit["id"], "2026-07-03")["streak"] == 2

    def test_no_check_ins_means_no_streak(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")

        assert stats(client, habit["id"], "2026-07-03")["streak"] == 0

    def test_check_ins_on_unscheduled_days_do_not_count(self, client: TestClient) -> None:
        # A backfilled Tuesday on a Mon-only habit is history, not streak.
        habit = make_habit(client, "Review week", frequency="FREQ=WEEKLY;BYDAY=MO")
        check_in(client, habit["id"], "2026-06-29")  # Monday
        check_in(client, habit["id"], "2026-06-30")  # Tuesday (unscheduled)

        assert stats(client, habit["id"], "2026-07-03")["streak"] == 1


class TestHeatmap:
    def test_numeric_intensity_scales_by_goal_and_caps_at_one(self, client: TestClient) -> None:
        habit = make_habit(client, "Drink water", type="numeric", goal=8, unit="glasses")
        check_in(client, habit["id"], "2026-07-01", value=4)
        check_in(client, habit["id"], "2026-07-02", value=8)
        check_in(client, habit["id"], "2026-07-03", value=12)

        heatmap = stats(client, habit["id"], "2026-07-03")["heatmap"]

        assert heatmap == [
            {"date": "2026-07-01", "value": 4, "intensity": 0.5},
            {"date": "2026-07-02", "value": 8, "intensity": 1.0},
            {"date": "2026-07-03", "value": 12, "intensity": 1.0},
        ]

    def test_boolean_check_ins_are_full_intensity(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        check_in(client, habit["id"], "2026-07-03")

        heatmap = stats(client, habit["id"], "2026-07-03")["heatmap"]

        assert heatmap == [{"date": "2026-07-03", "value": 1, "intensity": 1.0}]

    def test_covers_one_calendar_year_chosen_by_the_year_param(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        check_in(client, habit["id"], "2025-12-31")
        check_in(client, habit["id"], "2026-01-01")

        this_year = stats(client, habit["id"], "2026-07-03")["heatmap"]
        assert [day["date"] for day in this_year] == ["2026-01-01"]

        last_year = stats(client, habit["id"], "2026-07-03", year=2025)["heatmap"]
        assert [day["date"] for day in last_year] == ["2025-12-31"]

    def test_the_streak_ignores_the_year_param(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        for day in ("2026-07-02", "2026-07-03"):
            check_in(client, habit["id"], day)

        assert stats(client, habit["id"], "2026-07-03", year=2025)["streak"] == 2


class TestStatsValidation:
    def test_today_is_required(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")

        assert client.get(f"/api/v1/habits/{habit['id']}/stats").status_code == 422

    def test_unknown_habit_is_404(self, client: TestClient) -> None:
        response = client.get("/api/v1/habits/999/stats", params={"today": "2026-07-03"})

        assert response.status_code == 404
