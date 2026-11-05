import pytest
from livekit import rtc
from livekit.agents.llm import ToolError

from test_tools import FakeLocalParticipant
from tuk_voice_agent.tools import build_tools


async def test_timeout_is_reported_without_retry() -> None:
    fake = FakeLocalParticipant(
        error=rtc.RpcError(rtc.RpcError.ErrorCode.RESPONSE_TIMEOUT, "timeout")
    )
    tool = next(t for t in build_tools(fake, "browser") if t.id == "create_task")  # type: ignore[arg-type]
    with pytest.raises(ToolError, match="couldn't reach your app"):
        await tool(raw_arguments={"title": "milk"})
    assert len(fake.calls) == 1


async def test_lapsed_session_triggers_shutdown_handler() -> None:
    ended: list[str] = []
    fake = FakeLocalParticipant(error=rtc.RpcError(2001, "unauthorized"))
    tool = next(
        t
        for t in build_tools(fake, "browser", lambda: ended.append("lapsed"))
        if t.id == "get_task"
    )  # type: ignore[arg-type]
    with pytest.raises(ToolError, match="log in again"):
        await tool(raw_arguments={"task_id": 1})
    assert ended == ["lapsed"]


def test_silence_starts_after_agent_speech_and_resets_on_user_speech(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from types import SimpleNamespace

    from tuk_voice_agent.agent import setup_lifecycle

    class FakeTimer:
        def __init__(self, callback: object) -> None:
            self.callback = callback
            self.cancelled = False

        def cancel(self) -> None:
            self.cancelled = True

    class FakeLoop:
        def __init__(self) -> None:
            self.timers: list[FakeTimer] = []

        def call_later(self, delay: float, callback: object, *args: object) -> FakeTimer:
            assert delay == 20
            timer = FakeTimer(lambda: callback(*args))  # type: ignore[operator]
            self.timers.append(timer)
            return timer

    class Emitter:
        def __init__(self) -> None:
            self.events: dict[str, object] = {}

        def on(self, name: str, callback: object) -> None:
            self.events[name] = callback

    loop, session, room = FakeLoop(), Emitter(), Emitter()
    ended: list[str] = []
    monkeypatch.setattr("tuk_voice_agent.agent.asyncio.get_running_loop", lambda: loop)
    setup_lifecycle(session, room, "browser", ended.append)  # type: ignore[arg-type]
    session.events["agent_state_changed"](
        SimpleNamespace(old_state="speaking", new_state="listening")
    )  # type: ignore[operator]
    first = loop.timers[-1]
    session.events["user_state_changed"](SimpleNamespace(new_state="speaking"))  # type: ignore[operator]
    assert first.cancelled
    session.events["user_state_changed"](SimpleNamespace(new_state="listening"))  # type: ignore[operator]
    loop.timers[-1].callback()  # type: ignore[operator]
    assert ended == ["silence"]


def test_browser_leaving_ends_session() -> None:
    from types import SimpleNamespace

    from tuk_voice_agent.agent import setup_lifecycle

    class Emitter:
        def __init__(self) -> None:
            self.events: dict[str, object] = {}

        def on(self, name: str, callback: object) -> None:
            self.events[name] = callback

    session, room = Emitter(), Emitter()
    ended: list[str] = []
    setup_lifecycle(session, room, "browser", ended.append)  # type: ignore[arg-type]
    room.events["participant_disconnected"](SimpleNamespace(identity="other"))  # type: ignore[operator]
    assert ended == []
    room.events["participant_disconnected"](SimpleNamespace(identity="browser"))  # type: ignore[operator]
    assert ended == ["browser_left"]


def test_quota_classification_does_not_confuse_rate_limits() -> None:
    from livekit.agents import APIStatusError

    from tuk_voice_agent.agent import is_quota_exhausted

    exhausted = APIStatusError(
        "quota",
        status_code=429,
        body={"type": "inference_quota_exceeded", "category": "MaxGatewayCredits"},
    )
    rate_limit = APIStatusError(
        "rate",
        status_code=429,
        body={"type": "inference_quota_exceeded", "category": "MaxConcurrentGatewayLLMRpm"},
    )
    assert is_quota_exhausted(exhausted)
    assert not is_quota_exhausted(rate_limit)
