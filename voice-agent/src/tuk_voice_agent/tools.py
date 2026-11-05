"""Read and write tools: each relays to the owner's open tab over LiveKit RPC (ADR 0015). The method name is
the roster tool name, the payload is the JSON args, the result is the tab's JSON string. The agent
never touches the API itself. Writes carry no extra guard here: the batch-confirmation rule lives in
the prompt (issue #369) and the id allowlist, name resolution and recurrence handling in the tab."""

import json
from collections.abc import Awaitable
from typing import Any

from livekit import rtc
from livekit.agents import function_tool
from livekit.agents.llm import RawFunctionTool, ToolError

from tuk_voice_agent.config import RPC_TIMEOUT_SECONDS
from tuk_voice_agent.roster import VOICE_TOOLS

_DESCRIPTIONS = {
    "get_agenda": "Today's Agenda: open Tasks with ids, Habits due today, Events, List and Tag "
    "names. Call this first, before answering anything.",
    "search_tasks": "Find Tasks whose title or description match words from the owner.",
    "get_task": "Full details of one Task by id, including its description.",
    "create_task": "Create a Task. No list means the Inbox. List and tag names must already "
    "exist; nothing is created from a spoken name. WRITE: only after the owner said yes.",
    "schedule_task": "Give an unscheduled Task a date. due is a word like today, tomorrow, a "
    "weekday or YYYY-MM-DD, optionally with a time like 'tomorrow 14:00'. WRITE: only after yes.",
    "reschedule_task": "Move an already scheduled Task to a new date, same due format as "
    "schedule_task. WRITE: only after yes.",
    "complete_task": "Mark a Task done. A recurring Task only advances to its next date; the "
    "result says so and you must say that, not 'done'. WRITE: only after yes.",
    "set_priority": "Set a Task's priority to none, low, medium or high. WRITE: only after yes.",
    "set_list": "Move a Task to an existing List by name. WRITE: only after yes.",
    "add_tags": "Add existing Tags to a Task by name; its other Tags stay. An unknown name fails "
    "and lists the available ones. WRITE: only after yes.",
    "add_check_items": "Append Check Items (sub-steps) to a Task. WRITE: only after yes.",
    "check_in_habit": "Record a Habit check-in for today, or day as YYYY-MM-DD; value is the "
    "amount for Numeric Habits, default 1. Repeating it is harmless. WRITE: only after yes.",
}
_REQUIRED = {
    "search_tasks": ["query"],
    "get_task": ["task_id"],
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


def _relay(
    participant: rtc.LocalParticipant, identity: str, name: str
) -> RawFunctionTool[..., Awaitable[str]]:
    async def call(raw_arguments: dict[str, object]) -> str:
        try:
            return await participant.perform_rpc(
                destination_identity=identity,
                method=name,
                payload=json.dumps(raw_arguments),
                response_timeout=RPC_TIMEOUT_SECONDS,
            )
        except rtc.RpcError as exc:
            raise ToolError(exc.message) from exc

    schema: dict[str, Any] = {
        "type": "function",
        "name": name,
        "description": _DESCRIPTIONS[name],
        "parameters": {
            "type": "object",
            "properties": VOICE_TOOLS[name].args,
            "required": _REQUIRED.get(name, []),
        },
    }
    return function_tool(call, raw_schema=schema)


def build_tools(
    participant: rtc.LocalParticipant, browser_identity: str
) -> list[RawFunctionTool[..., Awaitable[str]]]:
    return [_relay(participant, browser_identity, name) for name in VOICE_TOOLS]
