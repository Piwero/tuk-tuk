"""Now shortlist (issue #551): a small ordered list of alternatives beside
Now, stored per User next to the Now selection."""

from fastapi.testclient import TestClient

from tests.conftest import create_user_row, log_in
from tests.test_now import NOW, TOGGLE, make_task

SHORTLIST = "/api/v1/now/shortlist"


def test_the_shortlist_is_empty_at_first(client: TestClient) -> None:
    assert client.get(SHORTLIST).json() == {"task_ids": []}


def test_the_shortlist_keeps_the_order_it_was_given(client: TestClient) -> None:
    a, b, c = (make_task(client, t)["id"] for t in ("A", "B", "C"))

    assert client.put(SHORTLIST, json={"task_ids": [c, a, b]}).json() == {"task_ids": [c, a, b]}
    client.put(SHORTLIST, json={"task_ids": [a, b, c]})

    assert client.get(SHORTLIST).json() == {"task_ids": [a, b, c]}


def test_duplicates_keep_their_first_place(client: TestClient) -> None:
    a, b = (make_task(client, t)["id"] for t in ("A", "B"))

    assert client.put(SHORTLIST, json={"task_ids": [a, b, a, b]}).json() == {"task_ids": [a, b]}
    assert client.get(SHORTLIST).json() == {"task_ids": [a, b]}


def test_there_is_no_cap(client: TestClient) -> None:
    ids = [make_task(client, f"T{i}")["id"] for i in range(8)]

    client.put(SHORTLIST, json={"task_ids": ids})

    assert client.get(SHORTLIST).json() == {"task_ids": ids}


def test_the_now_task_is_never_also_on_the_shortlist(client: TestClient) -> None:
    a, b = (make_task(client, t)["id"] for t in ("A", "B"))
    client.put(NOW, json={"task_id": a})

    assert client.put(SHORTLIST, json={"task_ids": [a, b]}).json() == {"task_ids": [b]}


def test_promoting_an_entry_to_now_takes_it_off_the_shortlist(client: TestClient) -> None:
    a, b, c = (make_task(client, t)["id"] for t in ("A", "B", "C"))
    client.put(NOW, json={"task_id": a})
    client.put(SHORTLIST, json={"task_ids": [b, c]})

    client.put(NOW, json={"task_id": c})

    assert client.get(NOW).json() == {"task_id": c}
    assert client.get(SHORTLIST).json() == {"task_ids": [b]}


def test_another_users_task_is_not_found_without_disclosure(client: TestClient) -> None:
    mine = make_task(client)["id"]
    create_user_row(client, "bea", "bea@example.com")
    client.cookies.clear()
    log_in(client, "bea")

    theirs = client.put(SHORTLIST, json={"task_ids": [mine]})
    missing = client.put(SHORTLIST, json={"task_ids": [999_999]})

    assert theirs.status_code == 404
    assert theirs.json() == missing.json()
    assert client.get(SHORTLIST).json() == {"task_ids": []}


def test_each_user_has_their_own_shortlist(client: TestClient) -> None:
    mine = make_task(client)["id"]
    client.put(SHORTLIST, json={"task_ids": [mine]})
    create_user_row(client, "bea", "bea@example.com")
    client.cookies.clear()
    log_in(client, "bea")

    assert client.get(SHORTLIST).json() == {"task_ids": []}


def test_stale_entries_are_pruned(client: TestClient) -> None:
    deleted = make_task(client, "Deleted")["id"]
    done = make_task(client, "Done")["id"]
    daily = make_task(client, "Daily", due_date="2026-07-10T15:00:00Z", recurrence="FREQ=DAILY")
    kept = make_task(client, "Kept")["id"]
    client.put(SHORTLIST, json={"task_ids": [deleted, done, daily["id"], kept]})

    client.delete(f"/api/v1/tasks/{deleted}")
    client.patch(f"/api/v1/tasks/{done}", json={"completed": True})
    client.patch(f"/api/v1/tasks/{daily['id']}", json={"completed": True})

    assert client.get(SHORTLIST).json() == {"task_ids": [kept]}


def test_shortlist_actions_leave_tasks_untouched(client: TestClient) -> None:
    task = make_task(
        client,
        start_date="2026-11-30T00:00:00Z",
        due_date="2026-12-01T00:00:00Z",
        is_all_day=True,
        priority="high",
    )
    other = make_task(client, "Other")["id"]
    client.put(SHORTLIST, json={"task_ids": [task["id"], other]})
    client.put(SHORTLIST, json={"task_ids": [other, task["id"]]})
    client.put(NOW, json={"task_id": task["id"]})
    client.put(SHORTLIST, json={"task_ids": []})

    assert client.get(f"/api/v1/tasks/{task['id']}").json() == task


def test_shortlist_writes_leave_other_settings_intact(client: TestClient) -> None:
    client.put(TOGGLE, json={"enabled": True})
    now = make_task(client, "Now")["id"]
    entry = make_task(client, "Entry")["id"]
    client.put(NOW, json={"task_id": now})
    sections = client.get("/api/v1/settings/sections").json()
    active_hours = client.get("/api/v1/settings/active-hours").json()

    client.put(SHORTLIST, json={"task_ids": [entry]})

    assert client.get(TOGGLE).json() == {"enabled": True}
    assert client.get(NOW).json() == {"task_id": now}
    assert client.get("/api/v1/settings/sections").json() == sections
    assert client.get("/api/v1/settings/active-hours").json() == active_hours


def test_interleaved_now_and_shortlist_writes_keep_each_other(client: TestClient) -> None:
    a, b = (make_task(client, t)["id"] for t in ("A", "B"))

    client.put(SHORTLIST, json={"task_ids": [b]})
    client.put(TOGGLE, json={"enabled": False})
    client.put(NOW, json={"task_id": a})

    assert client.get(SHORTLIST).json() == {"task_ids": [b]}
    assert client.get(NOW).json() == {"task_id": a}
