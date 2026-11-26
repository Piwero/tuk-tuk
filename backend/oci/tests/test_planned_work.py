"""Planned work (issue #558): at most one optional block of reserved work
time per Task — a start instant, a positive duration, an IANA timezone and
an optional buffer after — held apart from the Task's own start/due dates.
"""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import create_user_row, log_in, make_task

DUE = "2026-07-10T15:00:00Z"
PLAN = {
    "start": "2026-07-08T07:00:00Z",
    "duration_minutes": 90,
    "time_zone": "Europe/Madrid",
    "buffer_minutes": 15,
}


def plan(task_id: int, client: TestClient, planned_work: object) -> dict:
    response = client.patch(f"/api/v1/tasks/{task_id}", json={"planned_work": planned_work})
    assert response.status_code == 200, response.text
    return response.json()


def test_a_new_task_has_no_planned_work(client: TestClient) -> None:
    task = make_task(client, "Plain")

    assert task["planned_work"] is None


def test_a_plan_is_saved_and_read_back_without_touching_the_due_date(
    client: TestClient,
) -> None:
    task = make_task(client, "Report", due_date=DUE)

    planned = plan(task["id"], client, PLAN)

    assert planned["planned_work"] == {**PLAN, "end": "2026-07-08T08:30:00Z"}
    assert planned["due_date"] == DUE
    assert planned["start_date"] is None
    read_back = client.get(f"/api/v1/tasks/{task['id']}").json()
    assert read_back["planned_work"] == planned["planned_work"]


def test_moving_the_plan_leaves_the_task_dates_alone(client: TestClient) -> None:
    task = make_task(
        client,
        "Report",
        start_date="2026-07-10T13:00:00Z",
        due_date=DUE,
        time_zone="Europe/Madrid",
    )
    plan(task["id"], client, PLAN)

    moved = plan(task["id"], client, {**PLAN, "start": "2026-07-09T08:00:00Z"})

    assert moved["planned_work"]["start"] == "2026-07-09T08:00:00Z"
    assert moved["start_date"] == "2026-07-10T13:00:00Z"
    assert moved["due_date"] == DUE
    assert moved["time_zone"] == "Europe/Madrid"


def test_removing_the_plan_keeps_the_task_and_its_deadline(client: TestClient) -> None:
    task = make_task(client, "Report", due_date=DUE)
    plan(task["id"], client, PLAN)

    removed = plan(task["id"], client, None)

    assert removed["planned_work"] is None
    assert removed["due_date"] == DUE
    assert client.get(f"/api/v1/tasks/{task['id']}").json()["due_date"] == DUE


def test_a_plan_needs_no_due_date_and_the_buffer_is_optional(client: TestClient) -> None:
    task = make_task(client, "Someday")

    planned = plan(task["id"], client, {**PLAN, "buffer_minutes": None})

    assert planned["planned_work"]["buffer_minutes"] is None
    assert planned["due_date"] is None


def test_rescheduling_the_task_leaves_the_plan_alone(client: TestClient) -> None:
    task = make_task(client, "Report", due_date=DUE)
    planned = plan(task["id"], client, PLAN)["planned_work"]

    response = client.patch(f"/api/v1/tasks/{task['id']}", json={"due_date": None})

    assert response.status_code == 200
    assert response.json()["planned_work"] == planned


@pytest.mark.parametrize(
    ("block", "message"),
    [
        ({**PLAN, "duration_minutes": 0}, "positive duration"),
        ({**PLAN, "duration_minutes": -30}, "positive duration"),
        ({**PLAN, "buffer_minutes": -5}, "negative"),
        ({**PLAN, "time_zone": "Mars/Olympus_Mons"}, "Unknown IANA timezone"),
        # 23:00 Madrid (CEST) + 90 min runs past local midnight.
        ({**PLAN, "start": "2026-07-08T21:00:00Z"}, "one local day"),
        # 23:00 Madrid + 45 min + 30 min buffer: the buffer counts too.
        (
            {**PLAN, "start": "2026-07-08T21:00:00Z", "duration_minutes": 45, "buffer_minutes": 30},
            "one local day",
        ),
    ],
)
def test_an_invalid_plan_is_rejected_and_the_old_one_kept(
    client: TestClient, block: dict, message: str
) -> None:
    task = make_task(client, "Report", due_date=DUE)
    saved = plan(task["id"], client, PLAN)["planned_work"]

    response = client.patch(f"/api/v1/tasks/{task['id']}", json={"planned_work": block})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "invalid_planned_work"
    assert message in error["message"]
    assert client.get(f"/api/v1/tasks/{task['id']}").json()["planned_work"] == saved


def test_a_plan_may_end_exactly_at_local_midnight(client: TestClient) -> None:
    task = make_task(client, "Late")

    # 22:30 Madrid (CEST) + 75 min + 15 min buffer = 00:00.
    planned = plan(
        task["id"],
        client,
        {**PLAN, "start": "2026-07-08T20:30:00Z", "duration_minutes": 75},
    )

    assert planned["planned_work"]["end"] == "2026-07-08T21:45:00Z"


def test_a_plan_across_the_spring_forward_gap_keeps_its_elapsed_length(
    client: TestClient,
) -> None:
    task = make_task(client, "Early")

    # 01:30 CET on 29 March 2026; clocks jump 02:00 -> 03:00, so 60 elapsed
    # minutes end at 03:30 CEST on the same local day.
    planned = plan(
        task["id"],
        client,
        {**PLAN, "start": "2026-03-29T00:30:00Z", "duration_minutes": 60},
    )

    assert planned["planned_work"]["end"] == "2026-03-29T01:30:00Z"


