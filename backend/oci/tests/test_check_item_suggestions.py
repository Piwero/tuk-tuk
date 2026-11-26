"""Selected Task assistance, through HTTP and real fake-provider transport."""

import json
from threading import Barrier, Thread
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from tests.conftest import create_user_row, log_in, log_in_admin
from tests.test_assistant_chat import StubChatProvider, _configure


def test_selected_context_has_no_week_preferences_transcript_or_tools(client: TestClient) -> None:
    task = client.post(
        "/api/v1/tasks", json={"title": "Pack bags", "description": "Only this text"}
    ).json()
    client.post("/api/v1/tasks", json={"title": "PRIVATE unrelated task"})
    client.post(f"/api/v1/tasks/{task['id']}/check-items", json={"title": "Pack socks"})
    stub = StubChatProvider()
    try:
        _configure(client, stub.base_url)
        client.put("/api/v1/assistant/config", json={"planning_preferences": "PRIVATE preferences"})
        stub.set_json_content(
            {
                "message": "Steps",
                "suggestions": [
                    {
                        "type": "add_check_items",
                        "task_id": task["id"],
                        "check_item_titles": ["Pack charger"],
                    }
                ],
            }
        )
        result = client.post(
            "/api/v1/assistant/check-item-suggestions",
            json={"task_id": task["id"], "count": 3, "instruction": "Small steps"},
        )
        assert result.status_code == 200, result.text
        assert result.json()["suggestions"][0]["check_item_titles"] == ["Pack charger"]
        sent = stub.request_at(0)
        assert "tools" not in sent
        text = json.dumps(sent["messages"])
        assert "Only this text" in text
        assert "Pack socks" in text
        assert "PRIVATE" not in text
        assert (
            client.get(f"/api/v1/tasks/{task['id']}").json()["check_items"][0]["title"]
            == "Pack socks"
        )
    finally:
        stub.stop()


def test_selected_context_reuses_provider_compatibility_retry(client: TestClient) -> None:
    task = client.post("/api/v1/tasks", json={"title": "Pack"}).json()
    stub = StubChatProvider()
    try:
        _configure(client, stub.base_url)
        stub.set_responses(
            [
                (400, b'{"error": "Set reasoning_effort to none"}'),
                (
                    200,
                    json.dumps(
                        {
                            "choices": [
                                {
                                    "message": {
                                        "content": json.dumps(
                                            {
                                                "message": "Steps",
                                                "suggestions": [
                                                    {
                                                        "type": "add_check_items",
                                                        "task_id": task["id"],
                                                        "check_item_titles": ["Pack socks"],
                                                    }
                                                ],
                                            }
                                        )
                                    }
                                }
                            ]
                        }
                    ).encode(),
                ),
            ]
        )
        result = client.post(
            "/api/v1/assistant/check-item-suggestions", json={"task_id": task["id"]}
        )
        assert result.status_code == 200, result.text
        assert stub.request_count == 2
        assert stub.request_at(1)["reasoning_effort"] == "none"
        assert all("tools" not in stub.request_at(i) for i in range(2))
    finally:
        stub.stop()


@pytest.mark.parametrize("padding", ["", " " * 65536])
def test_selected_context_rejects_oversized_envelope_and_tool_calls(
    client: TestClient, padding: str
) -> None:
    task = client.post("/api/v1/tasks", json={"title": "Pack"}).json()
    stub = StubChatProvider()
    try:
        _configure(client, stub.base_url)
        message = {"content": '{"message":"Steps","suggestions":[]}'}
        if not padding:
            message["tool_calls"] = [{"id": "unavailable"}]
        body = json.dumps({"choices": [{"message": message}], "padding": padding}).encode()
        stub.set_responses([(200, body)])
        response = client.post(
            "/api/v1/assistant/check-item-suggestions", json={"task_id": task["id"]}
        )
        assert response.status_code == 503
        assert client.get(f"/api/v1/tasks/{task['id']}").json()["check_items"] == []
    finally:
        stub.stop()


