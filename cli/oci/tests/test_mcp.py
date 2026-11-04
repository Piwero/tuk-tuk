"""Drive tool dispatch as a client would: JSON-RPC in, result out, with a mock
transport underneath. The roster test pins the enforcement boundary (ADR 0014)."""

import io
import json
from pathlib import Path

import httpx
import pytest

from tuk.client import Client
from tuk.mcp.server import handle, serve
from tuk.mcp.tools import TOOLS, Toolbox


def test_shared_tool_roster_contract() -> None:
    contract = json.loads((Path(__file__).parents[3] / "shared/voice-tool-roster.json").read_text())
    roster = contract["tools"]
    mcp_roster = {tool["name"]: tool for tool in roster if "mcp" in tool["clients"]}
    actual = {tool["name"]: tool for tool in (TOOLS[name].spec() for name in TOOLS)}
    assert contract["contract_version"] == 1
    assert actual.keys() == mcp_roster.keys()
    assert {
        name: {
            key: {field: value for field, value in schema.items() if field != "description"}
            for key, schema in tool["inputSchema"]["properties"].items()
        }
        for name, tool in actual.items()
    } == {name: tool["args"] for name, tool in mcp_roster.items()}
    assert {name: tool["inputSchema"]["required"] for name, tool in actual.items()} == {
        "get_agenda": [],
        "search_tasks": ["query"],
        "get_task": ["task_id"],
        "get_goals": [],
        "get_focus_stats": [],
        "create_task": ["title"],
        "schedule_task": ["task_id", "due"],
        "reschedule_task": ["task_id", "due"],
        "complete_task": ["task_id"],
        "set_priority": ["task_id", "priority"],
        "set_list": ["task_id", "list"],
        "add_tags": ["task_id", "tags"],
        "add_check_items": ["task_id", "titles"],
        "check_in_habit": ["habit_id"],
    }
    # ADR 0014 principle: idempotent, non-destructive, Task-or-Habit scoped writes.
    assert all(tool["kind"] in {"read", "write"} for tool in roster)
    assert {name for name, tool in mcp_roster.items() if tool["kind"] == "write"} == {
        "create_task",
        "schedule_task",
        "reschedule_task",
        "complete_task",
        "set_priority",
        "set_list",
        "add_tags",
        "add_check_items",
        "check_in_habit",
    }
    assert all(tool["inputSchema"]["additionalProperties"] is False for tool in actual.values())
    assert all(
        tool.run.__name__ not in {"delete", "remove"}
        and "DELETE" not in tool.run.__code__.co_consts
        for tool in TOOLS.values()
    )


def page(items: list[dict]) -> dict:
    return {"items": items, "total": len(items), "limit": 200, "offset": 0}


class Api:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.task = {
            "id": 7, "title": "Water", "completed": False, "priority": "none",
            "due_date": None, "recurrence": None, "tags": [{"id": 1, "name": "home"}],
            "check_items": [], "description": "secret body",
        }  # fmt: skip
        self.events_status = 200

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path, method = request.url.path, request.method
        if path == "/api/v1/tasks" and method == "GET":
            return httpx.Response(200, json=page([self.task]))
        if path == "/api/v1/tasks/7" and method == "GET":
            return httpx.Response(200, json=self.task)
        if path == "/api/v1/tasks/7" and method == "PATCH":
            self.task = {**self.task, **json.loads(request.content)}
            return httpx.Response(200, json=self.task)
        if path == "/api/v1/tasks/99":
            return httpx.Response(404, json={"error": {"code": "not_found", "message": "x"}})
        if path == "/api/v1/habits":
            return httpx.Response(200, json=page([{"id": 3, "name": "Read"}]))
        if path == "/api/v1/events":
            return httpx.Response(self.events_status, json={"events": [{"title": "Standup"}]})
        if path == "/api/v1/lists":
            return httpx.Response(200, json=page([{"id": 5, "name": "Home"}]))
        if path == "/api/v1/tags":
            return httpx.Response(
                200, json=page([{"id": 1, "name": "home"}, {"id": 2, "name": "Urgent"}])
            )
        if path == "/api/v1/habits/3/check-ins/" + request.url.path.rsplit("/", 1)[1]:
            return httpx.Response(200, json={"habit_id": 3, "value": 1.0})
        return httpx.Response(500, json={"error": {"code": "boom", "message": "unexpected"}})


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("TUK_CONFIG_DIR", str(tmp_path))
    monkeypatch.setenv("TUK_TIMEZONE", "Europe/London")
    (tmp_path / "tuk").mkdir()
    (tmp_path / "tuk" / "session.json").write_text(json.dumps({"session_cookie": "sess"}))
    api = Api()
    box = Toolbox(Client("http://x", transport=httpx.MockTransport(api)))

    def call(name: str, **arguments: object) -> tuple[bool, object]:
        out = handle(box, {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                           "params": {"name": name, "arguments": arguments}})  # fmt: skip
        result = out["result"]
        text = result["content"][0]["text"]
        failed = bool(result.get("isError"))
        return failed, text if failed else json.loads(text)

    return api, call, box


