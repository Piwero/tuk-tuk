"""Every failure comes back in the uniform error envelope."""

from fastapi.testclient import TestClient


def test_missing_task_returns_not_found_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/tasks")  # warm-up: routes exist
    assert response.status_code == 200

    response = client.delete("/api/v1/tasks/9999")

    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert "9999" in error["message"]


def test_validation_failure_returns_validation_envelope(client: TestClient) -> None:
    response = client.post("/api/v1/tasks", json={"title": ""})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"]


def test_creating_a_task_in_an_unknown_list_returns_not_found_envelope(
    client: TestClient,
) -> None:
    response = client.post("/api/v1/tasks", json={"title": "Lost", "list_id": 424242})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_explicit_null_fields_on_update_are_rejected_not_500(client: TestClient) -> None:
    task_id = client.post("/api/v1/tasks", json={"title": "Real title"}).json()["id"]

    response = client.patch(f"/api/v1/tasks/{task_id}", json={"title": None})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_the_inbox_cannot_be_deleted(client: TestClient) -> None:
    lists = client.get("/api/v1/lists").json()["items"]
    inbox = next(item for item in lists if item["is_inbox"])

    response = client.delete(f"/api/v1/lists/{inbox['id']}")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "inbox_undeletable"
    still_there = client.get("/api/v1/lists").json()["items"]
    assert any(item["is_inbox"] for item in still_there)


def test_the_inbox_cannot_be_renamed_archived_or_foldered(client: TestClient) -> None:
    folder_id = client.post("/api/v1/folders", json={"name": "Work"}).json()["id"]
    inbox = next(item for item in client.get("/api/v1/lists").json()["items"] if item["is_inbox"])

    payloads = ({"name": "Not the Inbox"}, {"is_archived": True}, {"folder_id": folder_id})
    for payload in payloads:
        response = client.patch(f"/api/v1/lists/{inbox['id']}", json=payload)

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "inbox_immutable"

    untouched = next(
        item for item in client.get("/api/v1/lists").json()["items"] if item["is_inbox"]
    )
    assert untouched["name"] == "Inbox"
    assert untouched["is_archived"] is False
    assert untouched["folder_id"] is None


def test_moving_a_task_to_an_unknown_list_returns_not_found_envelope(
    client: TestClient,
) -> None:
    task_id = client.post("/api/v1/tasks", json={"title": "Stranded"}).json()["id"]

    response = client.patch(f"/api/v1/tasks/{task_id}", json={"list_id": 424242})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_moving_a_list_into_an_unknown_folder_returns_not_found_envelope(
    client: TestClient,
) -> None:
    task_list = client.post("/api/v1/lists", json={"name": "Backend"}).json()

    response = client.patch(f"/api/v1/lists/{task_list['id']}", json={"folder_id": 424242})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_check_item_lookups_are_scoped_to_their_task(client: TestClient) -> None:
    task_a = client.post("/api/v1/tasks", json={"title": "A"}).json()["id"]
    task_b = client.post("/api/v1/tasks", json={"title": "B"}).json()["id"]
    item_id = client.post(f"/api/v1/tasks/{task_a}/check-items", json={"title": "Step"}).json()[
        "check_items"
    ][0]["id"]

    wrong_parent = client.patch(
        f"/api/v1/tasks/{task_b}/check-items/{item_id}", json={"done": True}
    )
    assert wrong_parent.status_code == 404
    assert wrong_parent.json()["error"]["code"] == "not_found"

    unknown = client.delete(f"/api/v1/tasks/{task_a}/check-items/424242")
    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "not_found"


def test_check_item_title_may_not_be_null(client: TestClient) -> None:
    task_id = client.post("/api/v1/tasks", json={"title": "A"}).json()["id"]
    item_id = client.post(f"/api/v1/tasks/{task_id}/check-items", json={"title": "Step"}).json()[
        "check_items"
    ][0]["id"]

    response = client.patch(f"/api/v1/tasks/{task_id}/check-items/{item_id}", json={"title": None})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_duplicate_tag_names_are_rejected(client: TestClient) -> None:
    client.post("/api/v1/tags", json={"name": "work"})

    duplicate = client.post("/api/v1/tags", json={"name": "work"})

    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "tag_exists"

    other = client.post("/api/v1/tags", json={"name": "home"}).json()
    renamed_to_taken = client.patch(f"/api/v1/tags/{other['id']}", json={"name": "work"})

    assert renamed_to_taken.status_code == 409
    assert renamed_to_taken.json()["error"]["code"] == "tag_exists"


def test_assigning_an_unknown_tag_returns_not_found_envelope(client: TestClient) -> None:
    task_id = client.post("/api/v1/tasks", json={"title": "Mistagged"}).json()["id"]

    response = client.patch(f"/api/v1/tasks/{task_id}", json={"tag_ids": [424242]})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_task_cannot_join_a_section_of_another_list(client: TestClient) -> None:
    project = client.post("/api/v1/lists", json={"name": "Project"}).json()["id"]
    section = client.post("/api/v1/sections", json={"list_id": project, "name": "Doing"}).json()
    inbox_task = client.post("/api/v1/tasks", json={"title": "Homeless"}).json()

    response = client.patch(f"/api/v1/tasks/{inbox_task['id']}", json={"section_id": section["id"]})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "section_list_mismatch"

    unknown = client.patch(f"/api/v1/tasks/{inbox_task['id']}", json={"section_id": 424242})
    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "not_found"
