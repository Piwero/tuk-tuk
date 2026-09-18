"""Goals: create, list, edit and delete (issue #232, ADR 0012).

No Key Results yet — this slice is the OKR spine plus WOOP framing
(obstacle/if_then_plan), both nullable so a Goal is creatable in seconds.
"""

from fastapi.testclient import TestClient


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
