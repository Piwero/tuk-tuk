"""The Assistant's chat turn (ADR 0009; issue #187).

Mirrors test_assist.py's/test_assistant.py's seam: a real localhost HTTP
server stands in for an OpenAI-compatible provider's `/chat/completions`,
so these tests exercise the real outbound httpx call rather than mocking
the transport.
"""

import json
import socket
import threading
import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from app import assistant_chat
from tests.conftest import FakeClock
from tests.test_assistant import make_client


def _chat_completion_body(content: object) -> bytes:
    return json.dumps({"choices": [{"message": {"content": json.dumps(content)}}]}).encode()


class _ChatHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/chat/completions":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        delay = self.server.delay_seconds  # type: ignore[attr-defined]
        if delay:
            time.sleep(delay)
        response = self.server.response  # type: ignore[attr-defined]
        if response is None:
            # Simulate an unreachable/broken provider mid-request.
            self.send_response(500)
            self.end_headers()
            return
        status, body = response
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass


class StubChatProvider:
    """A real HTTP server standing in for an OpenAI-compatible provider's
    `POST /chat/completions` — the seam issue #187 asks for, following
    `test_assist.py`'s `StubOllama` precedent of a real server over a
    mocked transport."""

    def __init__(self) -> None:
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _ChatHandler)
        self._server.response = None  # type: ignore[attr-defined]
        self._server.delay_seconds = 0.0  # type: ignore[attr-defined]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def set_delay(self, seconds: float) -> None:
        self._server.delay_seconds = seconds  # type: ignore[attr-defined]

    @property
    def base_url(self) -> str:
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    def set_json_content(self, content: object, status: int = 200) -> None:
        self._server.response = (status, _chat_completion_body(content))  # type: ignore[attr-defined]

    def set_raw_content(self, raw_content: str, status: int = 200) -> None:
        body = json.dumps({"choices": [{"message": {"content": raw_content}}]}).encode()
        self._server.response = (status, body)  # type: ignore[attr-defined]

    def stop(self) -> None:
        self._server.shutdown()
        self._thread.join()


@pytest.fixture
def stub_chat() -> Iterator[StubChatProvider]:
    stub = StubChatProvider()
    yield stub
    stub.stop()


def _closed_port_url() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return f"http://127.0.0.1:{port}"


def _configure(client: TestClient, base_url: str, api_key: str = "sk-test") -> None:
    response = client.put(
        "/api/v1/assistant/config",
        json={"base_url": base_url, "model": "gpt-4o-mini", "api_key": api_key},
    )
    assert response.status_code == 200, response.text


