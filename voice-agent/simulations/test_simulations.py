"""Hand-run text simulations of the Voice Assistant (issue #372, ADR 0015). NOT part of CI.

Each case drives the real prompt, tools and model through LiveKit's `AgentSession.run()` text
mode, no audio and no room, so a run spends a few of the free 350 turns and no voice minutes. The
browser tab is replaced by `FakeTab`: it answers the agent's RPC calls from a canned Agenda and
records every call, which is how the "zero writes" cases are checked.

Run (needs a LiveKit Cloud project's key and secret for LiveKit Inference, see README.md):

    cd voice-agent && uv run pytest simulations -s

`testpaths = ["tests"]` keeps this directory out of a bare `pytest` and out of `mise run test`.
Without LIVEKIT_API_KEY the module skips itself, so a stray run costs nothing.
"""

import json
import os
from collections.abc import AsyncIterator
from typing import Any

import pytest
from livekit.agents import Agent, AgentSession, inference
from livekit.agents.llm import LLM, FunctionCall
from livekit.agents.voice.run_result import RunResult

from tuk_voice_agent.config import LLM_MODEL
from tuk_voice_agent.prompt import build_instructions
from tuk_voice_agent.roster import VOICE_TOOLS
from tuk_voice_agent.tools import build_tools

pytestmark = pytest.mark.skipif(
    not (os.environ.get("LIVEKIT_API_KEY") and os.environ.get("LIVEKIT_API_SECRET")),
    reason="hand-run only: set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET (LiveKit Inference)",
)

WRITES = {name for name, tool in VOICE_TOOLS.items() if tool.kind == "write"}
TZ, TODAY = "Europe/Madrid", "2026-11-04"  # a Wednesday, so "tomorrow" is 2026-11-05

AGENDA = {
    "today": TODAY,
    "window_end": "2026-11-10",
    "time_zone": TZ,
    "tasks": [
        {
            "id": 11,
            "title": "Dentist appointment",
            "completed": False,
            "priority": "none",
            "start_date": None,
            "due_date": "2026-11-04T10:00:00Z",
            "is_all_day": False,
            "list_id": None,
            "recurrence": None,
            "tags": [],
        },
    ],  # fmt: skip
    "tasks_total": 1,
    "habits_due_today": [{"id": 7, "name": "Water"}],
    "events": [],
    "lists": [{"id": 1, "name": "Home"}],
    "tags": [{"id": 1, "name": "errands"}],
}


class FakeTab:
    """Stands in for both the LocalParticipant (`perform_rpc`) and the browser tab behind it."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def perform_rpc(
        self, *, destination_identity: str, method: str, payload: str, response_timeout: float
    ) -> str:
        args = json.loads(payload)
        self.calls.append((method, args))
        if method == "get_agenda":
            return json.dumps(AGENDA)
        return json.dumps({"ok": True, "tool": method})

    @property
    def writes(self) -> list[str]:
        return [name for name, _ in self.calls if name in WRITES]

    def args_of(self, tool: str) -> dict[str, Any]:
        return next(args for name, args in self.calls if name == tool)


@pytest.fixture
async def llm() -> AsyncIterator[LLM[Any]]:
    async with inference.LLM(model=LLM_MODEL) as model:
        yield model


@pytest.fixture
async def run(llm: LLM[Any]) -> AsyncIterator[tuple[AgentSession[None], FakeTab]]:
    tab = FakeTab()
    agent = Agent(
        instructions=build_instructions(tz=TZ, date=TODAY),
        tools=list(build_tools(tab, "tab")),  # type: ignore[arg-type]
    )
    async with AgentSession(llm=llm) as session:
        await session.start(agent)
        yield session, tab


def called(result: RunResult[None]) -> list[str]:
    return [e.item.name for e in result.events if isinstance(e.item, FunctionCall)]


async def test_add_milk_tomorrow(run: tuple[AgentSession[None], FakeTab], llm: LLM[Any]) -> None:
    session, tab = run
    first: RunResult[None] = await session.run(user_input="Add buy milk for tomorrow.")
    assert tab.writes == [], "must read the batch back and wait for a yes"
    await (
        first.expect[-1]
        .is_message(role="assistant")
        .judge(
            llm,
            intent="Reads back adding a task about milk for tomorrow and asks for confirmation.",
        )
    )

    await session.run(user_input="Yes.")
    assert tab.writes == ["create_task"]
    args = tab.args_of("create_task")
    assert "milk" in args["title"].lower()
    assert args.get("due", "").lower() in ("tomorrow", "2026-11-05")


async def test_check_in_water_2(run: tuple[AgentSession[None], FakeTab], llm: LLM[Any]) -> None:
    session, tab = run
    first: RunResult[None] = await session.run(user_input="Check in water, 2.")
    assert tab.writes == []
    await (
        first.expect[-1]
        .is_message(role="assistant")
        .judge(
            llm,
            intent="Reads back checking in the Water habit with a value of 2 and asks to confirm.",
        )
    )

    await session.run(user_input="Yes, go ahead.")
    assert tab.writes == ["check_in_habit"]
    args = tab.args_of("check_in_habit")
    assert args["habit_id"] == 7
    assert args.get("value") == 2


async def test_spanish_request(run: tuple[AgentSession[None], FakeTab], llm: LLM[Any]) -> None:
    session, tab = run
    first: RunResult[None] = await session.run(user_input="Añade comprar leche para mañana.")
    assert tab.writes == []
    await (
        first.expect[-1]
        .is_message(role="assistant")
        .judge(
            llm, intent="Is written in Spanish and asks the owner to confirm adding a milk task."
        )
    )

    await session.run(user_input="Sí, adelante.")
    assert tab.writes == ["create_task"]
    assert "leche" in tab.args_of("create_task")["title"].lower()


async def test_declined_confirmation_applies_no_writes(
    run: tuple[AgentSession[None], FakeTab], llm: LLM[Any]
) -> None:
    session, tab = run
    await session.run(user_input="Add buy milk for tomorrow.")
    declined: RunResult[None] = await session.run(user_input="No, don't do that.")
    assert tab.writes == []
    assert not WRITES & set(called(declined))
    await (
        declined.expect[-1]
        .is_message(role="assistant")
        .judge(llm, intent="Says nothing was changed or added.")
    )


async def test_delete_request_is_refused(
    run: tuple[AgentSession[None], FakeTab], llm: LLM[Any]
) -> None:
    session, tab = run
    result: RunResult[None] = await session.run(user_input="Delete my dentist task.")
    assert tab.writes == []
    assert not WRITES & set(called(result))
    await (
        result.expect[-1]
        .is_message(role="assistant")
        .judge(llm, intent="Says it can't delete anything and does not claim the task was deleted.")
    )
