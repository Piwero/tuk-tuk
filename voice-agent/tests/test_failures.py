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
