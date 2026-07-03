from fastapi.testclient import TestClient


def make_task(client: TestClient, title: str = "Pack bags") -> int:
    task_id: int = client.post("/api/v1/tasks", json={"title": title}).json()["id"]
    return task_id


def test_added_check_items_appear_on_the_task_in_order(client: TestClient) -> None:
    task_id = make_task(client)

    first = client.post(f"/api/v1/tasks/{task_id}/check-items", json={"title": "Socks"})
    second = client.post(f"/api/v1/tasks/{task_id}/check-items", json={"title": "Charger"})

    assert first.status_code == 201
    body = second.json()
    assert body["id"] == task_id  # the response is the full parent Task
    assert [item["title"] for item in body["check_items"]] == ["Socks", "Charger"]
    assert all(item["done"] is False for item in body["check_items"])


def test_check_item_can_be_renamed_and_ticked(client: TestClient) -> None:
    task_id = make_task(client)
    client.post(f"/api/v1/tasks/{task_id}/check-items", json={"title": "Sockz"})
    created = client.post(f"/api/v1/tasks/{task_id}/check-items", json={"title": "Charger"})
    first_id = created.json()["check_items"][0]["id"]

    renamed = client.patch(
        f"/api/v1/tasks/{task_id}/check-items/{first_id}", json={"title": "Socks"}
    )

    assert renamed.status_code == 200
    assert renamed.json()["check_items"][0]["title"] == "Socks"

    ticked = client.patch(f"/api/v1/tasks/{task_id}/check-items/{first_id}", json={"done": True})

    assert ticked.json()["check_items"][0]["done"] is True
    assert ticked.json()["completed"] is False  # a sibling is still open


def test_ticking_the_last_open_check_item_completes_the_task(client: TestClient) -> None:
    task_id = make_task(client)
    client.post(f"/api/v1/tasks/{task_id}/check-items", json={"title": "Socks"})
    body = client.post(f"/api/v1/tasks/{task_id}/check-items", json={"title": "Charger"}).json()
    first_id, second_id = (item["id"] for item in body["check_items"])

    client.patch(f"/api/v1/tasks/{task_id}/check-items/{first_id}", json={"done": True})
    finished = client.patch(f"/api/v1/tasks/{task_id}/check-items/{second_id}", json={"done": True})

    assert finished.json()["completed"] is True


def test_unticking_a_check_item_does_not_reopen_the_task(client: TestClient) -> None:
    task_id = make_task(client)
    created = client.post(f"/api/v1/tasks/{task_id}/check-items", json={"title": "Only step"})
    item_id = created.json()["check_items"][0]["id"]
    client.patch(f"/api/v1/tasks/{task_id}/check-items/{item_id}", json={"done": True})

    unticked = client.patch(f"/api/v1/tasks/{task_id}/check-items/{item_id}", json={"done": False})

    assert unticked.json()["check_items"][0]["done"] is False
    assert unticked.json()["completed"] is True  # the parent stays as the user set it


def test_check_items_follow_sort_order(client: TestClient) -> None:
    task_id = make_task(client)
    client.post(f"/api/v1/tasks/{task_id}/check-items", json={"title": "Socks"})
    body = client.post(f"/api/v1/tasks/{task_id}/check-items", json={"title": "Charger"}).json()
    first = body["check_items"][0]
    second = body["check_items"][1]

    response = client.patch(
        f"/api/v1/tasks/{task_id}/check-items/{second['id']}",
        json={"sort_order": first["sort_order"] - 512},
    )

    assert response.status_code == 200
    assert [item["title"] for item in response.json()["check_items"]] == ["Charger", "Socks"]
    read_back = client.get("/api/v1/tasks").json()["items"][0]
    assert [item["title"] for item in read_back["check_items"]] == ["Charger", "Socks"]


def test_check_item_can_be_deleted(client: TestClient) -> None:
    task_id = make_task(client)
    created = client.post(f"/api/v1/tasks/{task_id}/check-items", json={"title": "Oops"})
    item_id = created.json()["check_items"][0]["id"]

    response = client.delete(f"/api/v1/tasks/{task_id}/check-items/{item_id}")

    assert response.status_code == 204
    read_back = client.get("/api/v1/tasks").json()["items"][0]
    assert read_back["check_items"] == []
