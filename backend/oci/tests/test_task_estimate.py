"""Duration estimate (issue #563, review): an optional, nullable number of
minutes on a Task, used only for work planning. It is never required, never
inferred, and set only by the User through `PATCH /tasks/{id}`.
"""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import create_user_row, log_in, make_task


def estimate(client: TestClient, task_id: int, minutes: object) -> dict:
    response = client.patch(f"/api/v1/tasks/{task_id}", json={"estimate_minutes": minutes})
    assert response.status_code == 200, response.text
    return response.json()


def test_a_new_task_has_no_estimate(client: TestClient) -> None:
    assert make_task(client, "Plain")["estimate_minutes"] is None


def test_an_estimate_is_saved_and_read_back(client: TestClient) -> None:
    task = make_task(client, "Report")

    assert estimate(client, task["id"], 45)["estimate_minutes"] == 45
    assert client.get(f"/api/v1/tasks/{task['id']}").json()["estimate_minutes"] == 45


def test_leaving_it_out_of_a_patch_keeps_it_and_null_clears_it(client: TestClient) -> None:
    task = make_task(client, "Report")
    estimate(client, task["id"], 30)

    renamed = client.patch(f"/api/v1/tasks/{task['id']}", json={"title": "Report v2"}).json()
    assert renamed["estimate_minutes"] == 30

    assert estimate(client, task["id"], None)["estimate_minutes"] is None


def test_an_estimate_is_independent_of_planned_work(client: TestClient) -> None:
    """Planned work has its own duration; the estimate is never derived from
    it, and removing the plan leaves the estimate alone."""
    task = make_task(client, "Report")
    estimate(client, task["id"], 30)
    plan = {
        "start": "2026-07-08T07:00:00Z",
        "duration_minutes": 90,
        "time_zone": "UTC",
        "buffer_minutes": None,
    }

    planned = client.patch(f"/api/v1/tasks/{task['id']}", json={"planned_work": plan}).json()
    assert planned["estimate_minutes"] == 30
    cleared = client.patch(f"/api/v1/tasks/{task['id']}", json={"planned_work": None}).json()
    assert cleared["estimate_minutes"] == 30


@pytest.mark.parametrize("minutes", [0, -15, 7 * 24 * 60 + 1, 1.5, "soon"])
def test_an_estimate_must_be_a_positive_whole_number_of_minutes(
    client: TestClient, minutes: object
) -> None:
    task = make_task(client, "Report")

    response = client.patch(f"/api/v1/tasks/{task['id']}", json={"estimate_minutes": minutes})

    assert response.status_code == 422
    assert client.get(f"/api/v1/tasks/{task['id']}").json()["estimate_minutes"] is None


def test_another_users_task_cannot_be_estimated(client: TestClient) -> None:
    task = make_task(client, "Admin's")
    create_user_row(client, "bea", "bea@example.com")
    log_in(client, "bea")

    response = client.patch(f"/api/v1/tasks/{task['id']}", json={"estimate_minutes": 30})

    assert response.status_code == 404
