from fastapi.testclient import TestClient


def inbox_id(client: TestClient) -> int:
    lists = client.get("/api/v1/lists").json()["items"]
    return next(item["id"] for item in lists if item["is_inbox"])


def test_task_created_without_a_list_lands_in_the_inbox(client: TestClient) -> None:
    response = client.post("/api/v1/tasks", json={"title": "Buy milk"})

    assert response.status_code == 201
    task = response.json()
    assert task["title"] == "Buy milk"
    assert task["completed"] is False
    assert task["list_id"] == inbox_id(client)

    listed = client.get("/api/v1/tasks", params={"list_id": inbox_id(client)}).json()
    assert [t["title"] for t in listed["items"]] == ["Buy milk"]


def test_task_can_be_completed_and_uncompleted(client: TestClient) -> None:
    task_id = client.post("/api/v1/tasks", json={"title": "Water plants"}).json()["id"]

    completed = client.patch(f"/api/v1/tasks/{task_id}", json={"completed": True})
    assert completed.status_code == 200
    assert completed.json()["completed"] is True

    reopened = client.patch(f"/api/v1/tasks/{task_id}", json={"completed": False})
    assert reopened.status_code == 200
    assert reopened.json()["completed"] is False


def test_task_can_be_deleted(client: TestClient) -> None:
    task_id = client.post("/api/v1/tasks", json={"title": "Old chore"}).json()["id"]

    response = client.delete(f"/api/v1/tasks/{task_id}")

    assert response.status_code == 204
    remaining = client.get("/api/v1/tasks").json()["items"]
    assert all(task["id"] != task_id for task in remaining)


def test_created_at_is_utc_and_stable_across_create_and_read(client: TestClient) -> None:
    created = client.post("/api/v1/tasks", json={"title": "Timed"}).json()

    read_back = client.get("/api/v1/tasks").json()["items"][0]

    assert created["created_at"].endswith("Z")
    assert read_back["created_at"] == created["created_at"]


def test_task_collection_paginates(client: TestClient) -> None:
    for title in ["One", "Two", "Three"]:
        client.post("/api/v1/tasks", json={"title": title})

    first_page = client.get("/api/v1/tasks", params={"limit": 2, "offset": 0}).json()
    assert first_page["total"] == 3
    assert first_page["limit"] == 2
    assert first_page["offset"] == 0
    assert [t["title"] for t in first_page["items"]] == ["One", "Two"]

    second_page = client.get("/api/v1/tasks", params={"limit": 2, "offset": 2}).json()
    assert [t["title"] for t in second_page["items"]] == ["Three"]


def test_task_moved_to_another_list_leaves_its_old_list(client: TestClient) -> None:
    errands = client.post("/api/v1/lists", json={"name": "Errands"}).json()
    task = client.post("/api/v1/tasks", json={"title": "Buy stamps"}).json()

    moved = client.patch(f"/api/v1/tasks/{task['id']}", json={"list_id": errands["id"]})

    assert moved.status_code == 200
    assert moved.json()["list_id"] == errands["id"]
    in_errands = client.get("/api/v1/tasks", params={"list_id": errands["id"]}).json()["items"]
    assert [t["title"] for t in in_errands] == ["Buy stamps"]
    in_inbox = client.get("/api/v1/tasks", params={"list_id": inbox_id(client)}).json()["items"]
    assert all(t["id"] != task["id"] for t in in_inbox)


def test_new_task_has_empty_description_no_priority_and_no_check_items(
    client: TestClient,
) -> None:
    created = client.post("/api/v1/tasks", json={"title": "Plain"}).json()

    assert created["description"] == ""
    assert created["priority"] == "none"
    assert created["check_items"] == []

    read_back = client.get("/api/v1/tasks").json()["items"][0]
    assert read_back["description"] == ""
    assert read_back["priority"] == "none"
    assert read_back["check_items"] == []


def test_task_can_be_created_with_a_description(client: TestClient) -> None:
    """A Task converted from an Event (issue #111) is created with its full
    description in one step — never a create-then-patch race."""
    created = client.post(
        "/api/v1/tasks", json={"title": "Standup", "description": "Daily sync\n\nRoom 4B"}
    ).json()

    assert created["description"] == "Daily sync\n\nRoom 4B"


def test_an_ordinary_task_has_no_event_provenance(client: TestClient) -> None:
    """A Task not converted from an Event (issue #111) carries no provenance."""
    created = client.post("/api/v1/tasks", json={"title": "Plain"}).json()

    assert created["source_google_calendar_id"] is None
    assert created["source_google_event_id"] is None


