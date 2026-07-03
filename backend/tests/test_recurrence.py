"""Recurring Tasks: RRULE recurrence that advances dates in place (ADR 0003).

Completing a recurring Task keeps it open with its dates advanced to the next
occurrence and writes a Completed Occurrence history record; the row itself
only completes when the recurrence ends (COUNT exhausted / past UNTIL).
"""

from fastapi.testclient import TestClient


def make_recurring_task(
    client: TestClient,
    recurrence: str,
    due_date: str = "2026-07-10T15:00:00Z",
    **extra: object,
) -> dict:
    response = client.post(
        "/api/v1/tasks",
        json={"title": "Repeat", "due_date": due_date, "recurrence": recurrence, **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()


def complete(client: TestClient, task_id: int) -> dict:
    response = client.patch(f"/api/v1/tasks/{task_id}", json={"completed": True})
    assert response.status_code == 200, response.text
    return response.json()


def test_a_new_task_has_no_recurrence(client: TestClient) -> None:
    task = client.post("/api/v1/tasks", json={"title": "Plain"}).json()

    assert task["recurrence"] is None


def test_recurrence_persists_and_reads_back(client: TestClient) -> None:
    task = make_recurring_task(client, "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH")

    assert task["recurrence"] == "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH"

    read_back = client.get("/api/v1/tasks").json()["items"][0]
    assert read_back["recurrence"] == "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH"


def test_recurrence_can_be_set_and_cleared_by_patch(client: TestClient) -> None:
    task = make_recurring_task(client, "FREQ=DAILY")

    cleared = client.patch(f"/api/v1/tasks/{task['id']}", json={"recurrence": None})
    assert cleared.status_code == 200
    assert cleared.json()["recurrence"] is None

    set_again = client.patch(f"/api/v1/tasks/{task['id']}", json={"recurrence": "FREQ=MONTHLY"})
    assert set_again.status_code == 200
    assert set_again.json()["recurrence"] == "FREQ=MONTHLY"


def test_malformed_recurrence_is_rejected(client: TestClient) -> None:
    for bad in ["daily", "FREQ=SOMETIMES", "FREQ=WEEKLY;BYDAY=XX", "", "FREQ"]:
        response = client.post(
            "/api/v1/tasks",
            json={"title": "Bad", "due_date": "2026-07-10T15:00:00Z", "recurrence": bad},
        )
        assert response.status_code == 422, bad
        assert response.json()["error"]["code"] == "invalid_recurrence"


def test_a_task_without_a_date_cannot_recur(client: TestClient) -> None:
    response = client.post("/api/v1/tasks", json={"title": "Dateless", "recurrence": "FREQ=DAILY"})

    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "invalid_recurrence"
    assert "date" in body["message"]


def test_clearing_the_date_clears_the_recurrence(client: TestClient) -> None:
    task = make_recurring_task(client, "FREQ=DAILY")

    response = client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"start_date": None, "due_date": None, "is_all_day": False, "time_zone": None},
    )

    assert response.status_code == 200
    assert response.json()["recurrence"] is None


def test_clearing_the_date_while_setting_recurrence_is_rejected(client: TestClient) -> None:
    task = make_recurring_task(client, "FREQ=DAILY")

    response = client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"due_date": None, "recurrence": "FREQ=DAILY"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_recurrence"


def test_completing_a_recurring_task_advances_it_in_place(client: TestClient) -> None:
    task = make_recurring_task(client, "FREQ=DAILY", due_date="2026-07-10T15:00:00Z")

    completed = complete(client, task["id"])

    assert completed["completed"] is False
    assert completed["completed_at"] is None
    assert completed["due_date"] == "2026-07-11T15:00:00Z"
    assert completed["recurrence"] == "FREQ=DAILY"


def test_completing_writes_a_completed_occurrence(client: TestClient) -> None:
    task = make_recurring_task(client, "FREQ=DAILY", due_date="2026-07-10T15:00:00Z")

    complete(client, task["id"])

    occurrences = client.get("/api/v1/completed-occurrences").json()["items"]
    assert len(occurrences) == 1
    occurrence = occurrences[0]
    assert occurrence["task_id"] == task["id"]
    assert occurrence["title"] == "Repeat"
    assert occurrence["list_id"] == task["list_id"]
    assert occurrence["due_date"] == "2026-07-10T15:00:00Z"
    assert occurrence["is_all_day"] is False
    assert occurrence["completed_at"] is not None


