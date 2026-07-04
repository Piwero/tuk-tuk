"""The calendar range window: tasks whose scheduled days intersect it.

`range_start`/`range_end` are inclusive calendar days; a task's day window
is read in its own timezone (the same rule the Smart Lists use).
"""

from fastapi.testclient import TestClient

from tests.conftest import make_task


def window(client: TestClient, start: str, end: str, extra: str = "") -> list[str]:
    response = client.get(f"/api/v1/tasks?range_start={start}&range_end={end}{extra}")
    assert response.status_code == 200, response.text
    return [task["title"] for task in response.json()["items"]]


def test_the_window_keeps_dated_tasks_inside_and_drops_the_rest(client: TestClient) -> None:
    make_task(client, "Inside", due_date="2026-07-10T15:00:00Z")
    make_task(client, "Before", due_date="2026-06-30T15:00:00Z")
    make_task(client, "After", due_date="2026-08-01T15:00:00Z")
    make_task(client, "Undated")

    assert window(client, "2026-07-01", "2026-07-31") == ["Inside"]


def test_the_window_boundaries_are_inclusive(client: TestClient) -> None:
    make_task(client, "First day", due_date="2026-07-01T00:00:00Z", is_all_day=True)
    make_task(client, "Last day", due_date="2026-07-31T23:00:00Z")

    assert window(client, "2026-07-01", "2026-07-31") == ["First day", "Last day"]


def test_a_multi_day_span_crossing_the_window_edge_intersects(client: TestClient) -> None:
    make_task(
        client,
        "Across the edge",
        start_date="2026-06-28T00:00:00Z",
        due_date="2026-07-02T00:00:00Z",
        is_all_day=True,
    )
    make_task(
        client,
        "Fully before",
        start_date="2026-06-20T00:00:00Z",
        due_date="2026-06-25T00:00:00Z",
        is_all_day=True,
    )

    assert window(client, "2026-07-01", "2026-07-31") == ["Across the edge"]


def test_day_membership_is_read_in_the_tasks_timezone(client: TestClient) -> None:
    # 03:00 UTC on Aug 1 is still 23:00 on Jul 31 in New York.
    make_task(
        client,
        "Late night",
        due_date="2026-08-01T03:00:00Z",
        time_zone="America/New_York",
    )

    assert window(client, "2026-07-01", "2026-07-31") == ["Late night"]
    assert window(client, "2026-08-01", "2026-08-31") == []


def test_the_window_composes_with_the_completed_filter(client: TestClient) -> None:
    make_task(client, "Open", due_date="2026-07-10T15:00:00Z")
    done = make_task(client, "Done", due_date="2026-07-11T15:00:00Z")
    client.patch(f"/api/v1/tasks/{done['id']}", json={"completed": True})

    assert window(client, "2026-07-01", "2026-07-31", "&completed=false") == ["Open"]


def test_half_a_range_is_rejected(client: TestClient) -> None:
    response = client.get("/api/v1/tasks?range_start=2026-07-01")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_a_backwards_range_is_rejected(client: TestClient) -> None:
    response = client.get("/api/v1/tasks?range_start=2026-07-31&range_end=2026-07-01")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_a_smart_view_and_a_range_are_exclusive(client: TestClient) -> None:
    response = client.get("/api/v1/tasks?view=all&range_start=2026-07-01&range_end=2026-07-31")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_scheduled_false_lists_only_undated_tasks(client: TestClient) -> None:
    """The unscheduled panel's query: open tasks without a date."""
    make_task(client, "Dated", due_date="2026-07-10T15:00:00Z")
    make_task(client, "All-day", due_date="2026-07-12T00:00:00Z", is_all_day=True)
    make_task(client, "Undated open")
    done = make_task(client, "Undated done")
    client.patch(f"/api/v1/tasks/{done['id']}", json={"completed": True})

    response = client.get("/api/v1/tasks?scheduled=false&completed=false")

    assert response.status_code == 200, response.text
    assert [task["title"] for task in response.json()["items"]] == ["Undated open"]


def test_scheduled_true_lists_only_dated_tasks(client: TestClient) -> None:
    make_task(client, "Dated", due_date="2026-07-10T15:00:00Z")
    make_task(client, "Undated")

    response = client.get("/api/v1/tasks?scheduled=true")

    assert response.status_code == 200, response.text
    assert [task["title"] for task in response.json()["items"]] == ["Dated"]


def test_the_scheduled_filter_is_exclusive_with_views_and_ranges(client: TestClient) -> None:
    for query in (
        "scheduled=false&view=all",
        "scheduled=false&range_start=2026-07-01&range_end=2026-07-31",
    ):
        response = client.get(f"/api/v1/tasks?{query}")

        assert response.status_code == 422, query
        assert response.json()["error"]["code"] == "validation_error"
