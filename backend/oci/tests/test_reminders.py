"""Reminders: ISO-8601 duration offsets stored per task, never delivered."""

from fastapi.testclient import TestClient


def make_dated_task(client: TestClient, title: str = "Dated") -> dict:
    response = client.post(
        "/api/v1/tasks",
        json={"title": title, "due_date": "2026-07-10T15:00:00Z"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_a_new_task_has_no_reminders(client: TestClient) -> None:
    task = client.post("/api/v1/tasks", json={"title": "Plain"}).json()

    assert task["reminders"] == []


def test_reminders_can_be_set_on_creation(client: TestClient) -> None:
    response = client.post(
        "/api/v1/tasks",
        json={
            "title": "Dated",
            "due_date": "2026-07-10T15:00:00Z",
            "reminders": ["PT0S", "-PT30M", "-PT30M"],
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["reminders"] == ["PT0S", "-PT30M"]


def test_reminders_on_creation_require_a_date(client: TestClient) -> None:
    response = client.post("/api/v1/tasks", json={"title": "Dateless", "reminders": ["-PT30M"]})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_reminders"


def test_reminders_persist_and_read_back(client: TestClient) -> None:
    task = make_dated_task(client)

    response = client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"reminders": ["PT0S", "-PT30M", "-P1D"]},
    )

    assert response.status_code == 200
    assert response.json()["reminders"] == ["PT0S", "-PT30M", "-P1D"]

    read_back = client.get("/api/v1/tasks").json()["items"][0]
    assert read_back["reminders"] == ["PT0S", "-PT30M", "-P1D"]


def test_patch_replaces_the_whole_reminder_set_and_empty_clears(client: TestClient) -> None:
    task = make_dated_task(client)
    client.patch(f"/api/v1/tasks/{task['id']}", json={"reminders": ["PT0S", "-PT30M"]})

    replaced = client.patch(f"/api/v1/tasks/{task['id']}", json={"reminders": ["-PT1H"]})
    assert replaced.json()["reminders"] == ["-PT1H"]

    cleared = client.patch(f"/api/v1/tasks/{task['id']}", json={"reminders": []})
    assert cleared.json()["reminders"] == []


def test_duplicate_offsets_are_stored_once(client: TestClient) -> None:
    task = make_dated_task(client)

    response = client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"reminders": ["-PT30M", "PT0S", "-PT30M"]},
    )

    assert response.json()["reminders"] == ["-PT30M", "PT0S"]


def test_malformed_durations_are_rejected(client: TestClient) -> None:
    task = make_dated_task(client)

    for bad in ["30m", "P", "PT", "-P", "PT30", "p1d", ""]:
        response = client.patch(f"/api/v1/tasks/{task['id']}", json={"reminders": [bad]})
        assert response.status_code == 422, bad
        assert response.json()["error"]["code"] == "invalid_reminders"


def test_a_task_without_a_date_cannot_hold_reminders(client: TestClient) -> None:
    task = client.post("/api/v1/tasks", json={"title": "Dateless"}).json()

    response = client.patch(f"/api/v1/tasks/{task['id']}", json={"reminders": ["PT0S"]})

    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "invalid_reminders"
    assert "date" in body["message"]


def test_reminders_and_a_date_can_arrive_in_the_same_patch(client: TestClient) -> None:
    task = client.post("/api/v1/tasks", json={"title": "Dateless"}).json()

    response = client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"due_date": "2026-07-10T15:00:00Z", "reminders": ["-PT30M"]},
    )

    assert response.status_code == 200
    assert response.json()["reminders"] == ["-PT30M"]


def test_clearing_the_date_clears_the_reminders(client: TestClient) -> None:
    task = make_dated_task(client)
    client.patch(f"/api/v1/tasks/{task['id']}", json={"reminders": ["-PT30M"]})

    response = client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"start_date": None, "due_date": None, "is_all_day": False, "time_zone": None},
    )

    assert response.status_code == 200
    assert response.json()["due_date"] is None
    assert response.json()["reminders"] == []


def test_clearing_the_date_while_setting_reminders_is_rejected(client: TestClient) -> None:
    task = make_dated_task(client)

    response = client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"due_date": None, "reminders": ["-PT30M"]},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_reminders"


def test_reminders_may_not_be_null(client: TestClient) -> None:
    task = make_dated_task(client)

    response = client.patch(f"/api/v1/tasks/{task['id']}", json={"reminders": None})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
