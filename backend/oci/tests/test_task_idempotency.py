from concurrent.futures import ThreadPoolExecutor

import pytest

from tests.conftest import FakeClock, create_user_row, log_in
from tests.test_assistant import make_client

REQUEST_ID = "d82c02da-7e1d-4f6e-90d9-cff89b7fed2a"


def test_task_create_request_id_replays_same_task(database_url: str, fake_clock: FakeClock) -> None:
    with make_client(database_url, fake_clock) as client:
        first = client.post(
            "/api/v1/tasks", json={"title": "Call dentist", "create_request_id": REQUEST_ID}
        )
        second = client.post(
            "/api/v1/tasks", json={"title": "Call dentist", "create_request_id": REQUEST_ID}
        )
    assert first.status_code == second.status_code == 201
    assert first.json()["id"] == second.json()["id"]


def test_concurrent_task_acceptance_creates_one_task(
    database_url: str, fake_clock: FakeClock
) -> None:
    with make_client(database_url, fake_clock) as client:

        def accept(_: int):
            return client.post(
                "/api/v1/tasks", json={"title": "Same title", "create_request_id": REQUEST_ID}
            )

        with ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(accept, range(8)))
        assert all(response.status_code == 201 for response in responses)
        assert len({response.json()["id"] for response in responses}) == 1
        assert client.get("/api/v1/tasks").json()["total"] == 1


def test_task_request_keys_are_user_scoped(database_url: str, fake_clock: FakeClock) -> None:
    with make_client(database_url, fake_clock) as client:
        first = client.post(
            "/api/v1/tasks", json={"title": "Private A", "create_request_id": REQUEST_ID}
        ).json()
        create_user_row(client, username="other", email="other@example.test")
        log_in(client, login="other")
        second = client.post(
            "/api/v1/tasks", json={"title": "Private B", "create_request_id": REQUEST_ID}
        ).json()
        assert second["id"] != first["id"]
        assert client.get(f"/api/v1/tasks/{first['id']}").status_code == 404
        assert [item["title"] for item in client.get("/api/v1/tasks").json()["items"]] == [
            "Private B"
        ]
        assert (
            client.post("/api/v1/assistant/brain-dump", json={"text": "A private text"}).json()[
                "suggestions"
            ]
            == []
        )


@pytest.mark.parametrize("key", ["-" * 36, "not-a-uuid", "x" * 36])
def test_invalid_task_request_key_rejected(
    database_url: str, fake_clock: FakeClock, key: str
) -> None:
    with make_client(database_url, fake_clock) as client:
        response = client.post("/api/v1/tasks", json={"title": "Task", "create_request_id": key})
    assert response.status_code == 422