def test_each_check_item_creation_replays_after_unknown_outcome(client: TestClient) -> None:
    task = client.post("/api/v1/tasks", json={"title": "Pack"}).json()
    path = f"/api/v1/tasks/{task['id']}/check-items"
    key = str(uuid4())
    first = client.post(path, json={"title": "Pack socks", "request_id": key})
    assert first.status_code == 201
    replay = client.post(path, json={"title": "Pack socks", "request_id": key})
    assert replay.status_code == 201
    assert len(replay.json()["check_items"]) == 1
    conflict = client.post(path, json={"title": "Pack shoes", "request_id": key})
    assert conflict.status_code == 409
    independent = client.post(path, json={"title": "Pack socks", "request_id": str(uuid4())})
    assert len(independent.json()["check_items"]) == 2
    first_id = first.json()["check_items"][0]["id"]
    client.delete(f"{path}/{first_id}")
    assert (
        len(
            client.post(path, json={"title": "Pack socks", "request_id": key}).json()["check_items"]
        )
        == 1
    )


def test_concurrent_retries_create_one_check_item(client: TestClient) -> None:
    task = client.post("/api/v1/tasks", json={"title": "Concurrent"}).json()
    path = f"/api/v1/tasks/{task['id']}/check-items"
    key = str(uuid4())

    barrier = Barrier(3, timeout=10)
    status_codes: list[int] = []

    def create() -> None:
        barrier.wait()
        response = client.post(path, json={"title": "Pack socks", "request_id": key})
        status_codes.append(response.status_code)

    threads = [Thread(target=create) for _ in range(2)]
    for thread in threads:
        thread.start()
    barrier.wait()
    for thread in threads:
        thread.join(timeout=15)
        assert not thread.is_alive()
    assert status_codes == [201, 201]
    assert len(client.get(f"/api/v1/tasks/{task['id']}").json()["check_items"]) == 1


@pytest.mark.parametrize(
    ("titles", "foreign_id"),
    [(["x"] * 4, False), (["x" * 501], False), ([""], False), (["x"], True)],
)
def test_invalid_output_cannot_be_accepted(
    client: TestClient, titles: list[str], foreign_id: bool
) -> None:
    task = client.post("/api/v1/tasks", json={"title": "Pack"}).json()
    stub = StubChatProvider()
    try:
        _configure(client, stub.base_url)
        stub.set_json_content(
            {
                "message": "Steps",
                "suggestions": [
                    {
                        "type": "add_check_items",
                        "task_id": task["id"] + 1 if foreign_id else task["id"],
                        "check_item_titles": titles,
                    }
                ],
            }
        )
        result = client.post(
            "/api/v1/assistant/check-item-suggestions", json={"task_id": task["id"], "count": 3}
        )
        assert result.status_code == 503
        assert client.get(f"/api/v1/tasks/{task['id']}").json()["check_items"] == []
    finally:
        stub.stop()


def test_foreign_context_rejected_before_provider_and_receipts_are_user_scoped(
    client: TestClient,
) -> None:
    task_a = client.post("/api/v1/tasks", json={"title": "A private"}).json()
    key = str(uuid4())
    client.post(
        f"/api/v1/tasks/{task_a['id']}/check-items", json={"title": "A step", "request_id": key}
    )
    create_user_row(client, username="other", email="other@example.com")
    log_in(client, "other")
    assert (
        client.post(
            "/api/v1/assistant/check-item-suggestions", json={"task_id": task_a["id"]}
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/v1/tasks/{task_a['id']}/check-items", json={"title": "A step", "request_id": key}
        ).status_code
        == 404
    )
    task_b = client.post("/api/v1/tasks", json={"title": "B private"}).json()
    result = client.post(
        f"/api/v1/tasks/{task_b['id']}/check-items", json={"title": "B step", "request_id": key}
    )
    assert result.status_code == 201
    assert [item["title"] for item in result.json()["check_items"]] == ["B step"]
    log_in_admin(client)
    assert [
        item["title"] for item in client.get(f"/api/v1/tasks/{task_a['id']}").json()["check_items"]
    ] == ["A step"]