def test_the_repeated_hour_of_a_fall_back_is_told_apart_by_its_instant(
    client: TestClient,
) -> None:
    first = make_task(client, "First 02:30")
    second = make_task(client, "Second 02:30")

    # 02:30 local happens twice on 25 October 2026 in Madrid: CEST then CET.
    a = plan(first["id"], client, {**PLAN, "start": "2026-10-25T02:30:00+02:00"})
    b = plan(second["id"], client, {**PLAN, "start": "2026-10-25T02:30:00+01:00"})

    assert a["planned_work"]["start"] == "2026-10-25T00:30:00Z"
    assert b["planned_work"]["start"] == "2026-10-25T01:30:00Z"


def test_a_late_plan_on_the_fall_back_day_still_may_not_cross_midnight(
    client: TestClient,
) -> None:
    task = make_task(client, "Long day")

    # 23:30 CET on 25 October 2026 + 90 minutes crosses local midnight, even
    # though that local day is 25 hours long.
    response = client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"planned_work": {**PLAN, "start": "2026-10-25T22:30:00Z"}},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_planned_work"


def test_advancing_a_recurring_task_clears_its_occurrence_plan(client: TestClient) -> None:
    task = make_task(client, "Weekly review", due_date=DUE, recurrence="FREQ=WEEKLY")
    plan(task["id"], client, PLAN)

    advanced = client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True}).json()

    assert advanced["completed"] is False
    assert advanced["due_date"] == "2026-07-17T15:00:00Z"
    assert advanced["planned_work"] is None


def test_ticking_the_last_check_item_of_a_recurring_task_clears_its_plan(
    client: TestClient,
) -> None:
    task = make_task(client, "Weekly review", due_date=DUE, recurrence="FREQ=WEEKLY")
    item = client.post(f"/api/v1/tasks/{task['id']}/check-items", json={"title": "Inbox zero"})
    assert item.status_code == 201, item.text
    plan(task["id"], client, PLAN)

    response = client.patch(
        f"/api/v1/tasks/{task['id']}/check-items/{item.json()['id']}", json={"done": True}
    )

    assert response.status_code == 200, response.text
    assert response.json()["due_date"] == "2026-07-17T15:00:00Z"
    assert response.json()["planned_work"] is None


def test_completing_the_last_occurrence_of_a_recurring_task_clears_its_plan(
    client: TestClient,
) -> None:
    task = make_task(client, "Once more", due_date=DUE, recurrence="FREQ=WEEKLY;COUNT=1")
    plan(task["id"], client, PLAN)

    completed = client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True}).json()

    assert completed["completed"] is True
    assert completed["planned_work"] is None


def test_completing_a_one_off_task_keeps_its_plan_for_a_reopen(client: TestClient) -> None:
    task = make_task(client, "Report", due_date=DUE)
    planned = plan(task["id"], client, PLAN)["planned_work"]

    client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": True})
    reopened = client.patch(f"/api/v1/tasks/{task['id']}", json={"completed": False}).json()

    assert reopened["planned_work"] == planned


def test_a_plan_is_not_a_reminder_anchor(client: TestClient) -> None:
    task = make_task(client, "Dateless")
    plan(task["id"], client, PLAN)

    response = client.patch(f"/api/v1/tasks/{task['id']}", json={"reminders": ["-PT30M"]})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_reminders"


def test_an_old_client_payload_round_trips_without_losing_the_plan(
    client: TestClient,
) -> None:
    task = make_task(client, "Report", due_date=DUE)
    planned = plan(task["id"], client, PLAN)["planned_work"]
    # An older client knows nothing of planned_work: it echoes back the
    # fields it does know, edited.
    known = ("title", "description", "priority", "due_date", "start_date", "time_zone")
    old_payload = {field: task[field] for field in known} | {"title": "Report v2"}

    response = client.patch(f"/api/v1/tasks/{task['id']}", json=old_payload)

    assert response.status_code == 200, response.text
    assert response.json()["title"] == "Report v2"
    assert response.json()["planned_work"] == planned


def test_an_incomplete_plan_object_is_rejected(client: TestClient) -> None:
    task = make_task(client, "Report")

    response = client.patch(
        f"/api/v1/tasks/{task['id']}",
        json={"planned_work": {"start": PLAN["start"], "duration_minutes": 30}},
    )

    assert response.status_code == 422


def test_another_users_task_cannot_be_planned_or_read(client: TestClient) -> None:
    task = make_task(client, "Alice's report", due_date=DUE)
    plan(task["id"], client, PLAN)
    create_user_row(client, "bea", "bea@example.com")
    client.cookies.clear()
    log_in(client, "bea")

    write = client.patch(f"/api/v1/tasks/{task['id']}", json={"planned_work": None})
    read = client.get(f"/api/v1/tasks/{task['id']}")

    assert write.status_code == 404
    assert read.status_code == 404
    assert client.get("/api/v1/tasks").json()["items"] == []
    client.cookies.clear()
    log_in(client)
    assert client.get(f"/api/v1/tasks/{task['id']}").json()["planned_work"] is not None


def test_no_event_route_can_write_planned_work(client: TestClient) -> None:
    # Issue #562: Planned work is written only through the Task PATCH. Events
    # are read-only Google context (ADR 0006): every route under /events is a
    # read, so no request can plan work onto an Event.
    paths = client.get("/openapi.json").json()["paths"]
    event_paths = {path: ops for path, ops in paths.items() if path.startswith("/api/v1/events")}
    assert event_paths, "the Events endpoint should exist"
    for path, operations in event_paths.items():
        assert set(operations) == {"get"}, path

    for method in ("post", "put", "patch"):
        response = client.request(method.upper(), "/api/v1/events", json={"planned_work": PLAN})
        assert response.status_code == 405, (method, response.text)
