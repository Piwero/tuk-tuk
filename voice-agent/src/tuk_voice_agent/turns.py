"""Push-to-talk turn control (issue #396, ADR 0015 amendment). The tab opens its microphone and
calls these RPC methods when the owner starts, ends or abandons a spoken turn; the agent hears
nothing in between. They are not roster tools, so they do not change `contract_version`."""

from contextlib import suppress
from typing import Any

from livekit import rtc
from livekit.agents import AgentSession

START_TURN = "start_turn"
END_TURN = "end_turn"
CANCEL_TURN = "cancel_turn"

# STT can lag the last words by a moment; the default 2 s would drop them on a slow link.
TRANSCRIPT_TIMEOUT_SECONDS = 10.0


def register_turn_control(
    session: AgentSession[None], participant: rtc.LocalParticipant, identity: str
) -> None:
    """Make the agent deaf now and register the turn methods, which only `identity` may call."""
    session.input.set_audio_enabled(False)

    def only_owner(data: rtc.RpcInvocationData) -> None:
        if data.caller_identity != identity:
            raise rtc.RpcError(rtc.RpcError.ErrorCode.APPLICATION_ERROR, "not the session owner")

    async def start_turn(data: rtc.RpcInvocationData) -> str:
        only_owner(data)
        # A message that must finish (e.g. "log in again") refuses interruption and keeps playing.
        with suppress(RuntimeError):
            session.interrupt()
        session.clear_user_turn()
        session.input.set_audio_enabled(True)
        return ""

    async def end_turn(data: rtc.RpcInvocationData) -> str:
        only_owner(data)
        session.input.set_audio_enabled(False)
        session.commit_user_turn(transcript_timeout=TRANSCRIPT_TIMEOUT_SECONDS)
        return ""

    async def cancel_turn(data: rtc.RpcInvocationData) -> str:
        only_owner(data)
        session.input.set_audio_enabled(False)
        session.clear_user_turn()
        return ""

    handlers: dict[str, Any] = {
        START_TURN: start_turn,
        END_TURN: end_turn,
        CANCEL_TURN: cancel_turn,
    }
    for name, handler in handlers.items():
        participant.register_rpc_method(name, handler)
