from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import TEST_PASSWORD, make_task
from tests.test_focus_sessions import make_session
from tests.test_timers import make_timer


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
        client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})
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


def test_deleting_a_list_removes_its_section(client: TestClient) -> None:
    task_list = client.post("/api/v1/lists", json={"name": "Old project"}).json()
    client.post("/api/v1/sections", json={"list_id": task_list["id"], "name": "Doing"})

    response = client.delete(f"/api/v1/lists/{task_list['id']}")

    assert response.status_code == 204
    sections = client.get("/api/v1/sections", params={"list_id": task_list["id"]}).json()
    assert sections["items"] == []


def test_deleting_a_list_removes_all_its_sections(client: TestClient) -> None:
    task_list = client.post("/api/v1/lists", json={"name": "Old project"}).json()
    client.post("/api/v1/sections", json={"list_id": task_list["id"], "name": "Backlog"})
    client.post("/api/v1/sections", json={"list_id": task_list["id"], "name": "Doing"})

    response = client.delete(f"/api/v1/lists/{task_list['id']}")

    assert response.status_code == 204
    sections = client.get("/api/v1/sections", params={"list_id": task_list["id"]}).json()
    assert sections["items"] == []


def test_deleting_a_list_leaves_another_lists_sections_and_tasks_alone(
    client: TestClient,
) -> None:
    doomed = client.post("/api/v1/lists", json={"name": "Doomed"}).json()
    survivor_list = client.post("/api/v1/lists", json={"name": "Survivor"}).json()
    survivor_section = client.post(
        "/api/v1/sections", json={"list_id": survivor_list["id"], "name": "Doing"}
    ).json()
    survivor_task = make_task(client, "Keep me", list_id=survivor_list["id"])

    response = client.delete(f"/api/v1/lists/{doomed['id']}")

    assert response.status_code == 204
    sections = client.get("/api/v1/sections", params={"list_id": survivor_list["id"]}).json()
    assert [s["id"] for s in sections["items"]] == [survivor_section["id"]]
    tasks = client.get("/api/v1/tasks", params={"list_id": survivor_list["id"]}).json()["items"]
    assert [t["id"] for t in tasks] == [survivor_task["id"]]


def test_deleting_a_list_unlinks_but_keeps_focus_sessions_of_its_tasks(
    client: TestClient,
) -> None:
    task_list = client.post("/api/v1/lists", json={"name": "Old project"}).json()
    task = make_task(client, "Obsolete", list_id=task_list["id"])
    session = make_session(client, task_id=task["id"])

    response = client.delete(f"/api/v1/lists/{task_list['id']}")

    assert response.status_code == 204
    page = client.get("/api/v1/focus-sessions").json()
    assert page["total"] == 1
    assert page["items"][0]["id"] == session["id"]
    assert page["items"][0]["task_id"] is None


def test_deleting_a_list_unlinks_but_keeps_timers_of_its_tasks(client: TestClient) -> None:
    task_list = client.post("/api/v1/lists", json={"name": "Old project"}).json()
    task = make_task(client, "Obsolete", list_id=task_list["id"])
    timer = make_timer(client, "Preset", task_id=task["id"])

    response = client.delete(f"/api/v1/lists/{task_list['id']}")

    assert response.status_code == 204
    page = client.get("/api/v1/timers").json()
    assert page["total"] == 1
    assert page["items"][0]["id"] == timer["id"]
    assert page["items"][0]["task_id"] is None


def test_deleting_a_habit_linked_focus_session_is_unaffected_by_list_deletion(
    client: TestClient,
) -> None:
    from tests.test_habits import make_habit

    task_list = client.post("/api/v1/lists", json={"name": "Old project"}).json()
    habit = make_habit(client, "Reading")
    session = make_session(client, habit_id=habit["id"])

    response = client.delete(f"/api/v1/lists/{task_list['id']}")

    assert response.status_code == 204
    page = client.get("/api/v1/focus-sessions").json()
    assert page["total"] == 1
    assert page["items"][0]["id"] == session["id"]
    assert page["items"][0]["habit_id"] == habit["id"]


def test_deleting_a_list_with_sections_tasks_sessions_and_timers_leaves_expected_survivors(
    client: TestClient,
) -> None:
    task_list = client.post("/api/v1/lists", json={"name": "Old project"}).json()
    client.post("/api/v1/sections", json={"list_id": task_list["id"], "name": "Doing"})
    task = make_task(client, "Obsolete", list_id=task_list["id"])
    session = make_session(client, task_id=task["id"])
    timer = make_timer(client, "Preset", task_id=task["id"])

    response = client.delete(f"/api/v1/lists/{task_list['id']}")

    assert response.status_code == 204
    assert client.get("/api/v1/sections", params={"list_id": task_list["id"]}).json()["items"] == []
    remaining_tasks = client.get("/api/v1/tasks").json()["items"]
    assert all(t["id"] != task["id"] for t in remaining_tasks)
    session_page = client.get("/api/v1/focus-sessions").json()
    assert session_page["total"] == 1
    assert session_page["items"][0]["id"] == session["id"]
    assert session_page["items"][0]["task_id"] is None
    timer_page = client.get("/api/v1/timers").json()
    assert timer_page["total"] == 1
    assert timer_page["items"][0]["id"] == timer["id"]
    assert timer_page["items"][0]["task_id"] is None


def test_deleting_a_list_removes_check_items_of_its_tasks(client: TestClient) -> None:
    task_list = client.post("/api/v1/lists", json={"name": "Old project"}).json()
    task = make_task(client, "Obsolete", list_id=task_list["id"])
    task_with_item = client.post(
        f"/api/v1/tasks/{task['id']}/check-items", json={"title": "Step 1"}
    ).json()
    assert task_with_item["check_items"]

    response = client.delete(f"/api/v1/lists/{task_list['id']}")

    assert response.status_code == 204
    remaining_tasks = client.get("/api/v1/tasks").json()["items"]
    assert all(t["id"] != task["id"] for t in remaining_tasks)


def test_deleting_a_list_survives_a_tag_shared_with_another_list(client: TestClient) -> None:
    tag = client.post("/api/v1/tags", json={"name": "shared"}).json()
    doomed = client.post("/api/v1/lists", json={"name": "Doomed"}).json()
    make_task(client, "Obsolete", list_id=doomed["id"], tag_ids=[tag["id"]])

    response = client.delete(f"/api/v1/lists/{doomed['id']}")

    assert response.status_code == 204
    tags = client.get("/api/v1/tags").json()
    assert any(item["id"] == tag["id"] for item in tags["items"])


def test_deleting_a_list_leaves_its_folder_intact(client: TestClient) -> None:
    folder = client.post("/api/v1/folders", json={"name": "Work"}).json()
    task_list = client.post(
        "/api/v1/lists", json={"name": "Backend", "folder_id": folder["id"]}
    ).json()

    response = client.delete(f"/api/v1/lists/{task_list['id']}")

    assert response.status_code == 204
    folders = client.get("/api/v1/folders").json()["items"]
    assert any(item["id"] == folder["id"] for item in folders)


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


def test_a_single_list_is_readable(client: TestClient) -> None:
    created = client.post("/api/v1/lists", json={"name": "Groceries"}).json()

    response = client.get(f"/api/v1/lists/{created['id']}")

    assert response.status_code == 200
    assert response.json() == created


def test_unknown_list_is_404(client: TestClient) -> None:
    response = client.get("/api/v1/lists/999")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
