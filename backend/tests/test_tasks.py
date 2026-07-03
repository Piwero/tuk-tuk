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
