from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_first_boot_creates_the_inbox(client: TestClient) -> None:
    response = client.get("/api/v1/lists")

    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    inbox = items[0]
    assert inbox["name"] == "Inbox"
    assert inbox["is_inbox"] is True


def test_restarting_does_not_duplicate_the_inbox(database_url: str) -> None:
    for _ in range(2):
        with TestClient(create_app(Settings(database_url=database_url))):
            pass

    with TestClient(create_app(Settings(database_url=database_url))) as client:
        items = client.get("/api/v1/lists").json()["items"]
        assert [item["name"] for item in items] == ["Inbox"]


def test_created_list_appears_after_the_inbox_with_its_attributes(client: TestClient) -> None:
    response = client.post(
        "/api/v1/lists", json={"name": "Groceries", "color": "#ff9800", "emoji": "🛒"}
    )

    assert response.status_code == 201
    created = response.json()
    assert created["name"] == "Groceries"
    assert created["color"] == "#ff9800"
    assert created["emoji"] == "🛒"
    assert created["is_inbox"] is False
    assert created["is_archived"] is False
    assert created["folder_id"] is None

    items = client.get("/api/v1/lists").json()["items"]
    assert [item["name"] for item in items] == ["Inbox", "Groceries"]


def test_list_attributes_can_be_edited_and_cleared(client: TestClient) -> None:
    created = client.post(
        "/api/v1/lists", json={"name": "Groceries", "color": "#ff9800", "emoji": "🛒"}
    ).json()

    edited = client.patch(
        f"/api/v1/lists/{created['id']}", json={"name": "Food", "color": "#00c853"}
    )

    assert edited.status_code == 200
    body = edited.json()
    assert body["name"] == "Food"
    assert body["color"] == "#00c853"
    assert body["emoji"] == "🛒"

    cleared = client.patch(f"/api/v1/lists/{created['id']}", json={"color": None, "emoji": None})

    assert cleared.status_code == 200
    assert cleared.json()["color"] is None
    assert cleared.json()["emoji"] is None


def test_archiving_a_list_keeps_its_tasks_for_unarchive(client: TestClient) -> None:
    task_list = client.post("/api/v1/lists", json={"name": "Side project"}).json()
    client.post("/api/v1/tasks", json={"title": "Ship it", "list_id": task_list["id"]})

    archived = client.patch(f"/api/v1/lists/{task_list['id']}", json={"is_archived": True})

    assert archived.status_code == 200
    assert archived.json()["is_archived"] is True
    tasks = client.get("/api/v1/tasks", params={"list_id": task_list["id"]}).json()["items"]
    assert [task["title"] for task in tasks] == ["Ship it"]

    unarchived = client.patch(f"/api/v1/lists/{task_list['id']}", json={"is_archived": False})

    assert unarchived.json()["is_archived"] is False


def test_deleting_a_list_removes_its_tasks(client: TestClient) -> None:
    task_list = client.post("/api/v1/lists", json={"name": "Old project"}).json()
    task_id = client.post(
        "/api/v1/tasks", json={"title": "Obsolete", "list_id": task_list["id"]}
    ).json()["id"]

    response = client.delete(f"/api/v1/lists/{task_list['id']}")

    assert response.status_code == 204
    remaining_lists = client.get("/api/v1/lists").json()["items"]
    assert all(item["id"] != task_list["id"] for item in remaining_lists)
    remaining_tasks = client.get("/api/v1/tasks").json()["items"]
    assert all(task["id"] != task_id for task in remaining_tasks)


def test_list_can_be_moved_into_and_out_of_a_folder(client: TestClient) -> None:
    folder = client.post("/api/v1/folders", json={"name": "Work"}).json()
    task_list = client.post("/api/v1/lists", json={"name": "Backend"}).json()

    moved_in = client.patch(f"/api/v1/lists/{task_list['id']}", json={"folder_id": folder["id"]})

    assert moved_in.status_code == 200
    assert moved_in.json()["folder_id"] == folder["id"]

    moved_out = client.patch(f"/api/v1/lists/{task_list['id']}", json={"folder_id": None})

    assert moved_out.status_code == 200
    assert moved_out.json()["folder_id"] is None


def test_sidebar_list_order_follows_sort_order_with_inbox_pinned_first(
    client: TestClient,
) -> None:
    alpha = client.post("/api/v1/lists", json={"name": "Alpha"}).json()
    beta = client.post("/api/v1/lists", json={"name": "Beta"}).json()

    response = client.patch(
        f"/api/v1/lists/{beta['id']}", json={"sort_order": alpha["sort_order"] - 512}
    )

    assert response.status_code == 200
    items = client.get("/api/v1/lists").json()["items"]
    assert [item["name"] for item in items] == ["Inbox", "Beta", "Alpha"]


def test_each_list_remembers_its_view_mode(client: TestClient) -> None:
    board = client.post("/api/v1/lists", json={"name": "Board"}).json()
    client.post("/api/v1/lists", json={"name": "Plain"})
    assert board["view_mode"] == "list"

    response = client.patch(f"/api/v1/lists/{board['id']}", json={"view_mode": "kanban"})

    assert response.status_code == 200
    assert response.json()["view_mode"] == "kanban"
    items = client.get("/api/v1/lists").json()["items"]
    modes = {item["name"]: item["view_mode"] for item in items}
    assert modes["Board"] == "kanban"
    assert modes["Plain"] == "list"

    invalid = client.patch(f"/api/v1/lists/{board['id']}", json={"view_mode": "timeline"})
    assert invalid.status_code == 422


def test_the_inbox_view_mode_is_still_a_preference(client: TestClient) -> None:
    inbox = next(item for item in client.get("/api/v1/lists").json()["items"] if item["is_inbox"])

    allowed = client.patch(f"/api/v1/lists/{inbox['id']}", json={"view_mode": "kanban"})

    assert allowed.status_code == 200
    assert allowed.json()["view_mode"] == "kanban"

    still_blocked = client.patch(
        f"/api/v1/lists/{inbox['id']}", json={"view_mode": "list", "name": "Nope"}
    )
    assert still_blocked.status_code == 403
    assert still_blocked.json()["error"]["code"] == "inbox_immutable"
