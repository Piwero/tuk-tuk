"""Agent wiring that can be checked without LiveKit Cloud: name, clock handoff."""

import asyncio
from typing import Any

from tuk_voice_agent.agent import wait_for_clock
from tuk_voice_agent.config import AGENT_NAME


class FakeRoom:
    def __init__(self) -> None:
        self.handlers: list[Any] = []

    def on(self, _event: str, cb: Any) -> None:
        self.handlers.append(cb)

    def off(self, _event: str, cb: Any) -> None:
        self.handlers.remove(cb)


class FakeParticipant:
    def __init__(self, attributes: dict[str, str]) -> None:
        self.attributes = attributes


def test_agent_name_matches_backend_dispatch() -> None:
    # Literal on purpose: backend/oci/src/app/voice_token.py AGENT_NAME dispatches this string.
    assert AGENT_NAME == "tuktuk-voice"


async def test_clock_read_from_browser_attributes() -> None:
    room, who = FakeRoom(), FakeParticipant({"tz": "Europe/Madrid", "date": "2026-11-04"})
    got = await wait_for_clock(room, who)  # type: ignore[arg-type]
    assert got == ("Europe/Madrid", "2026-11-04")
    assert room.handlers == []


async def test_clock_waits_for_late_attributes() -> None:
    room, who = FakeRoom(), FakeParticipant({})
    task = asyncio.create_task(wait_for_clock(room, who))  # type: ignore[arg-type]
    await asyncio.sleep(0)
    who.attributes.update({"tz": "America/Lima", "date": "2026-11-05"})
    room.handlers[0]({}, who)
    assert await task == ("America/Lima", "2026-11-05")


async def test_clock_falls_back_to_utc(monkeypatch: Any) -> None:
    monkeypatch.setattr("tuk_voice_agent.agent.ATTRIBUTES_WAIT_SECONDS", 0.01)
    tz, date = await wait_for_clock(FakeRoom(), FakeParticipant({}))  # type: ignore[arg-type]
    assert tz == "UTC"
    assert len(date) == 10
