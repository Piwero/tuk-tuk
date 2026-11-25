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


# Issue #549: a selection that is completed or advanced reads as none.


def test_completing_the_selected_task_clears_the_selection(client: TestClient) -> None:
    task = make_task(client)
    client.put(NOW, json={"task_id": task["id"]})

    client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})

    assert client.get(NOW).json() == {"task_id": None}


def test_completing_a_recurring_selection_clears_it_though_the_row_stays_open(
    client: TestClient,
) -> None:
    task = make_task(client, due_date="2026-07-10T15:00:00Z", recurrence="FREQ=DAILY")
    client.put(NOW, json={"task_id": task["id"]})

    advanced = client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True}).json()

    assert advanced["completed"] is False
    assert advanced["due_date"].startswith("2026-07-11")
    assert client.get("/api/v1/completed-occurrences").json()["total"] == 1
    assert client.get(NOW).json() == {"task_id": None}


def test_the_next_occurrence_can_be_chosen_again(client: TestClient) -> None:
    task = make_task(client, due_date="2026-07-10T15:00:00Z", recurrence="FREQ=DAILY")
    client.put(NOW, json={"task_id": task["id"]})
    client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})

    client.put(NOW, json={"task_id": task["id"]})

    assert client.get(NOW).json() == {"task_id": task["id"]}


def test_editing_an_unrelated_field_keeps_the_selection(client: TestClient) -> None:
    task = make_task(client, due_date="2026-07-10T15:00:00Z", recurrence="FREQ=DAILY")
    client.put(NOW, json={"task_id": task["id"]})

    client.patch(f"/api/v1/tasks/{task['id']}", json={"title": "Renamed"})

    assert client.get(NOW).json() == {"task_id": task["id"]}


# Issue #554: an optional resume note belongs to the current selection.

NOTE = "/api/v1/now/note"


def choose(client: TestClient, **fields: Any) -> dict[str, Any]:
    task = make_task(client, **fields)
    client.put(NOW, json={"task_id": task["id"]})
    return task


def test_there_is_no_resume_note_at_first(client: TestClient) -> None:
    choose(client)
    assert client.get(NOTE).json() == {"note": None}


def test_a_resume_note_can_be_saved_edited_and_discarded(client: TestClient) -> None:
    choose(client)

    assert client.put(NOTE, json={"note": "Reply to Ana's 2nd para"}).json() == {
        "note": "Reply to Ana's 2nd para"
    }
    client.put(NOTE, json={"note": "Send it"})
    assert client.get(NOTE).json() == {"note": "Send it"}

    assert client.put(NOTE, json={"note": None}).json() == {"note": None}
    assert client.get(NOTE).json() == {"note": None}


def test_a_note_needs_a_selection(client: TestClient) -> None:
    assert client.put(NOTE, json={"note": "Pick up here"}).status_code == 409
    assert client.put(NOTE, json={"note": None}).json() == {"note": None}


def test_choosing_another_task_or_removing_it_clears_the_note(client: TestClient) -> None:
    choose(client)
    client.put(NOTE, json={"note": "Pick up here"})
    choose(client, title="Call the bank")
    assert client.get(NOTE).json() == {"note": None}

    client.put(NOTE, json={"note": "Ask about fees"})
    client.put(NOW, json={"task_id": None})
    assert client.get(NOTE).json() == {"note": None}


def test_rechoosing_the_same_task_keeps_the_note(client: TestClient) -> None:
    task = choose(client)
    client.put(NOTE, json={"note": "Pick up here"})
    client.put(NOW, json={"task_id": task["id"]})
    assert client.get(NOTE).json() == {"note": "Pick up here"}


def test_deleting_completing_or_advancing_the_selection_clears_the_note(
    client: TestClient,
) -> None:
    deleted = choose(client)
    client.put(NOTE, json={"note": "a"})
    client.delete(f"/api/v1/tasks/{deleted['id']}")
    assert client.get(NOTE).json() == {"note": None}

    done = choose(client)
    client.put(NOTE, json={"note": "b"})
    client.patch(f"/api/v1/tasks/{done['id']}", json={"completed": True})
    assert client.get(NOTE).json() == {"note": None}

    recurring = choose(client, due_date="2026-07-10T15:00:00Z", recurrence="FREQ=DAILY")
    client.put(NOTE, json={"note": "c"})
    client.patch(f"/api/v1/tasks/{recurring['id']}", json={"completed": True})
    client.put(NOW, json={"task_id": recurring["id"]})
    assert client.get(NOTE).json() == {"note": None}


def test_other_users_never_see_the_note(client: TestClient) -> None:
    choose(client)
    client.put(NOTE, json={"note": "Mine only"})
    create_user_row(client, "bea", "bea@example.com")
    client.cookies.clear()
    log_in(client, "bea")

    assert client.get(NOTE).json() == {"note": None}
    assert client.put(NOTE, json={"note": "x"}).status_code == 409


def test_a_note_write_leaves_the_selection_and_other_settings_intact(
    client: TestClient,
) -> None:
    client.put(TOGGLE, json={"enabled": True})
    task = choose(client)
    sections = client.get("/api/v1/settings/sections").json()
    active_hours = client.get("/api/v1/settings/active-hours").json()

    client.put(NOTE, json={"note": "Pick up here"})

    assert client.get(NOW).json() == {"task_id": task["id"]}
    assert client.get(TOGGLE).json() == {"enabled": True}
    assert client.get("/api/v1/settings/sections").json() == sections
    assert client.get("/api/v1/settings/active-hours").json() == active_hours
    assert client.get(f"/api/v1/tasks/{task['id']}").json() == task
