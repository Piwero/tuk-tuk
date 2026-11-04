"""LiveKit Cloud agent entrypoint (issue #367/#368, ADR 0015). Deployed with `lk agent deploy`
from `voice-agent/`; the backend dispatches it by AGENT_NAME through the session token."""

import asyncio
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
    TTS_MODEL,
    TTS_VOICE,
)
from tuk_voice_agent.prompt import build_instructions
from tuk_voice_agent.roster import CONTRACT_VERSION
from tuk_voice_agent.tools import build_tools

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
        tts=inference.TTS(model=TTS_MODEL, voice=TTS_VOICE),
        turn_handling=TurnHandlingOptions(turn_detection=inference.TurnDetector()),
    )
    agent = Agent(
        instructions=build_instructions(tz=tz, date=date),
        tools=list(build_tools(ctx.room.local_participant, browser.identity)),
    )
    await session.start(room=ctx.room, agent=agent)
    await session.generate_reply(
        instructions="Call get_agenda first, then greet the owner briefly and say what is on today."
    )


if __name__ == "__main__":
    agents.cli.run_app(server)
