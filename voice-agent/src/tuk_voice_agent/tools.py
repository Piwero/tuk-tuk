"""Read tools: each relays to the owner's open tab over LiveKit RPC (ADR 0015). The method name is
the roster tool name, the payload is the JSON args, the result is the tab's JSON string. The agent
never touches the API itself."""

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
}
_REQUIRED = {"search_tasks": ["query"], "get_task": ["task_id"]}


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
    return [
        _relay(participant, browser_identity, n) for n, t in VOICE_TOOLS.items() if t.kind == "read"
    ]
