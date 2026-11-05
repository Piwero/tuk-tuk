"""LiveKit binding for the voice tools: relays over RPC to the owner's open tab (ADR 0015). The
method name is the roster tool name, the payload is the JSON args, the result is the tab's JSON
string. Semantics and error wording live in tools.py."""

from collections.abc import Awaitable, Callable

from livekit import rtc
from livekit.agents import function_tool
from livekit.agents.llm import RawFunctionTool, ToolError

from tuk_voice_agent.config import RPC_TIMEOUT_SECONDS
from tuk_voice_agent.tools import RelayError, ToolFailureError, ToolSpec, run_tool, tool_specs


def _bind(
    spec: ToolSpec,
    participant: rtc.LocalParticipant,
    identity: str,
    on_lapsed: Callable[[], None] | None,
) -> RawFunctionTool[..., Awaitable[str]]:
    async def relay(method: str, payload: str) -> str:
        try:
            return await participant.perform_rpc(
                destination_identity=identity,
                method=method,
                payload=payload,
                response_timeout=RPC_TIMEOUT_SECONDS,
            )
        except rtc.RpcError as exc:
            raise RelayError(exc.code, exc.message) from exc

    async def call(raw_arguments: dict[str, object]) -> str:
        try:
            return await run_tool(spec.name, raw_arguments, relay, on_lapsed)
        except ToolFailureError as exc:
            raise ToolError(str(exc)) from exc

    return function_tool(
        call,
        raw_schema={
            "type": "function",
            "name": spec.name,
            "description": spec.description,
            "parameters": spec.parameters,
        },
    )


def build_tools(
    participant: rtc.LocalParticipant,
    browser_identity: str,
    on_lapsed: Callable[[], None] | None = None,
) -> list[RawFunctionTool[..., Awaitable[str]]]:
    return [_bind(spec, participant, browser_identity, on_lapsed) for spec in tool_specs()]
