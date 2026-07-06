"""Smart Lists (computed task queries) and the completed view."""

from fastapi.testclient import TestClient

from tests.conftest import make_task


def titles(response_json: dict) -> list[str]:
    return [task["title"] for task in response_json["items"]]


def complete(client: TestClient, task_id: int) -> dict:
    response = client.patch(f"/api/v1/tasks/{task_id}", json={"completed": True})
    assert response.status_code == 200, response.text
    return response.json()


def test_all_view_shows_every_open_task_across_lists(client: TestClient) -> None:
    errands = client.post("/api/v1/lists", json={"name": "Errands"}).json()
    make_task(client, "In inbox")
    make_task(client, "In errands", list_id=errands["id"])
    done = make_task(client, "Already done")
    complete(client, done["id"])

    response = client.get("/api/v1/tasks", params={"view": "all"})

    assert response.status_code == 200
    assert sorted(titles(response.json())) == ["In errands", "In inbox"]


def test_today_view_shows_tasks_dated_today_plus_overdue_open_tasks(
    client: TestClient,
) -> None:
    make_task(client, "Due today", due_date="2026-07-03T00:00:00Z", is_all_day=True)
    make_task(client, "Timed today", due_date="2026-07-03T15:00:00Z")
    make_task(client, "Overdue", due_date="2026-07-01T00:00:00Z", is_all_day=True)
    make_task(
        client,
        "Span covering today",
        start_date="2026-07-02T00:00:00Z",
        due_date="2026-07-05T00:00:00Z",
        is_all_day=True,
    )
    make_task(client, "Tomorrow", due_date="2026-07-04T00:00:00Z", is_all_day=True)
    make_task(client, "Undated")
    overdue_done = make_task(
        client, "Overdue but done", due_date="2026-07-01T00:00:00Z", is_all_day=True
    )
    complete(client, overdue_done["id"])

    response = client.get("/api/v1/tasks", params={"view": "today", "today": "2026-07-03"})

    assert response.status_code == 200
    assert sorted(titles(response.json())) == [
        "Due today",
        "Overdue",
        "Span covering today",
        "Timed today",
    ]


def test_today_view_judges_timed_tasks_in_their_own_timezone(client: TestClient) -> None:
    # 23:00Z on Jul 3 is already Jul 4 in Tokyo (UTC+9).
    make_task(
        client,
        "Tokyo evening",
        due_date="2026-07-03T23:00:00Z",
        time_zone="Asia/Tokyo",
    )

    on_jul_3 = client.get("/api/v1/tasks", params={"view": "today", "today": "2026-07-03"})
    on_jul_4 = client.get("/api/v1/tasks", params={"view": "today", "today": "2026-07-04"})

    assert titles(on_jul_3.json()) == []
    assert titles(on_jul_4.json()) == ["Tokyo evening"]


def test_next7_view_shows_today_through_day_seven(client: TestClient) -> None:
    make_task(client, "Today", due_date="2026-07-03T00:00:00Z", is_all_day=True)
    make_task(client, "Day seven", due_date="2026-07-09T00:00:00Z", is_all_day=True)
    make_task(client, "Day eight", due_date="2026-07-10T00:00:00Z", is_all_day=True)
    make_task(client, "Overdue", due_date="2026-07-01T00:00:00Z", is_all_day=True)
    make_task(
        client,
        "Span into the window",
        start_date="2026-07-01T00:00:00Z",
        due_date="2026-07-04T00:00:00Z",
        is_all_day=True,
    )
    make_task(client, "Undated")

    response = client.get("/api/v1/tasks", params={"view": "next7", "today": "2026-07-03"})

    assert response.status_code == 200
    assert sorted(titles(response.json())) == ["Day seven", "Span into the window", "Today"]


def test_today_and_next7_require_the_today_parameter(client: TestClient) -> None:
    for view in ["today", "next7"]:
        response = client.get("/api/v1/tasks", params={"view": view})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"


def test_completed_view_lists_completed_tasks_newest_first(client: TestClient) -> None:
    first = make_task(client, "First done")
    second = make_task(client, "Second done")
    make_task(client, "Still open")
    complete(client, first["id"])
    complete(client, second["id"])

    response = client.get("/api/v1/tasks", params={"completed": "true"})

    assert response.status_code == 200
    assert titles(response.json()) == ["Second done", "First done"]


def test_reopening_and_recompleting_moves_a_task_to_the_top(client: TestClient) -> None:
    first = make_task(client, "First")
    second = make_task(client, "Second")
    complete(client, first["id"])
    complete(client, second["id"])

    client.patch(f"/api/v1/tasks/{first['id']}", json={"completed": False})
    complete(client, first["id"])

    response = client.get("/api/v1/tasks", params={"completed": "true"})
    assert titles(response.json()) == ["First", "Second"]


def test_completed_filter_false_returns_only_open_tasks(client: TestClient) -> None:
    open_task = make_task(client, "Open")
    done = make_task(client, "Done")
    complete(client, done["id"])

    response = client.get("/api/v1/tasks", params={"completed": "false"})

    assert titles(response.json()) == ["Open"]
    assert response.json()["items"][0]["id"] == open_task["id"]


def test_completed_at_is_stamped_on_completion_and_cleared_on_reopen(
    client: TestClient,
) -> None:
    task = make_task(client, "Stamped")
    assert task["completed_at"] is None

    completed = complete(client, task["id"])
    assert completed["completed_at"] is not None
    assert completed["completed_at"].endswith("Z")

    reopened = client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": False}).json()
    assert reopened["completed_at"] is None


def test_completing_the_last_check_item_stamps_completed_at(client: TestClient) -> None:
    task = make_task(client, "Checklist")
    item = client.post(f"/api/v1/tasks/{task['id']}/check-items", json={"title": "Only step"})
    item_id = item.json()["check_items"][0]["id"]

    response = client.patch(
        f"/api/v1/tasks/{task['id']}/check-items/{item_id}", json={"done": True}
    )

    body = response.json()
    assert body["completed"] is True
    assert body["completed_at"] is not None


def test_completed_view_scoped_to_a_list(client: TestClient) -> None:
    errands = client.post("/api/v1/lists", json={"name": "Errands"}).json()
    inbox_done = make_task(client, "Inbox done")
    errands_done = make_task(client, "Errands done", list_id=errands["id"])
    complete(client, inbox_done["id"])
    complete(client, errands_done["id"])

    response = client.get("/api/v1/tasks", params={"completed": "true", "list_id": errands["id"]})

    assert titles(response.json()) == ["Errands done"]
