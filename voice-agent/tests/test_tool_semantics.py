"""Provider-neutral tool semantics: runs with no LiveKit import."""

import json
import subprocess
import sys

import pytest

from tuk_voice_agent.roster import VOICE_TOOLS
from tuk_voice_agent.tools import RelayError, ToolFailureError, run_tool, tool_specs


def test_neutral_modules_do_not_import_livekit() -> None:
    code = (
        "import sys, tuk_voice_agent.tools, tuk_voice_agent.prompt, tuk_voice_agent.roster;"
        "sys.exit(any(m.split('.')[0] == 'livekit' for m in sys.modules))"
    )
    assert subprocess.run([sys.executable, "-c", code], check=False).returncode == 0


def test_specs_follow_roster_with_required_args() -> None:
    specs = {s.name: s for s in tool_specs()}
    assert specs.keys() == VOICE_TOOLS.keys()
    assert specs["create_task"].parameters["required"] == ["title"]
    assert specs["get_agenda"].parameters["required"] == []
    assert specs["get_agenda"].parameters["properties"] == VOICE_TOOLS["get_agenda"].args


async def test_run_tool_relays_name_and_json_payload() -> None:
    sent: list[tuple[str, str]] = []

    async def relay(method: str, payload: str) -> str:
        sent.append((method, payload))
        return '{"ok":true}'

    assert await run_tool("set_priority", {"task_id": 7}, relay, None) == '{"ok":true}'
    assert sent == [("set_priority", json.dumps({"task_id": 7}))]


async def fail_with(error: RelayError) -> tuple[str, list[str]]:
    async def relay(method: str, payload: str) -> str:
        raise error

    ended: list[str] = []
    with pytest.raises(ToolFailureError) as caught:
        await run_tool("get_task", {}, relay, lambda: ended.append("lapsed"))
    return str(caught.value), ended


async def test_lapsed_login_ends_session_and_says_do_not_retry() -> None:
    message, ended = await fail_with(RelayError(2001, "unauthorized"))
    assert "log in again" in message
    assert "Do not retry" in message
    assert ended == ["lapsed"]


async def test_tab_error_reports_name_and_message_without_retry() -> None:
    message, _ = await fail_with(RelayError(1500, "no such list"))
    assert "get_task failed: no such list" in message
    assert "Do not retry" in message


async def test_transport_failure_reports_unreachable_without_retry() -> None:
    message, ended = await fail_with(RelayError(1502, "timeout"))
    assert "couldn't reach your app" in message
    assert ended == []
