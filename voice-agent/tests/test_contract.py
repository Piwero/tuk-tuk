"""Agent side of the shared tool roster contract (ADR 0014, issue #364). The MCP side is
`mcp/oci/tests/test_mcp.py::test_shared_tool_roster_contract`; both read the same file."""

import json
from pathlib import Path

import pytest

from tuk_voice_agent.roster import CONTRACT_VERSION, ROSTER_PATH, VOICE_TOOLS

ROSTER = json.loads(ROSTER_PATH.read_text())


def test_contract_version_matches_roster() -> None:
    assert ROSTER["contract_version"] == CONTRACT_VERSION == 1


def test_tools_equal_roster_voice_subset() -> None:
    expected = {t["name"]: t for t in ROSTER["tools"] if "voice" in t["clients"]}
    assert VOICE_TOOLS.keys() == expected.keys()
    assert {n: (t.kind, t.args) for n, t in VOICE_TOOLS.items()} == {
        n: (t["kind"], t["args"]) for n, t in expected.items()
    }


def test_voice_tool_names_and_kinds_pinned() -> None:
    # Literal, independent of the file: adding or retyping a voice tool is a deliberate
    # change that must bump this list (and the agent/browser handlers) together.
    assert {n for n, t in VOICE_TOOLS.items() if t.kind == "read"} == {
        "get_agenda",
        "search_tasks",
        "get_task",
    }
    assert {n for n, t in VOICE_TOOLS.items() if t.kind == "write"} == {
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


def test_no_tool_implies_delete() -> None:
    # ADR 0014: no destructive writes, and nothing outside Tasks/Habits.
    forbidden = ("delete", "remove", "destroy", "purge", "clear")
    assert not [n for n in VOICE_TOOLS if any(word in n for word in forbidden)]


def test_vendored_roster_equals_shared_when_present() -> None:
    # `lk agent deploy` ships only voice-agent/, so the agent reads a vendored copy. Skipped
    # where the shared file is absent (e.g. building from the deployed bundle).
    shared = Path(__file__).parents[2] / "shared/voice-tool-roster.json"
    if not shared.exists():
        pytest.skip("shared roster not in this checkout")
    assert ROSTER_PATH.read_text() == shared.read_text()