def _chat(client: TestClient, text: str = "plan my day") -> dict:
    response = client.post(
        "/api/v1/assistant/chat",
        json={
            "transcript": [{"role": "user", "content": text}],
            "local_date": datetime.now(UTC).date().isoformat(),
            "time_zone": "UTC",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def make_task(client: TestClient, title: str, due_in_days: int = 1) -> int:
    due = datetime.now(UTC) + timedelta(days=due_in_days)
    response = client.post(
        "/api/v1/tasks",
        json={"title": title, "due_date": due.isoformat()},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


class TestRequestValidation:
    def test_an_unknown_timezone_is_a_422_not_a_500(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            response = client.post(
                "/api/v1/assistant/chat",
                json={
                    "transcript": [{"role": "user", "content": "plan my day"}],
                    "local_date": "2024-06-10",
                    "time_zone": "Not/AZone",
                },
            )

        assert response.status_code == 422


class TestUnconfiguredAndUnreachable:
    def test_degrades_when_unconfigured(self, database_url: str, fake_clock: FakeClock) -> None:
        with make_client(database_url, fake_clock) as client:
            body = _chat(client)

        assert body["suggestions"] == []
        assert body["discarded_count"] == 0
        assert "assistant" in body["message"].lower() or body["message"]

    def test_degrades_when_provider_is_unreachable(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            _configure(client, _closed_port_url())
            body = _chat(client)

        assert body["suggestions"] == []
        assert body["discarded_count"] == 0

    def test_degrades_on_timeout(
        self,
        database_url: str,
        fake_clock: FakeClock,
        stub_chat: StubChatProvider,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Exercises the real `_TIMEOUT_SECONDS` wiring against a real,
        # slow-responding server (the seam issue #187 asks for), rather
        # than mocking the transport to raise a timeout directly — the
        # timeout budget itself is shrunk so the test doesn't wait 30s.
        monkeypatch.setattr(assistant_chat, "_TIMEOUT_SECONDS", 0.05)
        stub_chat.set_delay(0.3)
        stub_chat.set_json_content({"message": "too slow", "suggestions": []})

        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_chat.base_url)
            body = _chat(client)

        assert body["suggestions"] == []
        assert body["discarded_count"] == 0

    def test_degrades_on_malformed_json(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider
    ) -> None:
        stub_chat.set_raw_content("not json{")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_chat.base_url)
            body = _chat(client)

        assert body["suggestions"] == []
        assert body["discarded_count"] == 0


class TestWellFormedSuggestions:
    def test_well_formed_suggestions_pass_validation(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            task_id = make_task(client, "Write report")
            stub_chat.set_json_content(
                {
                    "message": "Here's a plan.",
                    "suggestions": [
                        {
                            "type": "create_task",
                            "task_id": None,
                            "title": "Buy groceries",
                            "list_name": None,
                            "tag_names": [],
                            "priority": "high",
                            "start_date": None,
                            "due_date": None,
                            "is_all_day": None,
                            "time_zone": None,
                            "check_item_titles": [],
                        },
                        {
                            "type": "complete_task",
                            "task_id": task_id,
                            "title": None,
                            "list_name": None,
                            "tag_names": [],
                            "priority": None,
                            "start_date": None,
                            "due_date": None,
                            "is_all_day": None,
                            "time_zone": None,
                            "check_item_titles": [],
                        },
                    ],
                }
            )
            _configure(client, stub_chat.base_url)
            body = _chat(client)

        assert body["message"] == "Here's a plan."
        assert body["discarded_count"] == 0
        types = {s["type"] for s in body["suggestions"]}
        assert types == {"create_task", "complete_task"}

    def test_empty_suggestions_is_fine(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider
    ) -> None:
        stub_chat.set_json_content({"message": "Looks like a light day.", "suggestions": []})
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_chat.base_url)
            body = _chat(client)

        assert body == {
            "message": "Looks like a light day.",
            "suggestions": [],
            "discarded_count": 0,
        }

    def test_task_id_outside_the_snapshot_is_rejected(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider
    ) -> None:
        stub_chat.set_json_content(
            {
                "message": "Done.",
                "suggestions": [
                    {
                        "type": "complete_task",
                        "task_id": 999999,
                        "title": None,
                        "list_name": None,
                        "tag_names": [],
                        "priority": None,
                        "start_date": None,
                        "due_date": None,
                        "is_all_day": None,
                        "time_zone": None,
                        "check_item_titles": [],
                    }
                ],
            }
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_chat.base_url)
            body = _chat(client)

        assert body["suggestions"] == []
        assert body["discarded_count"] == 1

    def test_set_list_resolves_only_against_snapshot_names(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            task_id = make_task(client, "Write report")
            stub_chat.set_json_content(
                {
                    "message": "Filed it.",
                    "suggestions": [
                        {
                            "type": "set_list",
                            "task_id": task_id,
                            "title": None,
                            "list_name": "Nonexistent List",
                            "tag_names": [],
                            "priority": None,
                            "start_date": None,
                            "due_date": None,
                            "is_all_day": None,
                            "time_zone": None,
                            "check_item_titles": [],
                        }
                    ],
                }
            )
            _configure(client, stub_chat.base_url)
            body = _chat(client)

        assert body["suggestions"] == []
        assert body["discarded_count"] == 1

    def test_add_tags_resolves_only_against_snapshot_names(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            task_id = make_task(client, "Write report")
            tag_response = client.post("/api/v1/tags", json={"name": "urgent"})
            assert tag_response.status_code == 201, tag_response.text
            stub_chat.set_json_content(
                {
                    "message": "Tagged it.",
                    "suggestions": [
                        {
                            "type": "add_tags",
                            "task_id": task_id,
                            "title": None,
                            "list_name": None,
                            "tag_names": ["urgent"],
                            "priority": None,
                            "start_date": None,
                            "due_date": None,
                            "is_all_day": None,
                            "time_zone": None,
                            "check_item_titles": [],
                        }
                    ],
                }
            )
            _configure(client, stub_chat.base_url)
            body = _chat(client)

        assert body["discarded_count"] == 0
        assert body["suggestions"] == [
            {"type": "add_tags", "task_id": task_id, "tag_names": ["urgent"]}
        ]

    def test_delete_is_not_a_representable_suggestion_type(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            task_id = make_task(client, "Write report")
            stub_chat.set_json_content(
                {
                    "message": "Deleted it.",
                    "suggestions": [
                        {
                            "type": "delete_task",
                            "task_id": task_id,
                            "title": None,
                            "list_name": None,
                            "tag_names": [],
                            "priority": None,
                            "start_date": None,
                            "due_date": None,
                            "is_all_day": None,
                            "time_zone": None,
                            "check_item_titles": [],
                        }
                    ],
                }
            )
            _configure(client, stub_chat.base_url)
            body = _chat(client)

        assert body["suggestions"] == []
        assert body["discarded_count"] == 1


class TestBilingual:
    @pytest.mark.parametrize("text", ["plan my day", "planifica mi dia"])
    def test_english_and_spanish_both_produce_suggestions(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider, text: str
    ) -> None:
        stub_chat.set_json_content(
            {
                "message": "Plan de acción" if "planifica" in text else "Here's a plan",
                "suggestions": [
                    {
                        "type": "create_task",
                        "task_id": None,
                        "title": "Comprar leche" if "planifica" in text else "Buy milk",
                        "list_name": None,
                        "tag_names": [],
                        "priority": None,
                        "start_date": None,
                        "due_date": None,
                        "is_all_day": None,
                        "time_zone": None,
                        "check_item_titles": [],
                    }
                ],
            }
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_chat.base_url)
            body = _chat(client, text=text)

        assert body["discarded_count"] == 0
        assert len(body["suggestions"]) == 1
