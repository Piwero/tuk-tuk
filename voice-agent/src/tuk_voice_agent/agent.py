"""LiveKit Cloud agent entrypoint (issue #367/#368, ADR 0015). Deployed with `lk agent deploy`
from `voice-agent/`; the backend dispatches it by AGENT_NAME through the session token."""

import asyncio
from collections.abc import Callable
from contextlib import suppress
from datetime import UTC, datetime

from livekit import agents, rtc
from livekit.agents import Agent, AgentServer, AgentSession, TurnHandlingOptions, inference

from tuk_voice_agent.config import (
    AGENT_NAME,
    ATTR_CONTRACT_VERSION,
    ATTR_DATE,
    ATTR_TZ,
    ATTRIBUTES_WAIT_SECONDS,
    LLM_MODEL,
    STT_LANGUAGE,
    STT_MODEL,
    TTS_LANGUAGE,
    TTS_MODEL,
    TTS_VOICE,
)
from tuk_voice_agent.livekit_tools import build_tools
from tuk_voice_agent.prompt import build_instructions
from tuk_voice_agent.roster import CONTRACT_VERSION
from tuk_voice_agent.turns import register_turn_control

server = AgentServer()


async def wait_for_clock(room: rtc.Room, participant: rtc.RemoteParticipant) -> tuple[str, str]:
    """The tab sets `tz`/`date` right after joining; wait briefly, then fall back to UTC so a
    slow tab still gets a conversation."""
    done = asyncio.Event()

    def check(*_: object) -> None:
        if ATTR_TZ in participant.attributes and ATTR_DATE in participant.attributes:
            done.set()

    room.on("participant_attributes_changed", check)
    check()
    try:
        await asyncio.wait_for(done.wait(), ATTRIBUTES_WAIT_SECONDS)
    except TimeoutError:
        return "UTC", datetime.now(UTC).date().isoformat()
    finally:
        room.off("participant_attributes_changed", check)
    return participant.attributes[ATTR_TZ], participant.attributes[ATTR_DATE]


def is_quota_exhausted(error: object) -> bool:
    if not isinstance(error, agents.APIStatusError):
        return False
    body = error.body
    if isinstance(body, dict):
        category = str(body.get("category", "")).lower()
        if category:
            return "credit" in category or "monthly" in category
        return body.get("type") == "inference_quota_exceeded"
    return error.status_code == 402 or "credit" in error.message.lower()


async def finish_session(
    session: AgentSession[None],
    participant: rtc.LocalParticipant,
    shutdown: Callable[[str], None],
    reason: str,
) -> None:
    message = {
        "session_lapsed": "You need to log in again.",
        "quota_exhausted": "Free voice minutes used up for this month.",
    }.get(reason)
    if message:
        # TTS may itself have exhausted its credits.
        with suppress(Exception):
            await session.say(message, allow_interruptions=False)
    try:
        await participant.set_attributes({"voice_end_reason": reason})
    finally:
        shutdown(reason)


def setup_lifecycle(room: rtc.Room, identity: str, end: Callable[[str], None]) -> None:
    """There is no silence timeout: a session lasts until the owner ends it or the tab goes."""

    def participant_left(participant: rtc.RemoteParticipant) -> None:
        if participant.identity == identity:
            end("browser_left")

    room.on("participant_disconnected", participant_left)


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: agents.JobContext) -> None:
    await ctx.connect()
    # Published first so the tab can compare versions and bail out before any tool call.
    await ctx.room.local_participant.set_attributes({ATTR_CONTRACT_VERSION: str(CONTRACT_VERSION)})
    browser = await ctx.wait_for_participant()
    tz, date = await wait_for_clock(ctx.room, browser)

    session: AgentSession[None] = AgentSession(
        stt=inference.STT(model=STT_MODEL, language=STT_LANGUAGE),
        llm=inference.LLM(model=LLM_MODEL),
        tts=inference.TTS(model=TTS_MODEL, voice=TTS_VOICE, language=TTS_LANGUAGE),
        # Push-to-talk: the tab decides when a turn starts and ends (tuk_voice_agent.turns).
        turn_handling=TurnHandlingOptions(turn_detection="manual"),
    )
    ending = False

    def end(reason: str) -> None:
        nonlocal ending
        if ending:
            return
        ending = True

        asyncio.create_task(
            finish_session(session, ctx.room.local_participant, ctx.shutdown, reason)
        )

    def on_error(event: agents.ErrorEvent) -> None:
        error = getattr(event.error, "error", event.error)
        if is_quota_exhausted(error):
            end("quota_exhausted")

    session.on("error", on_error)
    setup_lifecycle(ctx.room, browser.identity, end)
    register_turn_control(session, ctx.room.local_participant, browser.identity)
    agent = Agent(
        instructions=build_instructions(tz=tz, date=date),
        tools=list(
            build_tools(ctx.room.local_participant, browser.identity, lambda: end("session_lapsed"))
        ),
    )
    # No greeting: push-to-talk sessions stay silent until the owner speaks. The greeting returns
    # with continuous conversation (issue #397).
    await session.start(room=ctx.room, agent=agent)


if __name__ == "__main__":
    agents.cli.run_app(server)
