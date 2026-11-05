"""Tool wiring for the voice agent (issue #368): each read tool must relay to the browser
participant as an RPC named exactly like the roster tool, JSON payload in, JSON string out."""

import json
from collections.abc import Awaitable
from typing import Any

import pytest
from livekit import rtc
from livekit.agents.llm import RawFunctionTool, ToolError

from tuk_voice_agent.config import RPC_TIMEOUT_SECONDS
from tuk_voice_agent.livekit_tools import build_tools
from tuk_voice_agent.prompt import build_instructions
from tuk_voice_agent.roster import VOICE_TOOLS

BROWSER = "owner-browser"


class FakeLocalParticipant:
    def __init__(self, reply: str = "{}", error: Exception | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self._reply, self._error = reply, error

    async def perform_rpc(self, **kwargs: Any) -> str:
        self.calls.append(kwargs)
        if self._error:
            raise self._error
        return self._reply


def tools_by_name(fake: FakeLocalParticipant) -> dict[str, RawFunctionTool[..., Awaitable[str]]]:
    return {t.id: t for t in build_tools(fake, BROWSER)}  # type: ignore[arg-type]


def test_tools_are_the_roster_voice_tools_with_roster_args() -> None:
    tools = tools_by_name(FakeLocalParticipant())
    assert tools.keys() == VOICE_TOOLS.keys()
    for name, tool in tools.items():
        assert tool.info.raw_schema["parameters"]["properties"] == VOICE_TOOLS[name].args


def test_write_tools_have_kind_write_and_required_args() -> None:
    # Literal: which tools mutate, and which args the model must supply, is deliberate.
    writes = {n for n, t in VOICE_TOOLS.items() if t.kind == "write"}
    required = {
        n: t.info.raw_schema["parameters"]["required"]
        for n, t in tools_by_name(FakeLocalParticipant()).items()
    }
    assert {n: required[n] for n in writes} == {
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


@pytest.mark.parametrize(
    ("name", "args"),
    [
        ("get_agenda", {}),
        ("search_tasks", {"query": "dentist", "limit": 5}),
        ("get_task", {"task_id": 42}),
        ("create_task", {"title": "buy milk", "due": "tomorrow", "list": "Home"}),
        ("schedule_task", {"task_id": 7, "due": "friday 14:00"}),
        ("reschedule_task", {"task_id": 7, "due": "monday"}),
        ("complete_task", {"task_id": 7}),
        ("set_priority", {"task_id": 7, "priority": "high"}),
        ("set_list", {"task_id": 7, "list": "Work"}),
        ("add_tags", {"task_id": 7, "tags": ["urgent"]}),
        ("add_check_items", {"task_id": 7, "titles": ["eggs", "bread"]}),
        ("check_in_habit", {"habit_id": 3, "value": 2}),
    ],
)
async def test_tool_relays_rpc_named_like_roster_with_json_payload(
    name: str, args: dict[str, Any]
) -> None:
    fake = FakeLocalParticipant(reply='{"ok": true}')
    result = await tools_by_name(fake)[name](raw_arguments=args)
    assert fake.calls == [
        {
            "destination_identity": BROWSER,
            "method": name,
            "payload": json.dumps(args),
            "response_timeout": RPC_TIMEOUT_SECONDS,
        }
    ]
    assert result == '{"ok": true}'


async def test_rpc_failure_reaches_llm_as_tool_error() -> None:
    err = rtc.RpcError(rtc.RpcError.ErrorCode.RESPONSE_TIMEOUT, "Response timeout")
    fake = FakeLocalParticipant(error=err)
    with pytest.raises(ToolError, match="couldn't reach your app"):
        await tools_by_name(fake)["get_agenda"](raw_arguments={})


def test_instructions_carry_owner_clock_and_core_rules() -> None:
    text = build_instructions(tz="Europe/Madrid", date="2026-11-04")
    assert "Europe/Madrid" in text
    assert "2026-11-04" in text
    assert "get_agenda" in text  # Agenda is the first action
    assert "Spanish" in text
    assert "delete" in text.lower()  # refusal rule (ADR 0014)


def test_instructions_enforce_batch_confirmation_before_any_write() -> None:
    text = build_instructions(tz="Europe/Madrid", date="2026-11-04").lower()
    assert "placeholder" not in text
    assert "read the whole batch back" in text
    assert "spoken yes" in text
    assert "same turn" in text
    assert "no writes" in text  # decline or correction applies nothing
    assert "never propose moving" in text  # Events stay put
