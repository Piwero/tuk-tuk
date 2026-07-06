from fastapi.testclient import TestClient


def make_list(client: TestClient, name: str = "Project") -> int:
    list_id: int = client.post("/api/v1/lists", json={"name": name}).json()["id"]
    return list_id


def test_created_sections_are_listed_per_list_in_order(client: TestClient) -> None:
    project = make_list(client)
    other = make_list(client, "Other")

    backlog = client.post("/api/v1/sections", json={"list_id": project, "name": "Backlog"})
    doing = client.post("/api/v1/sections", json={"list_id": project, "name": "Doing"})
    client.post("/api/v1/sections", json={"list_id": other, "name": "Elsewhere"})

    assert backlog.status_code == 201
    assert backlog.json()["name"] == "Backlog"
    assert backlog.json()["list_id"] == project
    assert doing.json()["sort_order"] > backlog.json()["sort_order"]

    items = client.get("/api/v1/sections", params={"list_id": project}).json()["items"]
    assert [section["name"] for section in items] == ["Backlog", "Doing"]


def test_section_can_be_renamed_and_reordered(client: TestClient) -> None:
    project = make_list(client)
    backlog = client.post("/api/v1/sections", json={"list_id": project, "name": "Backlgo"}).json()
    doing = client.post("/api/v1/sections", json={"list_id": project, "name": "Doing"}).json()

    renamed = client.patch(f"/api/v1/sections/{backlog['id']}", json={"name": "Backlog"})

    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Backlog"

    client.patch(
        f"/api/v1/sections/{doing['id']}", json={"sort_order": backlog["sort_order"] - 512}
    )

    items = client.get("/api/v1/sections", params={"list_id": project}).json()["items"]
    assert [section["name"] for section in items] == ["Doing", "Backlog"]


def test_deleting_a_section_keeps_its_tasks_ungrouped(client: TestClient) -> None:
    project = make_list(client)
    section = client.post("/api/v1/sections", json={"list_id": project, "name": "Doing"}).json()
    task = client.post("/api/v1/tasks", json={"title": "Grouped", "list_id": project}).json()
    client.patch(f"/api/v1/tasks/{task['id']}", json={"section_id": section["id"]})

    response = client.delete(f"/api/v1/sections/{section['id']}")

    assert response.status_code == 204
    assert client.get("/api/v1/sections", params={"list_id": project}).json()["items"] == []
    survivor = client.get("/api/v1/tasks", params={"list_id": project}).json()["items"][0]
    assert survivor["title"] == "Grouped"
    assert survivor["section_id"] is None


def test_task_moves_into_and_out_of_a_section(client: TestClient) -> None:
    project = make_list(client)
    section = client.post("/api/v1/sections", json={"list_id": project, "name": "Doing"}).json()
    task = client.post("/api/v1/tasks", json={"title": "Work item", "list_id": project}).json()
    assert task["section_id"] is None

    grouped = client.patch(f"/api/v1/tasks/{task['id']}", json={"section_id": section["id"]})
    assert grouped.status_code == 200
    assert grouped.json()["section_id"] == section["id"]

    ungrouped = client.patch(f"/api/v1/tasks/{task['id']}", json={"section_id": None})
    assert ungrouped.status_code == 200
    assert ungrouped.json()["section_id"] is None


def test_moving_a_task_to_another_list_clears_its_section(client: TestClient) -> None:
    project = make_list(client)
    other = make_list(client, "Other")
    section = client.post("/api/v1/sections", json={"list_id": project, "name": "Doing"}).json()
    task = client.post("/api/v1/tasks", json={"title": "Migrant", "list_id": project}).json()
    client.patch(f"/api/v1/tasks/{task['id']}", json={"section_id": section["id"]})

    moved = client.patch(f"/api/v1/tasks/{task['id']}", json={"list_id": other})

    assert moved.json()["list_id"] == other
    assert moved.json()["section_id"] is None


def test_task_order_follows_sort_order_and_survives_reload(client: TestClient) -> None:
    project = make_list(client)
    first = client.post("/api/v1/tasks", json={"title": "First", "list_id": project}).json()
    second = client.post("/api/v1/tasks", json={"title": "Second", "list_id": project}).json()
    third = client.post("/api/v1/tasks", json={"title": "Third", "list_id": project}).json()
    assert second["sort_order"] > first["sort_order"]

    midpoint = (first["sort_order"] + second["sort_order"]) // 2
    response = client.patch(f"/api/v1/tasks/{third['id']}", json={"sort_order": midpoint})

    assert response.status_code == 200
    items = client.get("/api/v1/tasks", params={"list_id": project}).json()["items"]
    assert [task["title"] for task in items] == ["First", "Third", "Second"]


def test_task_can_be_created_directly_in_a_section(client: TestClient) -> None:
    project = make_list(client)
    section = client.post("/api/v1/sections", json={"list_id": project, "name": "Doing"}).json()

    created = client.post(
        "/api/v1/tasks",
        json={"title": "Born here", "list_id": project, "section_id": section["id"]},
    )

    assert created.status_code == 201
    assert created.json()["section_id"] == section["id"]

    wrong_list = client.post("/api/v1/tasks", json={"title": "Stray", "section_id": section["id"]})
    assert wrong_list.status_code == 409
    assert wrong_list.json()["error"]["code"] == "section_list_mismatch"

    unknown = client.post(
        "/api/v1/tasks", json={"title": "Lost", "list_id": project, "section_id": 424242}
    )
    assert unknown.status_code == 404