def test_occurrences_filter_by_list_and_order_newest_first(client: TestClient) -> None:
    errands = client.post("/api/v1/lists", json={"name": "Errands"}).json()
    inbox_task = make_recurring_task(client, "FREQ=DAILY")
    errand = make_recurring_task(client, "FREQ=DAILY", list_id=errands["id"])
    complete(client, inbox_task["id"])
    complete(client, errand["id"])
    complete(client, errand["id"])

    all_items = client.get("/api/v1/completed-occurrences").json()["items"]
    assert [item["task_id"] for item in all_items[:2]] == [errand["id"], errand["id"]]
    assert len(all_items) == 3

    scoped = client.get(f"/api/v1/completed-occurrences?list_id={errands['id']}").json()
    assert scoped["total"] == 2
    assert all(item["list_id"] == errands["id"] for item in scoped["items"])


def test_weekly_recurrence_with_weekdays_and_interval(client: TestClient) -> None:
    # Due Friday 2026-07-10; every 2 weeks on Mon+Thu -> Monday of week +2.
    task = make_recurring_task(
        client, "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH", due_date="2026-07-10T15:00:00Z"
    )

    completed = complete(client, task["id"])

    assert completed["due_date"] == "2026-07-20T15:00:00Z"


def test_monthly_and_yearly_recurrence(client: TestClient) -> None:
    monthly = make_recurring_task(client, "FREQ=MONTHLY", due_date="2026-07-10T15:00:00Z")
    yearly = make_recurring_task(client, "FREQ=YEARLY", due_date="2026-07-10T15:00:00Z")

    assert complete(client, monthly["id"])["due_date"] == "2026-08-10T15:00:00Z"
    assert complete(client, yearly["id"])["due_date"] == "2027-07-10T15:00:00Z"


def test_recurrence_preserves_wall_clock_time_across_dst(client: TestClient) -> None:
    # 14:00 in New York on 2026-10-31 (EDT, UTC-4); DST ends the next day, so
    # the next daily occurrence is 14:00 EST (UTC-5) — a different UTC instant.
    task = make_recurring_task(
        client,
        "FREQ=DAILY",
        due_date="2026-10-31T18:00:00Z",
        time_zone="America/New_York",
    )

    completed = complete(client, task["id"])

    assert completed["due_date"] == "2026-11-01T19:00:00Z"


def test_advancing_preserves_the_start_due_duration(client: TestClient) -> None:
    task = make_recurring_task(
        client,
        "FREQ=DAILY",
        due_date="2026-07-10T15:00:00Z",
        start_date="2026-07-10T14:00:00Z",
    )

    completed = complete(client, task["id"])

    assert completed["start_date"] == "2026-07-11T14:00:00Z"
    assert completed["due_date"] == "2026-07-11T15:00:00Z"


def test_all_day_recurrence_stays_date_only(client: TestClient) -> None:
    task = make_recurring_task(
        client, "FREQ=WEEKLY", due_date="2026-07-10T00:00:00Z", is_all_day=True
    )

    completed = complete(client, task["id"])

    assert completed["due_date"] == "2026-07-17T00:00:00Z"
    assert completed["is_all_day"] is True


def test_deleting_a_task_removes_its_occurrences(client: TestClient) -> None:
    task = make_recurring_task(client, "FREQ=DAILY")
    complete(client, task["id"])

    assert client.delete(f"/api/v1/tasks/{task['id']}").status_code == 204

    assert client.get("/api/v1/completed-occurrences").json()["total"] == 0


def test_deleting_a_list_removes_its_tasks_occurrences(client: TestClient) -> None:
    errands = client.post("/api/v1/lists", json={"name": "Errands"}).json()
    task = make_recurring_task(client, "FREQ=DAILY", list_id=errands["id"])
    complete(client, task["id"])

    assert client.delete(f"/api/v1/lists/{errands['id']}").status_code == 204

    # A new task can reuse the deleted task's id (SQLite rowid reuse) — stale
    # history must not attach itself to the newcomer.
    replacement = client.post("/api/v1/tasks", json={"title": "Fresh"}).json()
    assert replacement["id"] == task["id"]
    assert client.get("/api/v1/completed-occurrences").json()["total"] == 0


