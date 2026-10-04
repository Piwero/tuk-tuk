"""Goals: create, list, edit and delete (issue #232, ADR 0012).

No Key Results yet — this slice is the OKR spine plus WOOP framing
(obstacle/if_then_plan), both nullable so a Goal is creatable in seconds.
"""

from fastapi.testclient import TestClient


def only_task(client: TestClient, task_id: int) -> dict:
    """Tasks have no GET-by-id route; read the row back off the collection."""
    items = client.get("/api/v1/tasks").json()["items"]
    return next(item for item in items if item["id"] == task_id)


def make_goal(client: TestClient, title: str, **fields: object) -> dict:
    response = client.post("/api/v1/goals", json={"title": title, **fields})
    assert response.status_code == 201, response.text
    return response.json()


class TestCreateGoal:
    def test_title_and_description_only(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/goals", json={"title": "Ship v2", "description": "Get it out the door"}
        )

        assert response.status_code == 201
        body = response.json()
        assert body["title"] == "Ship v2"
        assert body["description"] == "Get it out the door"
        assert body["obstacle"] is None
        assert body["if_then_plan"] is None
        assert body["status"] == "active"
        assert body["is_focused"] is False
        assert body["final_score"] is None
        assert body["retro"] is None
        assert isinstance(body["id"], int)

    def test_obstacle_and_if_then_plan_are_optional_but_settable(self, client: TestClient) -> None:
        body = make_goal(
            client,
            "Run a marathon",
            obstacle="I get too tired after work",
            if_then_plan="If I feel tired after work, then I will run anyway for 10 minutes",
        )

        assert body["obstacle"] == "I get too tired after work"
        assert (
            body["if_then_plan"]
            == "If I feel tired after work, then I will run anyway for 10 minutes"
        )

    def test_defaults_to_the_current_quarters_window(self, client: TestClient) -> None:
        body = make_goal(client, "Ship v2")

        assert body["start_date"] is not None
        assert body["end_date"] is not None
        assert body["start_date"] <= body["end_date"]

    def test_both_dates_can_be_overridden(self, client: TestClient) -> None:
        body = make_goal(client, "Six-week goal", start_date="2026-01-01", end_date="2026-02-15")

        assert body["start_date"] == "2026-01-01"
        assert body["end_date"] == "2026-02-15"

    def test_a_blank_title_is_rejected(self, client: TestClient) -> None:
        response = client.post("/api/v1/goals", json={"title": ""})

        assert response.status_code == 422


