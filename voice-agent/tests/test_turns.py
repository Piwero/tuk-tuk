"""Push-to-talk turn control (issue #396, ADR 0015 amendment): the tab opens its microphone and
tells the agent when a spoken turn starts, ends or is abandoned. The agent listens only in between."""

from types import SimpleNamespace
from typing import Any

import pytest
from livekit import rtc

from tuk_voice_agent.turns import register_turn_control

BROWSER = "owner-browser"


class FakeSession:
    def __init__(self, uninterruptible: bool = False) -> None:
        self.calls: list[str] = []
        self.uninterruptible = uninterruptible
        self.input = SimpleNamespace(set_audio_enabled=lambda on: self.calls.append(f"audio:{on}"))

    def interrupt(self) -> None:
        if self.uninterruptible:
            raise RuntimeError("speech disallows interruptions")
        self.calls.append("interrupt")

    def clear_user_turn(self) -> None:
        self.calls.append("clear")

    def commit_user_turn(self, **_: Any) -> None:
        self.calls.append("commit")


class FakeParticipant:
    def __init__(self) -> None:
        self.methods: dict[str, Any] = {}

    def register_rpc_method(self, name: str, handler: Any) -> None:
        self.methods[name] = handler


def setup(session: FakeSession | None = None) -> tuple[FakeSession, FakeParticipant]:
    session = session or FakeSession()
    participant = FakeParticipant()
    register_turn_control(session, participant, BROWSER)  # type: ignore[arg-type]
    return session, participant


def call(participant: FakeParticipant, name: str, caller: str = BROWSER) -> Any:
    return participant.methods[name](SimpleNamespace(caller_identity=caller, payload=""))


async def test_agent_is_deaf_until_a_turn_starts() -> None:
    session, _ = setup()
    assert session.calls == ["audio:False"]


async def test_starting_a_turn_interrupts_and_listens() -> None:
    session, participant = setup()
    session.calls.clear()
    await call(participant, "start_turn")
    assert session.calls == ["interrupt", "clear", "audio:True"]


async def test_ending_a_turn_stops_listening_then_submits() -> None:
    session, participant = setup()
    session.calls.clear()
    await call(participant, "end_turn")
    assert session.calls == ["audio:False", "commit"]


async def test_cancelling_a_turn_stops_listening_and_discards() -> None:
    session, participant = setup()
    session.calls.clear()
    await call(participant, "cancel_turn")
    assert session.calls == ["audio:False", "clear"]


async def test_starting_a_turn_survives_speech_that_cannot_be_interrupted() -> None:
    session, participant = setup(FakeSession(uninterruptible=True))
    session.calls.clear()
    await call(participant, "start_turn")
    assert session.calls == ["clear", "audio:True"]


@pytest.mark.parametrize("name", ["start_turn", "end_turn", "cancel_turn"])
async def test_only_the_owners_tab_may_control_turns(name: str) -> None:
    session, participant = setup()
    session.calls.clear()
    with pytest.raises(rtc.RpcError):
        await call(participant, name, caller="someone-else")
    assert session.calls == []