def test_part_order_in_a_rule_does_not_matter(client: TestClient) -> None:
    task = make_recurring_task(client, "INTERVAL=2;FREQ=WEEKLY", due_date="2026-07-10T15:00:00Z")

    completed = complete(client, task["id"])

    assert completed["due_date"] == "2026-07-24T15:00:00Z"


def test_without_recurrence_completion_is_normal(client: TestClient) -> None:
    task = make_recurring_task(client, "FREQ=DAILY")
    client.patch(f"/api/v1/tasks/{task['id']}", json={"recurrence": None})

    completed = complete(client, task["id"])

    assert completed["completed"] is True
    assert completed["completed_at"] is not None
    assert completed["due_date"] == task["due_date"]
    assert client.get("/api/v1/completed-occurrences").json()["total"] == 0


def test_ends_after_n_times_the_nth_completion_completes_the_row(client: TestClient) -> None:
    task = make_recurring_task(client, "FREQ=DAILY;COUNT=3", due_date="2026-07-10T15:00:00Z")

    first = complete(client, task["id"])
    assert first["completed"] is False
    assert first["due_date"] == "2026-07-11T15:00:00Z"
    assert first["recurrence"] == "FREQ=DAILY;COUNT=2"

    second = complete(client, task["id"])
    assert second["completed"] is False
    assert second["due_date"] == "2026-07-12T15:00:00Z"

    third = complete(client, task["id"])
    assert third["completed"] is True
    assert third["completed_at"] is not None
    assert third["due_date"] == "2026-07-12T15:00:00Z"

    # History: two occurrences plus the completed row itself — three entries.
    assert client.get("/api/v1/completed-occurrences").json()["total"] == 2
    completed_tasks = client.get("/api/v1/tasks?completed=true").json()["items"]
    assert [row["id"] for row in completed_tasks] == [task["id"]]


def test_ends_on_date_the_final_completion_completes_the_row(client: TestClient) -> None:
    task = make_recurring_task(
        client, "FREQ=DAILY;UNTIL=20260711T235959", due_date="2026-07-10T15:00:00Z"
    )

    first = complete(client, task["id"])
    assert first["completed"] is False
    assert first["due_date"] == "2026-07-11T15:00:00Z"

    final = complete(client, task["id"])
    assert final["completed"] is True
    assert final["due_date"] == "2026-07-11T15:00:00Z"

    assert client.get("/api/v1/completed-occurrences").json()["total"] == 1


def test_reopening_an_ended_recurrence_keeps_its_history(client: TestClient) -> None:
    task = make_recurring_task(client, "FREQ=DAILY;COUNT=2", due_date="2026-07-10T15:00:00Z")
    complete(client, task["id"])
    complete(client, task["id"])

    reopened = client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": False})

    assert reopened.status_code == 200
    assert reopened.json()["completed"] is False
    assert reopened.json()["completed_at"] is None
    assert client.get("/api/v1/completed-occurrences").json()["total"] == 1


def test_check_item_auto_complete_advances_a_recurring_task(client: TestClient) -> None:
    task = make_recurring_task(client, "FREQ=DAILY", due_date="2026-07-10T15:00:00Z")
    client.post(f"/api/v1/tasks/{task['id']}/check-items", json={"title": "Stretch"})
    with_items = client.post(
        f"/api/v1/tasks/{task['id']}/check-items", json={"title": "Run"}
    ).json()
    first, second = with_items["check_items"]

    client.patch(f"/api/v1/tasks/{task['id']}/check-items/{first['id']}", json={"done": True})
    response = client.patch(
        f"/api/v1/tasks/{task['id']}/check-items/{second['id']}", json={"done": True}
    )

    advanced = response.json()
    assert advanced["completed"] is False
    assert advanced["due_date"] == "2026-07-11T15:00:00Z"
    # The next occurrence starts with a fresh checklist.
    assert [item["done"] for item in advanced["check_items"]] == [False, False]
    assert client.get("/api/v1/completed-occurrences").json()["total"] == 1