class TestListGoals:
    def test_goals_are_listed(self, client: TestClient) -> None:
        make_goal(client, "Ship v2")
        make_goal(client, "Run a marathon")

        response = client.get("/api/v1/goals")

        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 2
        assert [g["title"] for g in body["items"]] == ["Ship v2", "Run a marathon"]

    def test_a_single_goal_is_readable(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")

        response = client.get(f"/api/v1/goals/{goal['id']}")

        assert response.status_code == 200
        assert response.json()["title"] == "Ship v2"

    def test_unknown_goal_is_404(self, client: TestClient) -> None:
        assert client.get("/api/v1/goals/999").status_code == 404


class TestUpdateAndDeleteGoal:
    def test_patch_edits_fields_in_place(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")

        response = client.patch(
            f"/api/v1/goals/{goal['id']}",
            json={
                "title": "Ship v2.1",
                "obstacle": "Scope creep",
                "if_then_plan": "If scope creeps, then I will cut a feature",
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "Ship v2.1"
        assert body["obstacle"] == "Scope creep"
        assert body["if_then_plan"] == "If scope creeps, then I will cut a feature"

    def test_dates_can_be_overridden_after_creation(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")

        response = client.patch(
            f"/api/v1/goals/{goal['id']}",
            json={"start_date": "2026-03-01", "end_date": "2026-04-30"},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["start_date"] == "2026-03-01"
        assert body["end_date"] == "2026-04-30"

    def test_obstacle_and_if_then_plan_can_be_cleared_with_null(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2", obstacle="Scope creep")

        response = client.patch(f"/api/v1/goals/{goal['id']}", json={"obstacle": None})

        assert response.status_code == 200
        assert response.json()["obstacle"] is None

    def test_focusing_a_goal_clears_the_previous_focus(self, client: TestClient) -> None:
        first = make_goal(client, "Ship v2")
        second = make_goal(client, "Ship v3")
        client.patch(f"/api/v1/goals/{first['id']}", json={"is_focused": True})

        response = client.patch(f"/api/v1/goals/{second['id']}", json={"is_focused": True})

        assert response.status_code == 200
        assert response.json()["is_focused"] is True
        first_now = client.get(f"/api/v1/goals/{first['id']}").json()
        assert first_now["is_focused"] is False

    def test_title_may_not_be_set_to_explicit_null(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")

        response = client.patch(f"/api/v1/goals/{goal['id']}", json={"title": None})

        assert response.status_code == 422

    def test_delete_removes_the_goal(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")

        assert client.delete(f"/api/v1/goals/{goal['id']}").status_code == 204

        assert client.get("/api/v1/goals").json()["total"] == 0
        assert client.get(f"/api/v1/goals/{goal['id']}").status_code == 404

    def test_deleting_a_goal_leaves_tasks_and_habits_untouched(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")
        task = client.post("/api/v1/tasks", json={"title": "Write code"}).json()
        habit = client.post("/api/v1/habits", json={"name": "Meditate"}).json()

        client.delete(f"/api/v1/goals/{goal['id']}")

        tasks = client.get("/api/v1/tasks").json()["items"]
        assert [t["id"] for t in tasks] == [task["id"]]
        assert client.get("/api/v1/habits").json()["total"] == 1
        assert habit["name"] == "Meditate"

    def test_unknown_goal_is_404(self, client: TestClient) -> None:
        assert client.patch("/api/v1/goals/999", json={"title": "X"}).status_code == 404
        assert client.delete("/api/v1/goals/999").status_code == 404


def make_key_result(client: TestClient, goal_id: int, name: str, **fields: object) -> dict:
    response = client.post(f"/api/v1/goals/{goal_id}/key-results", json={"name": name, **fields})
    assert response.status_code == 201, response.text
    return response.json()


class TestManualKeyResults:
    def test_creating_a_key_result_returns_the_parent_goal(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")

        body = make_key_result(
            client, goal["id"], "Lines shipped", start_value=0, target_value=100, current_value=25
        )

        assert body["id"] == goal["id"]
        assert len(body["key_results"]) == 1
        kr = body["key_results"][0]
        assert kr["name"] == "Lines shipped"
        assert kr["source"] == "manual"
        assert kr["current_value"] == 25
        assert kr["ratio"] == 0.25
        assert body["score"] == 0.25

    def test_a_goal_with_no_key_results_has_no_score(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")

        assert goal["key_results"] == []
        assert goal["score"] is None

    def test_score_is_the_unweighted_mean_of_ratios(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")
        make_key_result(client, goal["id"], "A", start_value=0, target_value=10, current_value=10)
        body = make_key_result(
            client, goal["id"], "B", start_value=0, target_value=10, current_value=0
        )

        assert body["score"] == 0.5

    def test_descending_key_result(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")

        body = make_key_result(
            client, goal["id"], "Bugs open", start_value=20, target_value=0, current_value=5
        )

        assert body["key_results"][0]["ratio"] == 0.75

    def test_overshoot_is_clamped_to_one(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")

        body = make_key_result(
            client, goal["id"], "Overachieved", start_value=0, target_value=10, current_value=30
        )

        assert body["key_results"][0]["ratio"] == 1.0

    def test_target_equal_start_is_guarded(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")

        not_reached = make_key_result(
            client, goal["id"], "Flat", start_value=5, target_value=5, current_value=0
        )
        assert not_reached["key_results"][0]["ratio"] == 0.0

        reached = make_key_result(
            client, goal["id"], "Flat, met", start_value=5, target_value=5, current_value=5
        )
        assert reached["key_results"][1]["ratio"] == 1.0

    def test_editing_target_updates_ratio(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")
        kr = make_key_result(
            client, goal["id"], "A", start_value=0, target_value=10, current_value=5
        )["key_results"][0]

        response = client.patch(
            f"/api/v1/goals/{goal['id']}/key-results/{kr['id']}", json={"target_value": 5}
        )

        assert response.status_code == 200
        assert response.json()["key_results"][0]["ratio"] == 1.0

    def test_manual_current_value_round_trips(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")
        kr = make_key_result(
            client, goal["id"], "A", start_value=0, target_value=10, current_value=0
        )["key_results"][0]

        response = client.patch(
            f"/api/v1/goals/{goal['id']}/key-results/{kr['id']}", json={"current_value": 7}
        )

        assert response.status_code == 200
        assert response.json()["key_results"][0]["current_value"] == 7

    def test_deleting_a_key_result_removes_it_from_the_goal(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")
        kr = make_key_result(client, goal["id"], "A")["key_results"][0]

        response = client.delete(f"/api/v1/goals/{goal['id']}/key-results/{kr['id']}")

        assert response.status_code == 204
        assert client.get(f"/api/v1/goals/{goal['id']}").json()["key_results"] == []

    def test_reordering_key_results(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")
        first = make_key_result(client, goal["id"], "First")["key_results"][0]
        second_body = make_key_result(client, goal["id"], "Second")
        second = second_body["key_results"][1]
        assert [kr["name"] for kr in second_body["key_results"]] == ["First", "Second"]

        response = client.patch(
            f"/api/v1/goals/{goal['id']}/key-results/{second['id']}",
            json={"sort_order": first["sort_order"] - 1},
        )

        assert [kr["name"] for kr in response.json()["key_results"]] == ["Second", "First"]

    def test_unknown_key_result_is_404(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")

        assert (
            client.patch(
                f"/api/v1/goals/{goal['id']}/key-results/999", json={"name": "X"}
            ).status_code
            == 404
        )
        assert client.delete(f"/api/v1/goals/{goal['id']}/key-results/999").status_code == 404


class TestHabitSourcedKeyResults:
    def test_value_sums_check_ins_within_the_goal_window(self, client: TestClient) -> None:
        habit = client.post("/api/v1/habits", json={"name": "Meditate"}).json()
        goal = make_goal(client, "Ship v2", start_date="2026-01-01", end_date="2026-01-31")
        client.put(f"/api/v1/habits/{habit['id']}/check-ins/2026-01-05", json={"value": 1})
        client.put(f"/api/v1/habits/{habit['id']}/check-ins/2026-01-10", json={"value": 1})
        # Outside the window entirely, so must not count.
        client.put(f"/api/v1/habits/{habit['id']}/check-ins/2025-12-31", json={"value": 1})

        body = make_key_result(
            client,
            goal["id"],
            "Meditation days",
            source="habit_checkins",
            source_habit_id=habit["id"],
            start_value=0,
            target_value=10,
        )

        kr = body["key_results"][0]
        assert kr["current_value"] == 2
        assert kr["source"] == "habit_checkins"

    def test_a_backfilled_check_in_is_reflected_on_the_next_read(self, client: TestClient) -> None:
        habit = client.post("/api/v1/habits", json={"name": "Meditate"}).json()
        goal = make_goal(client, "Ship v2", start_date="2026-01-01", end_date="2026-01-31")
        kr = make_key_result(
            client,
            goal["id"],
            "Meditation days",
            source="habit_checkins",
            source_habit_id=habit["id"],
            target_value=10,
        )["key_results"][0]
        assert kr["current_value"] == 0

        client.put(f"/api/v1/habits/{habit['id']}/check-ins/2026-01-15", json={"value": 1})

        refreshed = client.get(f"/api/v1/goals/{goal['id']}").json()["key_results"][0]
        assert refreshed["current_value"] == 1

    def test_writing_to_an_automatic_value_is_rejected(self, client: TestClient) -> None:
        habit = client.post("/api/v1/habits", json={"name": "Meditate"}).json()
        goal = make_goal(client, "Ship v2")
        kr = make_key_result(
            client,
            goal["id"],
            "Meditation days",
            source="habit_checkins",
            source_habit_id=habit["id"],
        )["key_results"][0]

        response = client.patch(
            f"/api/v1/goals/{goal['id']}/key-results/{kr['id']}", json={"current_value": 5}
        )

        assert response.status_code == 409

    def test_a_deleted_source_habit_degrades_the_key_result(self, client: TestClient) -> None:
        habit = client.post("/api/v1/habits", json={"name": "Meditate"}).json()
        goal = make_goal(client, "Ship v2", start_date="2026-01-01", end_date="2026-01-31")
        client.put(f"/api/v1/habits/{habit['id']}/check-ins/2026-01-05", json={"value": 1})
        kr = make_key_result(
            client,
            goal["id"],
            "Meditation days",
            source="habit_checkins",
            source_habit_id=habit["id"],
            target_value=10,
        )["key_results"][0]
        assert kr["current_value"] == 1

        response = client.delete(f"/api/v1/habits/{habit['id']}")
        assert response.status_code == 204

        refreshed = client.get(f"/api/v1/goals/{goal['id']}").json()
        assert refreshed["key_results"][0]["current_value"] == 0
        assert refreshed["key_results"][0]["source_habit_id"] is None


class TestTaskSourcedKeyResults:
    def test_completed_attached_tasks_are_counted(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")
        kr = make_key_result(client, goal["id"], "Tasks done", source="task_count", target_value=3)[
            "key_results"
        ][0]
        task_a = client.post("/api/v1/tasks", json={"title": "A", "key_result_id": kr["id"]}).json()
        client.post("/api/v1/tasks", json={"title": "B", "key_result_id": kr["id"]}).json()

        refreshed = client.get(f"/api/v1/goals/{goal['id']}").json()["key_results"][0]
        assert refreshed["current_value"] == 0

        client.patch(f"/api/v1/tasks/{task_a['id']}", json={"completed": True})

        refreshed = client.get(f"/api/v1/goals/{goal['id']}").json()["key_results"][0]
        assert refreshed["current_value"] == 1

    def test_deleting_a_counted_task_reduces_the_count(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")
        kr = make_key_result(client, goal["id"], "Tasks done", source="task_count", target_value=3)[
            "key_results"
        ][0]
        task = client.post("/api/v1/tasks", json={"title": "A", "key_result_id": kr["id"]}).json()
        client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})
        assert (
            client.get(f"/api/v1/goals/{goal['id']}").json()["key_results"][0]["current_value"] == 1
        )

        client.delete(f"/api/v1/tasks/{task['id']}")

        refreshed = client.get(f"/api/v1/goals/{goal['id']}").json()["key_results"][0]
        assert refreshed["current_value"] == 0

    def test_a_task_can_be_detached(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")
        kr = make_key_result(client, goal["id"], "Tasks done", source="task_count", target_value=3)[
            "key_results"
        ][0]
        task = client.post("/api/v1/tasks", json={"title": "A", "key_result_id": kr["id"]}).json()
        client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})

        response = client.patch(f"/api/v1/tasks/{task['id']}", json={"key_result_id": None})

        assert response.status_code == 200
        assert response.json()["key_result_id"] is None
        refreshed = client.get(f"/api/v1/goals/{goal['id']}").json()["key_results"][0]
        assert refreshed["current_value"] == 0


class TestCloseAbandonAndRetro:
    """Issue #234 (ADR 0012): a Goal whose window has passed closes on
    read, freezing its Score. Abandoning is one click and keeps the Goal.
    A retro can be written on a closed Goal, optionally."""

    def test_a_past_window_goal_closes_on_read(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v1")
        make_key_result(
            client, goal["id"], "Lines shipped", start_value=0, target_value=100, current_value=50
        )
        client.patch(f"/api/v1/goals/{goal['id']}", json={"end_date": "2020-03-31"})

        body = client.get(f"/api/v1/goals/{goal['id']}").json()

        assert body["status"] == "closed"
        assert body["final_score"] == 0.5

    def test_an_active_window_goal_does_not_close(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")

        body = client.get(f"/api/v1/goals/{goal['id']}").json()

        assert body["status"] == "active"
        assert body["final_score"] is None

    def test_a_windowless_goal_does_not_close(self, client: TestClient) -> None:
        """The Sprint-Goal-seeded focused Goal (ADR 0012) has no window and
        must never auto-close."""
        goal = client.post("/api/v1/goals", json={"title": "Legacy sprint goal"}).json()
        client.patch(f"/api/v1/goals/{goal['id']}", json={"start_date": None, "end_date": None})

        body = client.get(f"/api/v1/goals/{goal['id']}").json()

        assert body["status"] == "active"

    def test_a_value_backfilled_after_close_does_not_change_the_frozen_score(
        self, client: TestClient
    ) -> None:
        goal = make_goal(client, "Ship v1")
        kr = make_key_result(
            client, goal["id"], "Lines shipped", start_value=0, target_value=100, current_value=50
        )["key_results"][0]
        client.patch(f"/api/v1/goals/{goal['id']}", json={"end_date": "2020-03-31"})
        closed = client.get(f"/api/v1/goals/{goal['id']}").json()
        assert closed["status"] == "closed"
        assert closed["final_score"] == 0.5

        client.patch(
            f"/api/v1/goals/{goal['id']}/key-results/{kr['id']}", json={"current_value": 100}
        )

        reread = client.get(f"/api/v1/goals/{goal['id']}").json()
        assert reread["final_score"] == 0.5

    def test_a_retro_can_be_written_on_a_closed_goal(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v1", start_date="2020-01-01", end_date="2020-03-31")
        client.get(f"/api/v1/goals/{goal['id']}")

        response = client.patch(
            f"/api/v1/goals/{goal['id']}", json={"retro": "Shipped late but shipped."}
        )

        assert response.status_code == 200
        assert response.json()["retro"] == "Shipped late but shipped."

    def test_closing_never_requires_a_retro(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v1", start_date="2020-01-01", end_date="2020-03-31")

        body = client.get(f"/api/v1/goals/{goal['id']}").json()

        assert body["status"] == "closed"
        assert body["retro"] is None

    def test_abandoning_a_goal_is_one_request(self, client: TestClient) -> None:
        goal = make_goal(client, "Give up on this")

        response = client.patch(f"/api/v1/goals/{goal['id']}", json={"status": "abandoned"})

        assert response.status_code == 200
        assert response.json()["status"] == "abandoned"

    def test_an_abandoned_goal_is_kept_not_deleted(self, client: TestClient) -> None:
        goal = make_goal(client, "Give up on this")
        client.patch(f"/api/v1/goals/{goal['id']}", json={"status": "abandoned"})

        response = client.get(f"/api/v1/goals/{goal['id']}")

        assert response.status_code == 200
        assert response.json()["status"] == "abandoned"

    def test_the_list_endpoint_also_closes_past_window_goals(self, client: TestClient) -> None:
        make_goal(client, "Ship v1", start_date="2020-01-01", end_date="2020-03-31")

        body = client.get("/api/v1/goals").json()

        assert body["items"][0]["status"] == "closed"


class TestSettledGoalsStayHonest:
    """A Goal that leaves `active` freezes its Score and drops focus — the
    Stand-up must not keep showing an outcome the user has closed or
    abandoned, and a later Check-in must not rewrite what the Score was."""

    def test_a_closed_goal_reports_its_frozen_score_not_a_live_one(
        self, client: TestClient
    ) -> None:
        goal = make_goal(client, "Ship v1")
        kr = make_key_result(
            client, goal["id"], "Lines shipped", start_value=0, target_value=100, current_value=20
        )["key_results"][0]
        client.patch(f"/api/v1/goals/{goal['id']}", json={"end_date": "2020-03-31"})
        assert client.get(f"/api/v1/goals/{goal['id']}").json()["final_score"] == 0.2

        client.patch(
            f"/api/v1/goals/{goal['id']}/key-results/{kr['id']}", json={"current_value": 90}
        )

        reread = client.get(f"/api/v1/goals/{goal['id']}").json()
        assert reread["final_score"] == 0.2
        assert reread["score"] == 0.2

    def test_abandoning_freezes_the_score(self, client: TestClient) -> None:
        goal = make_goal(client, "Give up")
        make_key_result(
            client, goal["id"], "Lines", start_value=0, target_value=100, current_value=40
        )

        body = client.patch(f"/api/v1/goals/{goal['id']}", json={"status": "abandoned"}).json()

        assert body["final_score"] == 0.4
        assert body["score"] == 0.4

    def test_abandoning_drops_focus(self, client: TestClient) -> None:
        goal = make_goal(client, "Give up")
        client.patch(f"/api/v1/goals/{goal['id']}", json={"is_focused": True})

        body = client.patch(f"/api/v1/goals/{goal['id']}", json={"status": "abandoned"}).json()

        assert body["is_focused"] is False

    def test_a_goal_that_closes_on_read_drops_focus(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v1")
        client.patch(f"/api/v1/goals/{goal['id']}", json={"is_focused": True})
        client.patch(f"/api/v1/goals/{goal['id']}", json={"end_date": "2020-03-31"})

        body = client.get(f"/api/v1/goals/{goal['id']}").json()

        assert body["status"] == "closed"
        assert body["is_focused"] is False


class TestDeletingAKeyResultDetachesItsTasks:
    """SQLite does not enforce ON DELETE SET NULL without PRAGMA
    foreign_keys=ON, and it recycles rowids — so a Task left pointing at a
    deleted Key Result becomes a phantom count on the next one created."""

    def test_deleting_a_key_result_detaches_its_tasks(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")
        kr = make_key_result(client, goal["id"], "Tasks done", source="task_count")["key_results"][
            0
        ]
        task = client.post("/api/v1/tasks", json={"title": "A", "key_result_id": kr["id"]}).json()

        client.delete(f"/api/v1/goals/{goal['id']}/key-results/{kr['id']}")

        assert only_task(client, task["id"])["key_result_id"] is None

    def test_a_new_key_result_does_not_inherit_a_deleted_one_s_tasks(
        self, client: TestClient
    ) -> None:
        goal = make_goal(client, "Ship v2")
        first = make_key_result(client, goal["id"], "Old", source="task_count")["key_results"][0]
        task = client.post(
            "/api/v1/tasks", json={"title": "A", "key_result_id": first["id"]}
        ).json()
        client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})
        client.delete(f"/api/v1/goals/{goal['id']}/key-results/{first['id']}")

        fresh = make_key_result(client, goal["id"], "New", source="task_count")["key_results"][0]

        assert fresh["current_value"] == 0

    def test_deleting_a_goal_detaches_its_key_results_tasks(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")
        kr = make_key_result(client, goal["id"], "Tasks done", source="task_count")["key_results"][
            0
        ]
        task = client.post("/api/v1/tasks", json={"title": "A", "key_result_id": kr["id"]}).json()

        client.delete(f"/api/v1/goals/{goal['id']}")

        assert only_task(client, task["id"])["key_result_id"] is None


class TestGoalInputValidation:
    def test_attaching_a_task_to_an_unknown_key_result_is_404(self, client: TestClient) -> None:
        response = client.post("/api/v1/tasks", json={"title": "A", "key_result_id": 999999})

        assert response.status_code == 404

    def test_patching_a_task_onto_an_unknown_key_result_is_404(self, client: TestClient) -> None:
        task = client.post("/api/v1/tasks", json={"title": "A"}).json()

        response = client.patch(f"/api/v1/tasks/{task['id']}", json={"key_result_id": 999999})

        assert response.status_code == 404

    def test_an_end_date_before_the_start_date_is_rejected(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/goals",
            json={"title": "Backwards", "start_date": "2026-06-30", "end_date": "2026-01-01"},
        )

        assert response.status_code == 422

    def test_a_habit_key_result_requires_a_habit(self, client: TestClient) -> None:
        goal = make_goal(client, "Ship v2")

        response = client.post(
            f"/api/v1/goals/{goal['id']}/key-results",
            json={"name": "Check-ins", "source": "habit_checkins"},
        )

        assert response.status_code == 422


def test_a_single_key_result_is_readable(client: TestClient) -> None:
    goal = make_goal(client, "Ship v2")
    body = make_key_result(
        client, goal["id"], "Lines shipped", start_value=0, target_value=100, current_value=25
    )
    kr = body["key_results"][0]

    response = client.get(f"/api/v1/goals/{goal['id']}/key-results/{kr['id']}")

    assert response.status_code == 200
    assert response.json() == kr


def test_unknown_key_result_is_404(client: TestClient) -> None:
    goal = make_goal(client, "Ship v2")

    for url in (
        f"/api/v1/goals/{goal['id']}/key-results/999",
        "/api/v1/goals/999/key-results/1",
    ):
        response = client.get(url)

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


def test_a_foreign_goals_key_result_is_404(client: TestClient) -> None:
    first = make_goal(client, "First")
    second = make_goal(client, "Second")
    body = make_key_result(
        client, first["id"], "Lines shipped", start_value=0, target_value=100, current_value=25
    )
    kr_id = body["key_results"][0]["id"]

    response = client.get(f"/api/v1/goals/{second['id']}/key-results/{kr_id}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
