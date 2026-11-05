"""Provider-neutral voice tool semantics (ADR 0015): tool specs derived from the roster, and the
relay-to-the-owner's-tab call with its no-retry error wording. No LiveKit imports; the runtime
adapter (livekit_tools.py) supplies the transport. The batch-confirmation rule lives in the prompt
(issue #369) and the id allowlist, name resolution and recurrence handling in the tab."""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from tuk_voice_agent.roster import VOICE_TOOLS

LAPSED_CODE = 2001  # the tab's reply when the owner's login expired
TAB_ERROR_CODE = 1500  # the tab ran the tool and it failed

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


class RelayError(Exception):
    """Transport-neutral failure from relaying a call to the tab."""

    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


class ToolFailureError(Exception):
    """Failure whose text goes back to the model verbatim."""


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]


Relay = Callable[[str, str], Awaitable[str]]  # (method, json payload) -> json result


def tool_specs() -> list[ToolSpec]:
    return [
        ToolSpec(
            name,
            _DESCRIPTIONS[name],
            {
                "type": "object",
                "properties": VOICE_TOOLS[name].args,
                "required": _REQUIRED.get(name, []),
            },
        )
        for name in VOICE_TOOLS
    ]


async def run_tool(
    name: str, args: dict[str, object], relay: Relay, on_lapsed: Callable[[], None] | None
) -> str:
    try:
        return await relay(name, json.dumps(args))
    except RelayError as exc:
        if exc.code == LAPSED_CODE:
            if on_lapsed:
                on_lapsed()
            raise ToolFailureError("You need to log in again. Do not retry.") from exc
        if exc.code != TAB_ERROR_CODE:
            raise ToolFailureError(
                "I couldn't reach your app. Do not retry. Report which changes "
                "succeeded and which failed."
            ) from exc
        raise ToolFailureError(
            f"{name} failed: {exc.message}. Do not retry. Report which changes "
            "succeeded and which failed."
        ) from exc
