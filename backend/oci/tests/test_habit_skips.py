"""Habit skips (issue #564): a User skips one scheduled Habit day on purpose,
which is not the same as forgetting it.

A skip is an explicit scheduled date. It creates no Check-in and counts as
neither success nor failure: the Streak steps over it. Existing Check-ins
stay authoritative — a skip over one is refused and nothing is deleted — and
a skipped date refuses a Check-in until the skip is removed.
"""

from fastapi.testclient import TestClient

from tests.test_habit_pauses import pause
from tests.test_habit_stats import check_in, created_at, stats
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


class TestWeeklyTarget:
    """A times-per-week Habit's week under pause and skip (issue #568): only a
    pause covering the whole week excludes it; a partial-week pause or any
    skip leaves the weekly Target unchanged and shows what remains. The week
    runs Monday to Sunday; here Mon 2026-07-06 to Sun 2026-07-12."""

    def weekly(self, client: TestClient, database_url: str, times: int = 3) -> dict:
        habit = make_habit(client, "Run", frequency=f"FREQ=WEEKLY;TT_TIMES={times}")
        created_at(database_url, habit["id"], "2026-06-01T10:00:00Z")
        return habit

    def test_a_partially_paused_week_keeps_its_target(
        self, client: TestClient, database_url: str
    ) -> None:
        habit = self.weekly(client, database_url)
        check_in(client, habit["id"], "2026-07-06")
        pause(client, habit["id"], "2026-07-07", "2026-07-09")

        week = stats(client, habit["id"], "2026-07-10")["week"]

        assert week == {
            "start": "2026-07-06",
            "end": "2026-07-12",
            "target": 3,
            "done": 1,
            "remaining": 2,
            "paused_days": 3,
            "skipped_days": 0,
            "excluded": False,
        }

    def test_a_fully_paused_week_is_excluded(self, client: TestClient, database_url: str) -> None:
        habit = self.weekly(client, database_url)
        pause(client, habit["id"], "2026-07-06", "2026-07-12")

        week = stats(client, habit["id"], "2026-07-08")["week"]

        assert week["excluded"] is True
        assert week["paused_days"] == 7
        assert week["target"] == 3

    def test_an_open_ended_pause_from_monday_excludes_the_week(
        self, client: TestClient, database_url: str
    ) -> None:
        habit = self.weekly(client, database_url)
        pause(client, habit["id"], "2026-07-06")

        assert stats(client, habit["id"], "2026-07-08")["week"]["excluded"] is True

    def test_a_pause_missing_one_day_of_the_week_does_not_exclude_it(
        self, client: TestClient, database_url: str
    ) -> None:
        habit = self.weekly(client, database_url)
        pause(client, habit["id"], "2026-07-07", "2026-07-12")  # Monday stays eligible

        week = stats(client, habit["id"], "2026-07-08")["week"]

        assert week["excluded"] is False
        assert week["target"] == 3
        assert week["remaining"] == 3

    def test_a_week_paused_from_the_habit_start_on_is_excluded(
        self, client: TestClient, database_url: str
    ) -> None:
        # Created on Thursday and paused Thursday to Sunday: no day of the
        # week could be practised.
        habit = make_habit(client, "Run", frequency="FREQ=WEEKLY;TT_TIMES=3")
        created_at(database_url, habit["id"], "2026-07-09T10:00:00Z")
        pause(client, habit["id"], "2026-07-09", "2026-07-12")

        assert stats(client, habit["id"], "2026-07-10")["week"]["excluded"] is True

    def test_a_skip_inside_the_week_keeps_its_target(
        self, client: TestClient, database_url: str
    ) -> None:
        habit = self.weekly(client, database_url)
        check_in(client, habit["id"], "2026-07-06")
        skip(client, habit["id"], "2026-07-07")
        skip(client, habit["id"], "2026-07-11")  # a planned skip still to come

        week = stats(client, habit["id"], "2026-07-08")["week"]

        assert week["target"] == 3
        assert week["done"] == 1
        assert week["remaining"] == 2
        assert week["skipped_days"] == 2
        assert week["excluded"] is False

    def test_a_fully_skipped_week_is_not_excluded(
        self, client: TestClient, database_url: str
    ) -> None:
        # Only a pause excludes a week; seven skips keep the Target.
        habit = self.weekly(client, database_url)
        for day in range(6, 13):
            skip(client, habit["id"], f"2026-07-{day:02d}")

        week = stats(client, habit["id"], "2026-07-12")["week"]

        assert week["excluded"] is False
        assert week["skipped_days"] == 7
        assert week["remaining"] == 3

    def test_a_met_target_has_nothing_remaining(
        self, client: TestClient, database_url: str
    ) -> None:
        habit = self.weekly(client, database_url, times=2)
        for day in ("2026-07-06", "2026-07-07", "2026-07-08"):
            check_in(client, habit["id"], day)

        week = stats(client, habit["id"], "2026-07-08")["week"]

        assert week["done"] == 3
        assert week["remaining"] == 0

    def test_a_partial_numeric_day_is_not_done(self, client: TestClient, database_url: str) -> None:
        habit = make_habit(
            client,
            "Swim",
            type="numeric",
            target=20,
            unit="laps",
            frequency="FREQ=WEEKLY;TT_TIMES=2",
        )
        created_at(database_url, habit["id"], "2026-06-01T10:00:00Z")
        check_in(client, habit["id"], "2026-07-06", value=20)
        check_in(client, habit["id"], "2026-07-07", value=5)

        week = stats(client, habit["id"], "2026-07-08")["week"]

        assert week["done"] == 1
        assert week["remaining"] == 1

    def test_a_frequency_change_during_a_pause_applies_to_the_whole_week(
        self, client: TestClient, database_url: str
    ) -> None:
        # No versioned schedule: the current frequency reads every week, the
        # paused one included, and a lower Target is the User's explicit choice.
        habit = self.weekly(client, database_url)
        check_in(client, habit["id"], "2026-07-06")
        pause(client, habit["id"], "2026-07-07", "2026-07-09")
        changed = client.patch(
            f"/api/v1/habits/{habit['id']}", json={"frequency": "FREQ=WEEKLY;TT_TIMES=2"}
        )
        assert changed.status_code == 200, changed.text

        week = stats(client, habit["id"], "2026-07-08")["week"]

        assert week["target"] == 2
        assert week["remaining"] == 1
        assert week["paused_days"] == 3
        assert week["excluded"] is False

    def test_changing_to_daily_during_a_pause_drops_the_week(
        self, client: TestClient, database_url: str
    ) -> None:
        habit = self.weekly(client, database_url)
        pause(client, habit["id"], "2026-07-06", "2026-07-12")
        client.patch(f"/api/v1/habits/{habit['id']}", json={"frequency": "FREQ=DAILY"})

        body = stats(client, habit["id"], "2026-07-08")

        assert body["week"] is None
        assert body["streak"] == 0

    def test_a_fully_paused_week_keeps_the_streak_across_it(
        self, client: TestClient, database_url: str
    ) -> None:
        habit = self.weekly(client, database_url)
        for day in ("2026-07-04", "2026-07-05"):
            check_in(client, habit["id"], day)
        pause(client, habit["id"], "2026-07-06", "2026-07-12")
        check_in(client, habit["id"], "2026-07-13")

        assert stats(client, habit["id"], "2026-07-13")["streak"] == 3

    def test_daily_and_weekday_habits_have_no_week(self, client: TestClient) -> None:
        daily = make_habit(client, "Meditate")
        weekdays = make_habit(client, "Lift", frequency="FREQ=WEEKLY;BYDAY=MO,WE")

        assert stats(client, daily["id"], "2026-07-08")["week"] is None
        assert stats(client, weekdays["id"], "2026-07-08")["week"] is None
