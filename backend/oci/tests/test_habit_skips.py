"""Habit skips (issue #564): a User skips one scheduled Habit day on purpose,
which is not the same as forgetting it.

A skip is an explicit scheduled date. It creates no Check-in and counts as
neither success nor failure: the Streak steps over it. Existing Check-ins
stay authoritative — a skip over one is refused and nothing is deleted — and
a skipped date refuses a Check-in until the skip is removed.
"""

from fastapi.testclient import TestClient

from tests.test_habit_pauses import pause
from tests.test_habit_stats import check_in, stats
from tests.test_habits import make_habit


def skip(client: TestClient, habit_id: int, day: str) -> dict:
    response = client.put(f"/api/v1/habits/{habit_id}/skips/{day}")
    assert response.status_code == 200, response.text
    return response.json()


def skips_of(client: TestClient, habit_id: int) -> list[str]:
    response = client.get(f"/api/v1/habits/{habit_id}")
    assert response.status_code == 200, response.text
    return response.json()["skips"]


class TestSkip:
    def test_a_skipped_day_is_listed_on_the_habit(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")

        created = skip(client, habit["id"], "2026-07-03")

        assert created == {"habit_id": habit["id"], "date": "2026-07-03"}
        assert skips_of(client, habit["id"]) == ["2026-07-03"]

    def test_skips_are_listed_oldest_first(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        skip(client, habit["id"], "2026-07-09")
        skip(client, habit["id"], "2026-07-03")

        assert skips_of(client, habit["id"]) == ["2026-07-03", "2026-07-09"]

    def test_skipping_the_same_day_twice_keeps_one_skip(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        skip(client, habit["id"], "2026-07-03")
        skip(client, habit["id"], "2026-07-03")

        assert skips_of(client, habit["id"]) == ["2026-07-03"]

    def test_a_skip_creates_no_check_in(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        skip(client, habit["id"], "2026-07-03")

        assert stats(client, habit["id"], "2026-07-03")["heatmap"] == []

    def test_an_unscheduled_day_cannot_be_skipped(self, client: TestClient) -> None:
        # Mon/Wed/Fri: Tuesday 2026-06-30 is an off day.
        habit = make_habit(client, "Lift", frequency="FREQ=WEEKLY;BYDAY=MO,WE,FR")

        response = client.put(f"/api/v1/habits/{habit['id']}/skips/2026-06-30")

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "skip_not_scheduled"
        assert skips_of(client, habit["id"]) == []

    def test_a_paused_day_cannot_be_skipped(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        pause(client, habit["id"], "2026-07-01", "2026-07-05")

        response = client.put(f"/api/v1/habits/{habit['id']}/skips/2026-07-03")

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "habit_day_paused"
        assert skips_of(client, habit["id"]) == []

    def test_a_day_with_a_check_in_cannot_be_skipped(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        check_in(client, habit["id"], "2026-07-03")

        response = client.put(f"/api/v1/habits/{habit['id']}/skips/2026-07-03")

        assert response.status_code == 409
        error = response.json()["error"]
        assert error["code"] == "skip_conflicts_with_check_in"
        assert error["details"] == {"dates": ["2026-07-03"]}
        assert "2026-07-03" in error["message"]
        # Nothing is deleted, and no skip is stored.
        assert skips_of(client, habit["id"]) == []
        heatmap = stats(client, habit["id"], "2026-07-03")["heatmap"]
        assert [day["date"] for day in heatmap] == ["2026-07-03"]

    def test_an_unknown_habit_is_404(self, client: TestClient) -> None:
        assert client.put("/api/v1/habits/999/skips/2026-07-03").status_code == 404


class TestUnskip:
    def test_removing_a_skip_makes_the_day_eligible_again(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        skip(client, habit["id"], "2026-07-03")

        response = client.delete(f"/api/v1/habits/{habit['id']}/skips/2026-07-03")

        assert response.status_code == 204
        assert skips_of(client, habit["id"]) == []
        check_in(client, habit["id"], "2026-07-03")

    def test_removing_a_day_that_was_not_skipped_is_404(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")

        response = client.delete(f"/api/v1/habits/{habit['id']}/skips/2026-07-03")

        assert response.status_code == 404


class TestCheckInOnASkippedDay:
    def test_is_refused_until_the_skip_is_removed(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        skip(client, habit["id"], "2026-07-03")

        refused = client.put(f"/api/v1/habits/{habit['id']}/check-ins/2026-07-03", json={})

        assert refused.status_code == 409
        assert refused.json()["error"]["code"] == "habit_day_skipped"
        assert stats(client, habit["id"], "2026-07-03")["heatmap"] == []

    def test_neighbouring_days_still_check_in(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        skip(client, habit["id"], "2026-07-03")

        check_in(client, habit["id"], "2026-07-02")
        check_in(client, habit["id"], "2026-07-04")


class TestStreakAcrossASkip:
    def test_a_skipped_day_is_stepped_over_not_counted(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        for day in ("2026-07-01", "2026-07-02"):
            check_in(client, habit["id"], day)
        skip(client, habit["id"], "2026-07-03")
        check_in(client, habit["id"], "2026-07-04")

        # Three checked-in days; the skipped day neither breaks nor adds.
        assert stats(client, habit["id"], "2026-07-04")["streak"] == 3

    def test_a_skipped_today_keeps_the_run(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        check_in(client, habit["id"], "2026-07-02")
        skip(client, habit["id"], "2026-07-03")

        assert stats(client, habit["id"], "2026-07-03")["streak"] == 1

    def test_a_missed_day_still_breaks_the_run_beside_a_skip(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        check_in(client, habit["id"], "2026-07-01")  # 07-02 is missed
        skip(client, habit["id"], "2026-07-03")
        check_in(client, habit["id"], "2026-07-04")

        assert stats(client, habit["id"], "2026-07-04")["streak"] == 1

    def test_removing_the_skip_turns_the_day_back_into_a_miss(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        check_in(client, habit["id"], "2026-07-02")
        skip(client, habit["id"], "2026-07-03")
        check_in(client, habit["id"], "2026-07-04")
        client.delete(f"/api/v1/habits/{habit['id']}/skips/2026-07-03")

        assert stats(client, habit["id"], "2026-07-04")["streak"] == 1
