"""Task scheduling: due-only, start+due durations, all-day spans, timezone."""

from fastapi.testclient import TestClient


def test_new_task_carries_no_schedule(client: TestClient) -> None:
    created = client.post("/api/v1/tasks", json={"title": "Plain"}).json()

    assert created["start_date"] is None
    assert created["due_date"] is None
    assert created["is_all_day"] is False
    assert created["time_zone"] is None


def test_task_created_with_a_due_date_only(client: TestClient) -> None:
    response = client.post(
        "/api/v1/tasks",
        json={
            "title": "File taxes",
            "due_date": "2026-07-10T17:00:00Z",
            "time_zone": "Europe/Amsterdam",
        },
    )

    assert response.status_code == 201
    task = response.json()
    assert task["start_date"] is None
    assert task["due_date"] == "2026-07-10T17:00:00Z"
    assert task["is_all_day"] is False
    assert task["time_zone"] == "Europe/Amsterdam"

    read_back = client.get("/api/v1/tasks").json()["items"][0]
    assert read_back["due_date"] == "2026-07-10T17:00:00Z"
    assert read_back["time_zone"] == "Europe/Amsterdam"


def test_task_created_with_a_start_and_due_time_on_the_same_day(client: TestClient) -> None:
    response = client.post(
        "/api/v1/tasks",
        json={
            "title": "Design review",
            "start_date": "2026-07-10T14:00:00Z",
            "due_date": "2026-07-10T15:30:00Z",
            "time_zone": "Europe/Amsterdam",
        },
    )

    assert response.status_code == 201
    task = response.json()
    assert task["start_date"] == "2026-07-10T14:00:00Z"
    assert task["due_date"] == "2026-07-10T15:30:00Z"
    assert task["is_all_day"] is False


def test_task_scheduled_as_an_all_day_span_across_days(client: TestClient) -> None:
    task_id = client.post("/api/v1/tasks", json={"title": "Conference"}).json()["id"]

    response = client.patch(
        f"/api/v1/tasks/{task_id}",
        json={
            "start_date": "2026-07-06T00:00:00Z",
            "due_date": "2026-07-08T00:00:00Z",
            "is_all_day": True,
            "time_zone": "Europe/Amsterdam",
        },
    )

    assert response.status_code == 200
    task = response.json()
    assert task["start_date"] == "2026-07-06T00:00:00Z"
    assert task["due_date"] == "2026-07-08T00:00:00Z"
    assert task["is_all_day"] is True

    read_back = client.get("/api/v1/tasks").json()["items"][0]
    assert read_back["start_date"] == "2026-07-06T00:00:00Z"
    assert read_back["due_date"] == "2026-07-08T00:00:00Z"
    assert read_back["is_all_day"] is True


def test_dates_with_an_offset_are_normalized_to_utc(client: TestClient) -> None:
    response = client.post(
        "/api/v1/tasks",
        json={"title": "Call", "due_date": "2026-07-10T12:00:00+02:00"},
    )

    assert response.status_code == 201
    assert response.json()["due_date"] == "2026-07-10T10:00:00Z"


def test_schedule_can_be_cleared_with_explicit_nulls(client: TestClient) -> None:
    task_id = client.post(
        "/api/v1/tasks",
        json={
            "title": "Trip",
            "start_date": "2026-07-06T00:00:00Z",
            "due_date": "2026-07-08T00:00:00Z",
            "is_all_day": True,
            "time_zone": "Europe/Amsterdam",
        },
    ).json()["id"]

    response = client.patch(
        f"/api/v1/tasks/{task_id}",
        json={"start_date": None, "due_date": None, "is_all_day": False, "time_zone": None},
    )

    assert response.status_code == 200
    task = response.json()
    assert task["start_date"] is None
    assert task["due_date"] is None
    assert task["is_all_day"] is False
    assert task["time_zone"] is None


def test_start_date_without_a_due_date_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/v1/tasks",
        json={"title": "Dangling start", "start_date": "2026-07-10T14:00:00Z"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_schedule"


def test_clearing_only_the_due_date_while_a_start_remains_is_rejected(
    client: TestClient,
) -> None:
    task_id = client.post(
        "/api/v1/tasks",
        json={
            "title": "Design review",
            "start_date": "2026-07-10T14:00:00Z",
            "due_date": "2026-07-10T15:30:00Z",
        },
    ).json()["id"]

    response = client.patch(f"/api/v1/tasks/{task_id}", json={"due_date": None})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_schedule"


def test_a_start_after_the_due_date_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/v1/tasks",
        json={
            "title": "Backwards",
            "start_date": "2026-07-10T16:00:00Z",
            "due_date": "2026-07-10T15:00:00Z",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_schedule"


def test_patching_a_start_before_the_existing_due_date_is_accepted(client: TestClient) -> None:
    task_id = client.post(
        "/api/v1/tasks",
        json={"title": "Meeting", "due_date": "2026-07-10T15:00:00Z"},
    ).json()["id"]

    response = client.patch(f"/api/v1/tasks/{task_id}", json={"start_date": "2026-07-10T14:00:00Z"})

    assert response.status_code == 200
    assert response.json()["start_date"] == "2026-07-10T14:00:00Z"
    assert response.json()["due_date"] == "2026-07-10T15:00:00Z"


def test_an_unknown_timezone_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/v1/tasks",
        json={
            "title": "Lost",
            "due_date": "2026-07-10T15:00:00Z",
            "time_zone": "Mars/Olympus_Mons",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_schedule"


def test_is_all_day_may_not_be_null(client: TestClient) -> None:
    task_id = client.post("/api/v1/tasks", json={"title": "Flagged"}).json()["id"]

    response = client.patch(f"/api/v1/tasks/{task_id}", json={"is_all_day": None})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_a_timed_duration_may_not_span_days(client: TestClient) -> None:
    response = client.post(
        "/api/v1/tasks",
        json={
            "title": "Marathon",
            "start_date": "2026-07-10T23:00:00Z",
            "due_date": "2026-07-11T01:00:00Z",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_schedule"


def test_a_timed_duration_day_is_judged_in_the_task_timezone(client: TestClient) -> None:
    # 23:00Z-01:00Z crosses midnight UTC, but in Amsterdam (UTC+2 in July)
    # both instants fall on the same local day: 01:00-03:00.
    response = client.post(
        "/api/v1/tasks",
        json={
            "title": "Late show",
            "start_date": "2026-07-10T23:00:00Z",
            "due_date": "2026-07-11T01:00:00Z",
            "time_zone": "Europe/Amsterdam",
        },
    )

    assert response.status_code == 201


def test_an_all_day_task_requires_a_due_date(client: TestClient) -> None:
    response = client.post("/api/v1/tasks", json={"title": "Floating", "is_all_day": True})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_schedule"


def test_all_day_dates_must_be_date_only_at_midnight_utc(client: TestClient) -> None:
    response = client.post(
        "/api/v1/tasks",
        json={"title": "Sloppy", "due_date": "2026-07-08T15:30:00Z", "is_all_day": True},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_schedule"
