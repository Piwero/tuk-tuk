"""Habit pauses (issue #559): a User pauses a Habit for travel or illness,
and those days stop counting as missed.

A pause is an explicit date interval, optionally open-ended. Paused days are
not eligible: the Streak steps over them, never rewarding them as done.
Existing Check-ins stay authoritative — a pause over them is refused, and a
paused date refuses a new Check-in.
"""

from fastapi.testclient import TestClient

from tests.test_goals import make_goal, make_key_result
from tests.test_habit_stats import check_in, stats
from tests.test_habits import make_habit


def pause(client: TestClient, habit_id: int, start: str, end: str | None = None) -> dict:
    response = client.post(
        f"/api/v1/habits/{habit_id}/pauses", json={"start_date": start, "end_date": end}
    )
    assert response.status_code == 201, response.text
    return response.json()


def pauses_of(client: TestClient, habit_id: int) -> list[dict]:
    response = client.get(f"/api/v1/habits/{habit_id}")
    assert response.status_code == 200, response.text
    return response.json()["pauses"]


class TestCreatePause:
    def test_a_bounded_pause_is_listed_on_the_habit(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")

        created = pause(client, habit["id"], "2026-07-01", "2026-07-10")

        assert created["start_date"] == "2026-07-01"
        assert created["end_date"] == "2026-07-10"
        assert created["habit_id"] == habit["id"]
        assert pauses_of(client, habit["id"]) == [created]

    def test_an_open_ended_pause_has_no_end(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")

        created = pause(client, habit["id"], "2026-07-01")

        assert created["end_date"] is None

    def test_an_end_before_the_start_is_rejected(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")

        response = client.post(
            f"/api/v1/habits/{habit['id']}/pauses",
            json={"start_date": "2026-07-10", "end_date": "2026-07-01"},
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_pause"
        assert pauses_of(client, habit["id"]) == []

    def test_a_pause_over_check_ins_is_refused_listing_those_dates(
        self, client: TestClient
    ) -> None:
        habit = make_habit(client, "Meditate")
        for day in ("2026-06-30", "2026-07-03", "2026-07-05", "2026-07-11"):
            check_in(client, habit["id"], day)

        response = client.post(
            f"/api/v1/habits/{habit['id']}/pauses",
            json={"start_date": "2026-07-01", "end_date": "2026-07-10"},
        )

        assert response.status_code == 409
        error = response.json()["error"]
        assert error["code"] == "pause_conflicts_with_check_ins"
        assert error["details"] == {"dates": ["2026-07-03", "2026-07-05"]}
        assert "2026-07-03" in error["message"]
        # Nothing is deleted, and no pause is stored.
        assert pauses_of(client, habit["id"]) == []
        heatmap = stats(client, habit["id"], "2026-07-11")["heatmap"]
        assert [day["date"] for day in heatmap] == [
            "2026-06-30",
            "2026-07-03",
            "2026-07-05",
            "2026-07-11",
        ]

    def test_an_open_ended_pause_conflicts_with_any_later_check_in(
        self, client: TestClient
    ) -> None:
        habit = make_habit(client, "Meditate")
        check_in(client, habit["id"], "2026-08-20")

        response = client.post(
            f"/api/v1/habits/{habit['id']}/pauses", json={"start_date": "2026-07-01"}
        )

        assert response.status_code == 409
        assert response.json()["error"]["details"] == {"dates": ["2026-08-20"]}

    def test_an_overlapping_pause_is_refused(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        pause(client, habit["id"], "2026-07-01", "2026-07-10")

        response = client.post(
            f"/api/v1/habits/{habit['id']}/pauses",
            json={"start_date": "2026-07-10", "end_date": "2026-07-12"},
        )

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "pause_overlaps"
        assert len(pauses_of(client, habit["id"])) == 1

    def test_back_to_back_pauses_are_kept_oldest_first(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        later = pause(client, habit["id"], "2026-07-11", "2026-07-12")
        earlier = pause(client, habit["id"], "2026-07-01", "2026-07-10")

        assert pauses_of(client, habit["id"]) == [earlier, later]

    def test_an_unknown_habit_is_404(self, client: TestClient) -> None:
        response = client.post("/api/v1/habits/999/pauses", json={"start_date": "2026-07-01"})

        assert response.status_code == 404


class TestEditPause:
    def test_moves_the_dates(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        created = pause(client, habit["id"], "2026-07-01", "2026-07-10")

        response = client.patch(
            f"/api/v1/habits/{habit['id']}/pauses/{created['id']}",
            json={"end_date": "2026-07-14"},
        )

        assert response.status_code == 200, response.text
        assert response.json()["start_date"] == "2026-07-01"
        assert response.json()["end_date"] == "2026-07-14"
        assert pauses_of(client, habit["id"])[0]["end_date"] == "2026-07-14"

    def test_a_null_end_makes_it_open_ended(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        created = pause(client, habit["id"], "2026-07-01", "2026-07-10")

        response = client.patch(
            f"/api/v1/habits/{habit['id']}/pauses/{created['id']}", json={"end_date": None}
        )

        assert response.json()["end_date"] is None

    def test_extending_over_a_check_in_is_refused_listing_it(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        created = pause(client, habit["id"], "2026-07-01", "2026-07-10")
        check_in(client, habit["id"], "2026-07-12")

        response = client.patch(
            f"/api/v1/habits/{habit['id']}/pauses/{created['id']}",
            json={"end_date": "2026-07-14"},
        )

        assert response.status_code == 409
        assert response.json()["error"]["details"] == {"dates": ["2026-07-12"]}
        assert pauses_of(client, habit["id"])[0]["end_date"] == "2026-07-10"

    def test_an_inverted_edit_is_rejected(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        created = pause(client, habit["id"], "2026-07-05", "2026-07-10")

        response = client.patch(
            f"/api/v1/habits/{habit['id']}/pauses/{created['id']}",
            json={"start_date": "2026-07-11"},
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_pause"

    def test_a_start_may_not_be_null(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        created = pause(client, habit["id"], "2026-07-05", "2026-07-10")

        response = client.patch(
            f"/api/v1/habits/{habit['id']}/pauses/{created['id']}", json={"start_date": None}
        )

        assert response.status_code == 422

    def test_an_unknown_pause_is_404(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")

        response = client.patch(
            f"/api/v1/habits/{habit['id']}/pauses/999", json={"end_date": "2026-07-14"}
        )

        assert response.status_code == 404
        assert client.delete(f"/api/v1/habits/{habit['id']}/pauses/999").status_code == 404


def resume(client: TestClient, habit_id: int, pause_id: int, today: str) -> dict:
    response = client.post(
        f"/api/v1/habits/{habit_id}/pauses/{pause_id}/resume", json={"today": today}
    )
    assert response.status_code == 200, response.text
    return response.json()


class TestResumeToday:
    def test_ends_the_pause_yesterday_so_today_is_eligible(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        created = pause(client, habit["id"], "2026-07-01")

        body = resume(client, habit["id"], created["id"], "2026-07-06")

        assert body["id"] == habit["id"]
        assert body["pauses"] == [{**created, "end_date": "2026-07-05"}]
        check_in(client, habit["id"], "2026-07-06")

    def test_shortens_a_bounded_pause(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        created = pause(client, habit["id"], "2026-07-01", "2026-07-10")

        body = resume(client, habit["id"], created["id"], "2026-07-04")

        assert body["pauses"][0]["end_date"] == "2026-07-03"

    def test_a_pause_not_yet_begun_is_removed(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        created = pause(client, habit["id"], "2026-07-04", "2026-07-10")

        body = resume(client, habit["id"], created["id"], "2026-07-04")

        assert body["pauses"] == []
        assert pauses_of(client, habit["id"]) == []

    def test_a_pause_already_over_is_left_alone(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        created = pause(client, habit["id"], "2026-07-01", "2026-07-02")

        body = resume(client, habit["id"], created["id"], "2026-07-06")

        assert body["pauses"] == [created]

    def test_the_streak_carries_on_after_resuming(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        check_in(client, habit["id"], "2026-06-30")
        created = pause(client, habit["id"], "2026-07-01")
        resume(client, habit["id"], created["id"], "2026-07-04")
        check_in(client, habit["id"], "2026-07-04")

        assert stats(client, habit["id"], "2026-07-04")["streak"] == 2


class TestCheckInOnAPausedDay:
    def test_is_refused_until_the_pause_is_removed(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        paused = pause(client, habit["id"], "2026-07-01", "2026-07-10")

        response = client.put(f"/api/v1/habits/{habit['id']}/check-ins/2026-07-05", json={})

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "habit_day_paused"
        assert stats(client, habit["id"], "2026-07-11")["heatmap"] == []

        removed = client.delete(f"/api/v1/habits/{habit['id']}/pauses/{paused['id']}")
        assert removed.status_code == 204
        check_in(client, habit["id"], "2026-07-05")

    def test_days_outside_the_pause_still_check_in(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        pause(client, habit["id"], "2026-07-01", "2026-07-10")

        check_in(client, habit["id"], "2026-06-30")
        check_in(client, habit["id"], "2026-07-11")

    def test_an_open_ended_pause_refuses_every_later_day(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        pause(client, habit["id"], "2026-07-01")

        response = client.put(f"/api/v1/habits/{habit['id']}/check-ins/2027-01-01", json={})

        assert response.status_code == 409


class TestGoalsAndPauses:
    """Key Results counting a Habit's Check-ins honour eligibility; a settled
    Goal Score stays frozen (ADR 0012)."""

    def key_result_goal(self, client: TestClient, habit_id: int, start: str, end: str) -> dict:
        goal = make_goal(client, "Calm", start_date=start, end_date=end)
        return make_key_result(
            client,
            goal["id"],
            "Meditation days",
            source="habit_checkins",
            source_habit_id=habit_id,
            start_value=0,
            target_value=4,
        )

    def test_an_active_key_result_counts_only_eligible_check_ins(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        goal = self.key_result_goal(client, habit["id"], "2026-07-01", "2099-12-31")
        check_in(client, habit["id"], "2026-07-01")
        pause(client, habit["id"], "2026-07-02", "2026-07-05")
        refused = client.put(f"/api/v1/habits/{habit['id']}/check-ins/2026-07-03", json={})
        assert refused.status_code == 409
        check_in(client, habit["id"], "2026-07-06")

        body = client.get(f"/api/v1/goals/{goal['id']}").json()

        assert body["key_results"][0]["current_value"] == 2
        assert body["status"] == "active"

    def test_a_settled_goal_score_is_unchanged_by_a_pause_inside_its_window(
        self, client: TestClient
    ) -> None:
        habit = make_habit(client, "Meditate")
        goal = self.key_result_goal(client, habit["id"], "2020-01-01", "2099-12-31")
        for day in ("2020-01-02", "2020-01-03"):
            check_in(client, habit["id"], day)
        client.patch(f"/api/v1/goals/{goal['id']}", json={"end_date": "2020-01-31"})
        settled = client.get(f"/api/v1/goals/{goal['id']}").json()
        assert settled["status"] == "closed"
        assert settled["final_score"] == 0.5

        pause(client, habit["id"], "2020-01-10", "2020-01-20")

        reread = client.get(f"/api/v1/goals/{goal['id']}").json()
        assert reread["status"] == "closed"
        assert reread["final_score"] == 0.5


class TestStreakAcrossAPause:
    def test_paused_days_are_stepped_over_not_counted(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        for day in ("2026-06-29", "2026-06-30"):
            check_in(client, habit["id"], day)
        pause(client, habit["id"], "2026-07-01", "2026-07-05")
        for day in ("2026-07-06", "2026-07-07"):
            check_in(client, habit["id"], day)

        # Four checked-in eligible days; the five paused days add nothing.
        assert stats(client, habit["id"], "2026-07-07")["streak"] == 4

    def test_a_paused_today_and_yesterday_keep_the_run(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        for day in ("2026-06-29", "2026-06-30"):
            check_in(client, habit["id"], day)
        pause(client, habit["id"], "2026-07-01")

        assert stats(client, habit["id"], "2026-07-03")["streak"] == 2

    def test_a_miss_before_the_pause_still_breaks_the_run(self, client: TestClient) -> None:
        habit = make_habit(client, "Meditate")
        check_in(client, habit["id"], "2026-06-28")  # missed the 29th and 30th
        pause(client, habit["id"], "2026-07-01", "2026-07-02")
        check_in(client, habit["id"], "2026-07-03")

        assert stats(client, habit["id"], "2026-07-03")["streak"] == 1

    def test_a_weekday_schedule_steps_over_both_off_days_and_paused_days(
        self, client: TestClient
    ) -> None:
        # Mon/Wed/Fri: Mon 06-29 checked, Wed 07-01 and Fri 07-03 paused,
        # Mon 07-06 checked.
        habit = make_habit(client, "Lift", frequency="FREQ=WEEKLY;BYDAY=MO,WE,FR")
        check_in(client, habit["id"], "2026-06-29")
        pause(client, habit["id"], "2026-07-01", "2026-07-03")
        check_in(client, habit["id"], "2026-07-06")

        assert stats(client, habit["id"], "2026-07-07")["streak"] == 2

    def test_a_numeric_habit_keeps_partial_days_in_the_run(self, client: TestClient) -> None:
        habit = make_habit(client, "Drink water", type="numeric", target=8, unit="glasses")
        check_in(client, habit["id"], "2026-06-30", value=8)
        pause(client, habit["id"], "2026-07-01", "2026-07-01")
        check_in(client, habit["id"], "2026-07-02", value=3)

        assert stats(client, habit["id"], "2026-07-02")["streak"] == 2

    def test_a_check_in_earlier_than_the_pause_is_kept_and_counted(
        self, client: TestClient
    ) -> None:
        # A backfill before the Habit was created still counts toward the run.
        habit = make_habit(client, "Meditate")
        check_in(client, habit["id"], "2026-01-02")
        pause(client, habit["id"], "2026-01-03", "2026-01-04")
        check_in(client, habit["id"], "2026-01-05")

        body = stats(client, habit["id"], "2026-01-05")
        assert body["streak"] == 2
        assert body["eligible_from"] == "2026-01-02"
