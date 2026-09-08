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
from app.assistant_chat import _normalize_schedule
from tests.conftest import FakeClock
from tests.test_assistant import make_client


def _chat_completion_body(content: object) -> bytes:
    return json.dumps({"choices": [{"message": {"content": json.dumps(content)}}]}).encode()


def _tool_call_body(tool_calls: list[dict]) -> bytes:
    """A `/chat/completions` body whose message asks for tool calls rather
    than answering — the shape a real provider sends mid-loop."""
    message = {"role": "assistant", "content": None, "tool_calls": tool_calls}
    return json.dumps({"choices": [{"message": message}]}).encode()


def _make_tool_call(call_id: str, name: str, arguments: dict) -> dict:
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments)},
    }


class _ChatHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/chat/completions":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length)
        self.server.request_bodies.append(json.loads(raw_body))  # type: ignore[attr-defined]
        delay = self.server.delay_seconds  # type: ignore[attr-defined]
        if delay:
            time.sleep(delay)
        responses: list[tuple[int, bytes] | None] = self.server.responses  # type: ignore[attr-defined]
        call_index = len(self.server.request_bodies) - 1  # type: ignore[attr-defined]
        response = responses[min(call_index, len(responses) - 1)] if responses else None
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
    mocked transport.

    `set_responses` holds a *sequence* of canned responses, one per call
    (issue #189: a tool-calling loop makes more than one round trip per
    turn) — the last entry repeats for any call beyond the sequence's
    length, so a cap-hit test can just supply tool-call responses and let
    the loop exhaust its own cap."""

    def __init__(self) -> None:
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _ChatHandler)
        self._server.responses = []  # type: ignore[attr-defined]
        self._server.request_bodies = []  # type: ignore[attr-defined]
        self._server.delay_seconds = 0.0  # type: ignore[attr-defined]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def set_delay(self, seconds: float) -> None:
        self._server.delay_seconds = seconds  # type: ignore[attr-defined]

    @property
    def base_url(self) -> str:
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    @property
    def request_count(self) -> int:
        return len(self._server.request_bodies)  # type: ignore[attr-defined]

    def request_at(self, index: int) -> dict:
        return self._server.request_bodies[index]  # type: ignore[attr-defined]

    def set_json_content(self, content: object, status: int = 200) -> None:
        self._server.responses = [(status, _chat_completion_body(content))]  # type: ignore[attr-defined]

    def set_raw_content(self, raw_content: str, status: int = 200) -> None:
        body = json.dumps({"choices": [{"message": {"content": raw_content}}]}).encode()
        self._server.responses = [(status, body)]  # type: ignore[attr-defined]

    def set_responses(self, responses: list[tuple[int, bytes]]) -> None:
        self._server.responses = list(responses)  # type: ignore[attr-defined]

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


class TestScheduleNormalization:
    """A model that answers "tomorrow at 9 a.m." with a lone start_date used
    to produce a card that failed on apply ("A start date requires a due
    date"). The Suggestion is bent into a schedule the v1 invariants accept
    instead."""

    def test_a_lone_start_becomes_a_due_date(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider
    ) -> None:
        stub_chat.set_json_content(
            {
                "message": "I'll plan this for tomorrow at 9:00 a.m.",
                "suggestions": [
                    {
                        "type": "create_task",
                        "task_id": None,
                        "title": "Promote tag to latest environment",
                        "list_name": None,
                        "tag_names": [],
                        "priority": None,
                        "start_date": "2024-01-02T09:00:00+00:00",
                        "due_date": None,
                        "is_all_day": None,
                        "time_zone": "Europe/Madrid",
                        "check_item_titles": [],
                    }
                ],
            }
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_chat.base_url)
            body = _chat(client)
            suggestion = body["suggestions"][0]
            assert suggestion["due_date"] == "2024-01-02T09:00:00Z"
            assert suggestion["start_date"] == "2024-01-02T09:00:00Z"

            response = client.post(
                "/api/v1/tasks",
                json={
                    "title": suggestion["title"],
                    "start_date": suggestion["start_date"],
                    "due_date": suggestion["due_date"],
                    "is_all_day": suggestion["is_all_day"],
                    "time_zone": suggestion["time_zone"],
                },
            )
            assert response.status_code == 201, response.text

    def test_a_lone_start_on_a_schedule_task_becomes_a_due_date(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            task_id = make_task(client, "Write report")
            stub_chat.set_json_content(
                {
                    "message": "Scheduled.",
                    "suggestions": [
                        {
                            "type": "schedule_task",
                            "task_id": task_id,
                            "title": None,
                            "list_name": None,
                            "tag_names": [],
                            "priority": None,
                            "start_date": "2024-01-02T09:00:00Z",
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
            suggestion = body["suggestions"][0]
            assert suggestion["due_date"] == "2024-01-02T09:00:00Z"

            response = client.patch(
                f"/api/v1/tasks/{task_id}",
                json={
                    "start_date": suggestion["start_date"],
                    "due_date": suggestion["due_date"],
                    "is_all_day": suggestion["is_all_day"],
                    "time_zone": suggestion["time_zone"],
                },
            )
            assert response.status_code == 200, response.text


class TestNormalizeScheduleUnits:
    def test_an_inverted_pair_is_swapped(self) -> None:
        start, due, all_day, zone = _normalize_schedule(
            "2024-01-02T17:00:00Z", "2024-01-02T09:00:00Z", False, "UTC"
        )
        assert start is not None
        assert due is not None
        assert start < due
        assert (all_day, zone) == (False, "UTC")

    def test_all_day_values_are_floored_to_midnight(self) -> None:
        start, due, all_day, _ = _normalize_schedule(None, "2024-01-02T09:30:00Z", True, None)
        assert due is not None
        assert due.hour == 0
        assert due.minute == 0
        assert start is None
        assert all_day is True

    def test_a_timed_pair_across_two_local_days_keeps_only_the_due(self) -> None:
        start, due, _, _ = _normalize_schedule(
            "2024-01-02T09:00:00Z", "2024-01-05T09:00:00Z", False, "UTC"
        )
        assert start is None
        assert due is not None
        assert due.day == 5

    def test_an_unknown_timezone_is_dropped_not_fatal(self) -> None:
        _, due, _, zone = _normalize_schedule("2024-01-02T09:00:00Z", None, False, "Mars/Olympus")
        assert zone is None
        assert due is not None

    def test_an_unparseable_date_is_dropped(self) -> None:
        start, due, all_day, _ = _normalize_schedule("not a date", None, True, None)
        assert (start, due, all_day) == (None, None, False)


class TestReadOnlyTools:
    """Issue #189: read-only drill-down tools. A well-formed turn stays
    zero-tool (the snapshot remains the default path); a tool round trip
    can happen; the cap degrades rather than fails; a tool error degrades
    into the turn rather than failing it; and a task id a tool surfaces
    joins the writable allow-list (the module's explicit decision)."""

    def test_a_well_formed_turn_makes_exactly_one_request(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider
    ) -> None:
        stub_chat.set_json_content({"message": "Looks quiet.", "suggestions": []})
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_chat.base_url)
            body = _chat(client)

        assert stub_chat.request_count == 1
        assert body["message"] == "Looks quiet."

    def test_a_single_tool_call_round_trip_surfaces_a_usable_task_id(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            # A task due last week — outside the snapshot's next-7-days
            # window, so only `find_tasks` can surface its id.
            last_week_id = make_task(client, "Overdue report", due_in_days=-7)

            tool_call = _make_tool_call(
                "call_1",
                "find_tasks",
                {"range_start": "2000-01-01", "range_end": "2999-01-01", "completed": None},
            )
            stub_chat.set_responses(
                [
                    (200, _tool_call_body([tool_call])),
                    (
                        200,
                        _chat_completion_body(
                            {
                                "message": "Found something you dropped.",
                                "suggestions": [
                                    {
                                        "type": "reschedule_task",
                                        "task_id": last_week_id,
                                        "title": None,
                                        "list_name": None,
                                        "tag_names": [],
                                        "priority": None,
                                        "start_date": None,
                                        "due_date": "2024-06-10T09:00:00Z",
                                        "is_all_day": None,
                                        "time_zone": None,
                                        "check_item_titles": [],
                                    }
                                ],
                            }
                        ),
                    ),
                ]
            )
            _configure(client, stub_chat.base_url)
            body = _chat(client, text="what did I drop last week?")

        assert stub_chat.request_count == 2
        assert body["discarded_count"] == 0
        assert body["suggestions"] == [
            {
                "type": "reschedule_task",
                "task_id": last_week_id,
                "start_date": None,
                "due_date": "2024-06-10T09:00:00Z",
                "is_all_day": False,
                "time_zone": None,
            }
        ]

        # The second request carries the tool result as context — the
        # loop really did feed it back, not just happen to answer right.
        second_request = stub_chat.request_at(1)
        tool_messages = [m for m in second_request["messages"] if m.get("role") == "tool"]
        assert len(tool_messages) == 1
        tool_result = json.loads(tool_messages[0]["content"])
        assert any(task["id"] == last_week_id for task in tool_result["tasks"])

    def test_a_task_id_never_surfaced_by_any_tool_is_still_rejected(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider
    ) -> None:
        """The allow-list widens only by what a tool actually returned this
        turn — not by every id in the database."""
        with make_client(database_url, fake_clock) as client:
            other_task_id = make_task(client, "Unrelated task", due_in_days=-7)
            tool_call = _make_tool_call(
                "call_1",
                "habit_status",
                {"habit_name": "Nonexistent habit"},
            )
            stub_chat.set_responses(
                [
                    (200, _tool_call_body([tool_call])),
                    (
                        200,
                        _chat_completion_body(
                            {
                                "message": "Done.",
                                "suggestions": [
                                    {
                                        "type": "complete_task",
                                        "task_id": other_task_id,
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
                        ),
                    ),
                ]
            )
            _configure(client, stub_chat.base_url)
            body = _chat(client)

        assert body["suggestions"] == []
        assert body["discarded_count"] == 1

    def test_reaching_the_iteration_cap_degrades_rather_than_fails(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider
    ) -> None:
        # A model that never stops asking for tools: every response asks
        # for another find_tasks call, and never answers.
        tool_call = _make_tool_call(
            "call_x", "find_tasks", {"range_start": "2024-01-01", "range_end": "2024-01-02"}
        )
        stub_chat.set_responses([(200, _tool_call_body([tool_call]))])

        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_chat.base_url)
            body = _chat(client)

        # 3 tool round trips is the cap; the 4th completion call is the one
        # that hits it — never a 5th.
        assert stub_chat.request_count == 4
        assert body["suggestions"] == []
        assert body["discarded_count"] == 0
        # A distinct message from an unreachable provider's — the provider
        # answered every time, it just never stopped asking for tools.
        assert body["message"] == assistant_chat._TOOL_CAP_MESSAGE
        assert body["message"] != assistant_chat._FALLBACK_MESSAGE

    def test_the_timeout_bounds_the_whole_loop_not_just_one_call(
        self,
        database_url: str,
        fake_clock: FakeClock,
        stub_chat: StubChatProvider,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Two calls, each individually fast enough, but together longer
        # than the shrunk timeout budget — proves one deadline covers the
        # whole turn rather than resetting per completion call.
        monkeypatch.setattr(assistant_chat, "_TIMEOUT_SECONDS", 0.15)
        stub_chat.set_delay(0.1)
        tool_call = _make_tool_call(
            "call_1", "find_tasks", {"range_start": "2024-01-01", "range_end": "2024-01-02"}
        )
        stub_chat.set_responses(
            [
                (200, _tool_call_body([tool_call])),
                (200, _chat_completion_body({"message": "Done.", "suggestions": []})),
            ]
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_chat.base_url)
            body = _chat(client)

        assert body["suggestions"] == []
        assert body["discarded_count"] == 0

    def test_a_tool_call_that_errors_still_completes_the_turn(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider
    ) -> None:
        # An unknown tool name and a malformed find_tasks call, in the same
        # round — both degrade to an error result rather than failing.
        bad_calls = [
            _make_tool_call("call_1", "delete_everything", {}),
            _make_tool_call("call_2", "find_tasks", {"range_start": "not-a-date"}),
        ]
        stub_chat.set_responses(
            [
                (200, _tool_call_body(bad_calls)),
                (
                    200,
                    _chat_completion_body(
                        {"message": "Here's what I could find.", "suggestions": []}
                    ),
                ),
            ]
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_chat.base_url)
            body = _chat(client)

        assert stub_chat.request_count == 2
        assert body["message"] == "Here's what I could find."
        assert body["suggestions"] == []

    def test_habit_status_tool_reports_a_streak(
        self, database_url: str, fake_clock: FakeClock, stub_chat: StubChatProvider
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            response = client.post(
                "/api/v1/habits", json={"name": "Meditate", "frequency": "FREQ=DAILY"}
            )
            assert response.status_code == 201, response.text
            habit_id = response.json()["id"]
            today = datetime.now(UTC).date()
            check_in = client.put(
                f"/api/v1/habits/{habit_id}/check-ins/{today.isoformat()}",
                json={"value": 1.0},
            )
            assert check_in.status_code == 200, check_in.text

            tool_call = _make_tool_call("call_1", "habit_status", {"habit_name": "Meditate"})
            stub_chat.set_responses(
                [
                    (200, _tool_call_body([tool_call])),
                    (
                        200,
                        _chat_completion_body(
                            {"message": "You're on a 1-day streak.", "suggestions": []}
                        ),
                    ),
                ]
            )
            _configure(client, stub_chat.base_url)
            body = _chat(client, text="am I behind on meditating?")

        assert stub_chat.request_count == 2
        assert body["message"] == "You're on a 1-day streak."
        second_request = stub_chat.request_at(1)
        tool_messages = [m for m in second_request["messages"] if m.get("role") == "tool"]
        tool_result = json.loads(tool_messages[0]["content"])
        assert tool_result == {"habit_name": "Meditate", "current_streak": 1}
