"""Now selection (issue #547): one Task the User chose to do next, stored per
User behind its own endpoint, plus the Settings toggle that shows it."""

from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import create_user_row, log_in

NOW = "/api/v1/now"
TOGGLE = "/api/v1/settings/now"


def make_task(client: TestClient, title: str = "Write the report", **fields: Any) -> dict[str, Any]:
    inbox = client.get("/api/v1/lists").json()["items"][0]["id"]
    response = client.post("/api/v1/tasks", json={"title": title, "list_id": inbox, **fields})
    assert response.status_code == 201, response.text
    task: dict[str, Any] = response.json()
    return task


def test_nothing_is_selected_at_first(client: TestClient) -> None:
    assert client.get(NOW).json() == {"task_id": None}


def test_a_selection_persists_and_can_be_replaced_and_removed(client: TestClient) -> None:
    first = make_task(client)
    second = make_task(client, "Call the bank")

    assert client.put(NOW, json={"task_id": first["id"]}).json() == {"task_id": first["id"]}
    assert client.get(NOW).json() == {"task_id": first["id"]}

    client.put(NOW, json={"task_id": second["id"]})
    assert client.get(NOW).json() == {"task_id": second["id"]}

    assert client.put(NOW, json={"task_id": None}).json() == {"task_id": None}
    assert client.get(NOW).json() == {"task_id": None}


def test_selecting_leaves_the_task_untouched(client: TestClient) -> None:
    task = make_task(
        client,
        start_date="2026-11-30T00:00:00Z",
        due_date="2026-12-01T00:00:00Z",
        is_all_day=True,
        priority="high",
    )
    client.put(NOW, json={"task_id": task["id"]})
    client.put(NOW, json={"task_id": None})

    assert client.get(f"/api/v1/tasks/{task['id']}").json() == task


def test_an_unknown_task_is_not_found(client: TestClient) -> None:
    response = client.put(NOW, json={"task_id": 999_999})

    assert response.status_code == 404
    assert client.get(NOW).json() == {"task_id": None}


def test_a_malformed_id_is_rejected(client: TestClient) -> None:
    assert client.put(NOW, json={"task_id": "abc"}).status_code == 422


def test_another_users_task_is_not_found_without_disclosure(client: TestClient) -> None:
    task = make_task(client)
    create_user_row(client, "bea", "bea@example.com")
    client.cookies.clear()
    log_in(client, "bea")

    theirs = client.put(NOW, json={"task_id": task["id"]})
    missing = client.put(NOW, json={"task_id": 999_999})

    assert theirs.status_code == 404
    assert theirs.json() == missing.json()
    assert client.get(NOW).json() == {"task_id": None}


def test_a_selection_write_leaves_other_settings_intact(client: TestClient) -> None:
    client.put(TOGGLE, json={"enabled": True})
    sections = client.get("/api/v1/settings/sections").json()
    active_hours = client.get("/api/v1/settings/active-hours").json()
    task = make_task(client)

    client.put(NOW, json={"task_id": task["id"]})

    assert client.get(TOGGLE).json() == {"enabled": True}
    assert client.get("/api/v1/settings/sections").json() == sections
    assert client.get("/api/v1/settings/active-hours").json() == active_hours


def test_now_is_off_by_default_and_toggling_keeps_the_selection(client: TestClient) -> None:
    assert client.get(TOGGLE).json() == {"enabled": False}
    task = make_task(client)
    client.put(NOW, json={"task_id": task["id"]})

    assert client.put(TOGGLE, json={"enabled": True}).json() == {"enabled": True}
    client.put(TOGGLE, json={"enabled": False})

    assert client.get(TOGGLE).json() == {"enabled": False}
    assert client.get(NOW).json() == {"task_id": task["id"]}


def test_deleting_the_selected_task_clears_the_selection(client: TestClient) -> None:
    task = make_task(client)
    client.put(NOW, json={"task_id": task["id"]})

    client.delete(f"/api/v1/tasks/{task['id']}")

    assert client.get(NOW).json() == {"task_id": None}