def test_task_description_and_priority_can_be_edited(client: TestClient) -> None:
    task_id = client.post("/api/v1/tasks", json={"title": "Write report"}).json()["id"]

    response = client.patch(
        f"/api/v1/tasks/{task_id}",
        json={"description": "## Outline\n\n- intro\n- body", "priority": "high"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["description"] == "## Outline\n\n- intro\n- body"
    assert body["priority"] == "high"


def test_task_priority_must_be_a_named_level(client: TestClient) -> None:
    task_id = client.post("/api/v1/tasks", json={"title": "Precise"}).json()["id"]

    response = client.patch(f"/api/v1/tasks/{task_id}", json={"priority": "urgent"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_task_can_be_created_with_priority_and_tags(client: TestClient) -> None:
    finance = client.post("/api/v1/tags", json={"name": "finance"}).json()
    urgent = client.post("/api/v1/tags", json={"name": "urgent"}).json()

    response = client.post(
        "/api/v1/tasks",
        json={"title": "Pay rent", "priority": "high", "tag_ids": [urgent["id"], finance["id"]]},
    )

    assert response.status_code == 201, response.text
    created = response.json()
    assert created["priority"] == "high"
    assert [tag["name"] for tag in created["tags"]] == ["finance", "urgent"]

    read_back = client.get("/api/v1/tasks").json()["items"][0]
    assert read_back["priority"] == "high"
    assert [tag["name"] for tag in read_back["tags"]] == ["finance", "urgent"]


def test_task_creation_with_an_unknown_tag_is_rejected(client: TestClient) -> None:
    response = client.post("/api/v1/tasks", json={"title": "Ghost", "tag_ids": [999]})

    assert response.status_code == 404


def test_completed_tasks_can_be_bulk_deleted(client: TestClient) -> None:
    open_id = client.post("/api/v1/tasks", json={"title": "Open"}).json()["id"]
    done_id = client.post("/api/v1/tasks", json={"title": "Done"}).json()["id"]
    client.patch(f"/api/v1/tasks/{done_id}", json={"completed": True})

    response = client.delete("/api/v1/tasks", params={"completed": "true"})

    assert response.status_code == 204
    remaining = client.get("/api/v1/tasks").json()["items"]
    assert [t["id"] for t in remaining] == [open_id]


def test_bulk_delete_completed_scopes_to_one_list(client: TestClient) -> None:
    errands = client.post("/api/v1/lists", json={"name": "Errands"}).json()
    inbox_done = client.post("/api/v1/tasks", json={"title": "Inbox done"}).json()["id"]
    errands_done = client.post(
        "/api/v1/tasks", json={"title": "Errands done", "list_id": errands["id"]}
    ).json()["id"]
    client.patch(f"/api/v1/tasks/{inbox_done}", json={"completed": True})
    client.patch(f"/api/v1/tasks/{errands_done}", json={"completed": True})

    response = client.delete(
        "/api/v1/tasks", params={"completed": "true", "list_id": errands["id"]}
    )

    assert response.status_code == 204
    remaining_ids = {
        t["id"] for t in client.get("/api/v1/tasks", params={"completed": True}).json()["items"]
    }
    assert remaining_ids == {inbox_done}


def test_bulk_delete_requires_the_completed_filter(client: TestClient) -> None:
    """Only completed Tasks are eligible: an unscoped bulk delete would wipe
    open Tasks by accident, so the endpoint refuses without `completed=true`."""
    response = client.delete("/api/v1/tasks")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"

    response = client.delete("/api/v1/tasks", params={"completed": "false"})

    assert response.status_code == 422


def test_a_single_task_is_readable_with_check_items_and_tags(client: TestClient) -> None:
    tag = client.post("/api/v1/tags", json={"name": "errand"}).json()
    created = client.post(
        "/api/v1/tasks", json={"title": "Pack bag", "tag_ids": [tag["id"]]}
    ).json()
    client.post(f"/api/v1/tasks/{created['id']}/check-items", json={"title": "Socks"})

    response = client.get(f"/api/v1/tasks/{created['id']}")

    assert response.status_code == 200
    body = response.json()
    assert body == client.get("/api/v1/tasks").json()["items"][0]
    assert body["title"] == "Pack bag"
    assert [item["title"] for item in body["check_items"]] == ["Socks"]
    assert [t["name"] for t in body["tags"]] == ["errand"]


def test_unknown_task_is_404(client: TestClient) -> None:
    response = client.get("/api/v1/tasks/999")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
