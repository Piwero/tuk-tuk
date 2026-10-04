"""Timers: saved Focus Session presets (issue #35).

A Timer is a preset — name + mode + duration, optionally pre-linked to a
Task or Habit — so recurring scenarios like "Reading 30m" start in one tap.
The tap itself is client-side: the API stores presets, never running state.
"""

from fastapi.testclient import TestClient

from tests.conftest import make_task
from tests.test_habits import make_habit


def make_timer(client: TestClient, name: str, **fields: object) -> dict:
    payload = {"name": name, "mode": "pomo", "duration_seconds": 1800, **fields}
    response = client.post("/api/v1/timers", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


class TestCreateTimer:
    def test_persists_a_pomo_preset(self, client: TestClient) -> None:
        body = make_timer(client, "Reading 30m")

        assert body["name"] == "Reading 30m"
        assert body["mode"] == "pomo"
        assert body["duration_seconds"] == 1800
        assert body["task_id"] is None
        assert body["habit_id"] is None
        assert isinstance(body["id"], int)

    def test_a_stopwatch_preset_has_no_duration(self, client: TestClient) -> None:
        response = client.post("/api/v1/timers", json={"name": "Deep work", "mode": "stopwatch"})

        assert response.status_code == 201
        assert response.json()["duration_seconds"] is None

    def test_a_pomo_preset_requires_a_duration(self, client: TestClient) -> None:
        response = client.post("/api/v1/timers", json={"name": "Reading", "mode": "pomo"})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_timer"

    def test_a_stopwatch_preset_rejects_a_duration(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/timers",
            json={"name": "Deep work", "mode": "stopwatch", "duration_seconds": 600},
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_timer"

    def test_presets_can_carry_a_link(self, client: TestClient) -> None:
        habit = make_habit(client, "Reading")

        body = make_timer(client, "Reading 30m", habit_id=habit["id"])

        assert body["habit_id"] == habit["id"]

    def test_rejects_linking_both_sides_and_unknown_rows(self, client: TestClient) -> None:
        task = make_task(client, "Write report")
        habit = make_habit(client, "Reading")

        both = client.post(
            "/api/v1/timers",
            json={
                "name": "Nope",
                "mode": "pomo",
                "duration_seconds": 1500,
                "task_id": task["id"],
                "habit_id": habit["id"],
            },
        )
        assert both.status_code == 422
        assert both.json()["error"]["code"] == "invalid_timer"

        for fields in ({"task_id": 999}, {"habit_id": 999}):
            response = client.post(
                "/api/v1/timers",
                json={"name": "Nope", "mode": "pomo", "duration_seconds": 1500, **fields},
            )
            assert response.status_code == 404, fields


class TestListEditDeleteTimer:
    def test_lists_presets_in_creation_order(self, client: TestClient) -> None:
        make_timer(client, "Reading 30m")
        make_timer(client, "Writing 50m", duration_seconds=3000)

        page = client.get("/api/v1/timers").json()

        assert [item["name"] for item in page["items"]] == ["Reading 30m", "Writing 50m"]

    def test_edits_a_preset(self, client: TestClient) -> None:
        task = make_task(client, "Write report")
        timer = make_timer(client, "Reading 30m")

        response = client.patch(
            f"/api/v1/timers/{timer['id']}",
            json={"name": "Reading 45m", "duration_seconds": 2700, "task_id": task["id"]},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Reading 45m"
        assert body["duration_seconds"] == 2700
        assert body["task_id"] == task["id"]

    def test_the_edited_preset_is_validated_as_a_whole(self, client: TestClient) -> None:
        timer = make_timer(client, "Reading 30m")

        response = client.patch(f"/api/v1/timers/{timer['id']}", json={"mode": "stopwatch"})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_timer"

    def test_becoming_a_stopwatch_preset_drops_the_duration(self, client: TestClient) -> None:
        timer = make_timer(client, "Deep work 30m")

        response = client.patch(
            f"/api/v1/timers/{timer['id']}",
            json={"mode": "stopwatch", "duration_seconds": None},
        )

        assert response.status_code == 200
        assert response.json()["duration_seconds"] is None

    def test_null_unlinks_a_preset(self, client: TestClient) -> None:
        habit = make_habit(client, "Reading")
        timer = make_timer(client, "Reading 30m", habit_id=habit["id"])

        body = client.patch(f"/api/v1/timers/{timer['id']}", json={"habit_id": None}).json()

        assert body["habit_id"] is None

    def test_delete_removes_the_preset(self, client: TestClient) -> None:
        timer = make_timer(client, "Reading 30m")

        assert client.delete(f"/api/v1/timers/{timer['id']}").status_code == 204
        assert client.get("/api/v1/timers").json()["total"] == 0

    def test_unknown_timer_is_404(self, client: TestClient) -> None:
        assert client.patch("/api/v1/timers/999", json={}).status_code == 404
        assert client.delete("/api/v1/timers/999").status_code == 404

    def test_deleting_a_linked_row_unlinks_the_preset(self, client: TestClient) -> None:
        task = make_task(client, "Write report")
        habit = make_habit(client, "Reading")
        with_task = make_timer(client, "Report 25m", task_id=task["id"])
        with_habit = make_timer(client, "Reading 30m", habit_id=habit["id"])

        assert client.delete(f"/api/v1/tasks/{task['id']}").status_code == 204
        assert client.delete(f"/api/v1/habits/{habit['id']}").status_code == 204

        page = client.get("/api/v1/timers").json()
        assert page["total"] == 2
        by_id = {item["id"]: item for item in page["items"]}
        assert by_id[with_task["id"]]["task_id"] is None
        assert by_id[with_habit["id"]]["habit_id"] is None


def test_a_single_timer_is_readable(client: TestClient) -> None:
    created = make_timer(client, "Reading 30m")

    response = client.get(f"/api/v1/timers/{created['id']}")

    assert response.status_code == 200
    assert response.json() == created


def test_unknown_timer_is_404(client: TestClient) -> None:
    response = client.get("/api/v1/timers/999")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
