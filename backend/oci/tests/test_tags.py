from fastapi.testclient import TestClient


def test_created_tags_are_listed_in_name_order(client: TestClient) -> None:
    work = client.post("/api/v1/tags", json={"name": "work", "color": "#4772fa"})
    errand = client.post("/api/v1/tags", json={"name": "errand"})

    assert work.status_code == 201
    assert work.json()["name"] == "work"
    assert work.json()["color"] == "#4772fa"
    assert errand.json()["color"] is None

    items = client.get("/api/v1/tags").json()["items"]
    assert [tag["name"] for tag in items] == ["errand", "work"]


def test_tag_can_be_renamed_recolored_and_deleted(client: TestClient) -> None:
    tag = client.post("/api/v1/tags", json={"name": "wrok"}).json()

    edited = client.patch(f"/api/v1/tags/{tag['id']}", json={"name": "work", "color": "#e03131"})

    assert edited.status_code == 200
    assert edited.json()["name"] == "work"
    assert edited.json()["color"] == "#e03131"

    response = client.delete(f"/api/v1/tags/{tag['id']}")

    assert response.status_code == 204
    assert client.get("/api/v1/tags").json()["items"] == []


def test_task_carries_assigned_tags_in_name_order(client: TestClient) -> None:
    work = client.post("/api/v1/tags", json={"name": "work", "color": "#4772fa"}).json()
    urgent = client.post("/api/v1/tags", json={"name": "urgent"}).json()
    task = client.post("/api/v1/tasks", json={"title": "File taxes"}).json()
    assert task["tags"] == []

    assigned = client.patch(
        f"/api/v1/tasks/{task['id']}", json={"tag_ids": [work["id"], urgent["id"]]}
    )

    assert assigned.status_code == 200
    assert [tag["name"] for tag in assigned.json()["tags"]] == ["urgent", "work"]

    reduced = client.patch(f"/api/v1/tasks/{task['id']}", json={"tag_ids": [work["id"]]})
    assert [tag["name"] for tag in reduced.json()["tags"]] == ["work"]

    cleared = client.patch(f"/api/v1/tasks/{task['id']}", json={"tag_ids": []})
    assert cleared.json()["tags"] == []


def test_tag_view_collects_tasks_across_lists(client: TestClient) -> None:
    work = client.post("/api/v1/tags", json={"name": "work"}).json()
    errands = client.post("/api/v1/lists", json={"name": "Errands"}).json()
    inbox_task = client.post("/api/v1/tasks", json={"title": "Email boss"}).json()
    errand_task = client.post(
        "/api/v1/tasks", json={"title": "Print badge", "list_id": errands["id"]}
    ).json()
    client.post("/api/v1/tasks", json={"title": "Untagged"})
    for task in (inbox_task, errand_task):
        client.patch(f"/api/v1/tasks/{task['id']}", json={"tag_ids": [work["id"]]})

    page = client.get("/api/v1/tasks", params={"tag_id": work["id"]}).json()

    assert [t["title"] for t in page["items"]] == ["Email boss", "Print badge"]
    assert page["total"] == 2


def test_renaming_a_tag_renames_it_on_every_task(client: TestClient) -> None:
    tag = client.post("/api/v1/tags", json={"name": "wrok"}).json()
    task = client.post("/api/v1/tasks", json={"title": "Spellcheck"}).json()
    client.patch(f"/api/v1/tasks/{task['id']}", json={"tag_ids": [tag["id"]]})

    client.patch(f"/api/v1/tags/{tag['id']}", json={"name": "work"})

    read_back = client.get("/api/v1/tasks").json()["items"][0]
    assert [t["name"] for t in read_back["tags"]] == ["work"]


def test_deleting_a_tag_detaches_it_without_touching_tasks(client: TestClient) -> None:
    tag = client.post("/api/v1/tags", json={"name": "fleeting"}).json()
    task = client.post("/api/v1/tasks", json={"title": "Survivor"}).json()
    client.patch(f"/api/v1/tasks/{task['id']}", json={"tag_ids": [tag["id"]]})

    response = client.delete(f"/api/v1/tags/{tag['id']}")

    assert response.status_code == 204
    read_back = client.get("/api/v1/tasks").json()["items"][0]
    assert read_back["title"] == "Survivor"
    assert read_back["tags"] == []


def test_a_single_tag_is_readable(client: TestClient) -> None:
    created = client.post("/api/v1/tags", json={"name": "work"}).json()

    response = client.get(f"/api/v1/tags/{created['id']}")

    assert response.status_code == 200
    assert response.json() == created


def test_unknown_tag_is_404(client: TestClient) -> None:
    response = client.get("/api/v1/tags/999")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