def test_stdio_roundtrip(env) -> None:
    _, _, box = env
    source = io.StringIO('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\nnot json\n')
    sink = io.StringIO()
    serve(box, source, sink)
    first, second = (json.loads(line) for line in sink.getvalue().splitlines())
    contract = json.loads((Path(__file__).parents[3] / "shared/voice-tool-roster.json").read_text())
    assert {t["name"] for t in first["result"]["tools"]} == {
        tool["name"] for tool in contract["tools"] if "mcp" in tool["clients"]
    }
    assert second["error"]["code"] == -32700


def test_agenda_composes_and_survives_calendar_failure(env) -> None:
    api, call, _ = env
    api.events_status = 500
    failed, agenda = call("get_agenda")
    assert not failed
    assert agenda["time_zone"] == "Europe/London"
    assert agenda["events"] == []
    assert agenda["tasks"][0]["id"] == 7
    assert agenda["habits_due_today"] == [{"id": 3, "name": "Read"}]
    assert {x["name"] for x in agenda["lists"]} == {"Home"}


def test_write_rejects_unread_id(env) -> None:
    api, call, _ = env
    failed, text = call("complete_task", task_id=7)
    assert failed
    assert "get_agenda" in text
    assert not any(r.method == "PATCH" for r in api.requests)


def test_unknown_id_after_read_is_clean_error(env) -> None:
    _, call, box = env
    box.task_ids.add(99)
    failed, text = call("complete_task", task_id=99)
    assert failed
    assert "not found" in text


def test_complete_flags_recurring_advance(env) -> None:
    api, call, _ = env
    call("get_agenda")
    api.task["recurrence"] = "FREQ=DAILY"
    # API advances in place: stays open after completed=True patch
    original = api.__call__

    def advancing(request: httpx.Request) -> httpx.Response:
        if request.method == "PATCH":
            return httpx.Response(200, json=api.task)
        return original(request)

    _, _, box = env
    box.client._http._transport = httpx.MockTransport(advancing)  # noqa: SLF001
    _, result = call("complete_task", task_id=7)
    assert result["advanced_to_next_occurrence"] is True


def test_add_tags_is_additive(env) -> None:
    api, call, _ = env
    call("get_agenda")
    failed, _ = call("add_tags", task_id=7, tags=["urgent"])
    assert not failed
    patch = next(r for r in api.requests if r.method == "PATCH")
    assert json.loads(patch.content) == {"tag_ids": [1, 2]}


def test_unknown_tag_creates_nothing(env) -> None:
    api, call, _ = env
    call("get_agenda")
    failed, text = call("add_tags", task_id=7, tags=["nope"])
    assert failed
    assert "Unknown tag" in text
    assert not any(r.method in ("POST", "PATCH") for r in api.requests)


def test_schedule_requires_unscheduled_and_reschedule_scheduled(env) -> None:
    _, call, _ = env
    call("get_agenda")
    assert call("reschedule_task", task_id=7, due="tomorrow")[0]
    failed, result = call("schedule_task", task_id=7, due="2026-10-09")
    assert not failed
    assert result["due_date"].startswith("2026-10-09")
    assert call("schedule_task", task_id=7, due="tomorrow")[0]
    assert not call("reschedule_task", task_id=7, due="2026-10-10 14:00")[0]


def test_habit_checkin_needs_read_and_is_a_put(env) -> None:
    api, call, _ = env
    assert call("check_in_habit", habit_id=3)[0]
    call("get_agenda")
    assert not call("check_in_habit", habit_id=3)[0]
    assert not call("check_in_habit", habit_id=3)[0]
    puts = [r for r in api.requests if r.method == "PUT"]
    assert len(puts) == 2
    assert puts[0].url == puts[1].url


def test_auth_failure_tells_owner_to_login(env, tmp_path: Path) -> None:
    _, call, box = env
    (tmp_path / "tuk" / "session.json").unlink()
    failed, text = call("get_agenda")
    assert failed
    assert "tuk login" in text


def test_bad_argument_types_are_tool_errors_not_parse_errors(env) -> None:
    _, call, _ = env
    failed, text = call("search_tasks", query="x", limit="many")
    assert failed
    assert "Invalid arguments" in text
    assert call("get_focus_stats", days="week")[0]


def test_set_priority_rejects_unknown_value(env) -> None:
    api, call, _ = env
    call("get_agenda")
    failed, text = call("set_priority", task_id=7, priority="urgent")
    assert failed
    assert "priority must be one of" in text
    assert not any(r.method == "PATCH" for r in api.requests)
