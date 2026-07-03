from fastapi.testclient import TestClient


def test_created_folder_appears_in_the_folder_listing(client: TestClient) -> None:
    response = client.post("/api/v1/folders", json={"name": "Work"})

    assert response.status_code == 201
    folder = response.json()
    assert folder["name"] == "Work"

    items = client.get("/api/v1/folders").json()["items"]
    assert [item["name"] for item in items] == ["Work"]


def test_folder_can_be_renamed(client: TestClient) -> None:
    folder = client.post("/api/v1/folders", json={"name": "Wrok"}).json()

    response = client.patch(f"/api/v1/folders/{folder['id']}", json={"name": "Work"})

    assert response.status_code == 200
    assert response.json()["name"] == "Work"
    items = client.get("/api/v1/folders").json()["items"]
    assert [item["name"] for item in items] == ["Work"]


def test_deleting_a_folder_ungroups_its_lists(client: TestClient) -> None:
    folder = client.post("/api/v1/folders", json={"name": "Work"}).json()
    task_list = client.post("/api/v1/lists", json={"name": "Backend"}).json()
    client.patch(f"/api/v1/lists/{task_list['id']}", json={"folder_id": folder["id"]})

    response = client.delete(f"/api/v1/folders/{folder['id']}")

    assert response.status_code == 204
    assert client.get("/api/v1/folders").json()["items"] == []
    survivor = next(
        item
        for item in client.get("/api/v1/lists").json()["items"]
        if item["id"] == task_list["id"]
    )
    assert survivor["folder_id"] is None


def test_folder_order_follows_sort_order(client: TestClient) -> None:
    work = client.post("/api/v1/folders", json={"name": "Work"}).json()
    home = client.post("/api/v1/folders", json={"name": "Home"}).json()

    response = client.patch(
        f"/api/v1/folders/{home['id']}", json={"sort_order": work["sort_order"] - 512}
    )

    assert response.status_code == 200
    items = client.get("/api/v1/folders").json()["items"]
    assert [item["name"] for item in items] == ["Home", "Work"]
