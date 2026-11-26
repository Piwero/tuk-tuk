"""Narrow input-only Assistant interaction. No snapshot or tool execution."""

import json
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.assistant_chat import AssistantChatTurn, CreateTaskSuggestion, _post_completion
from app.errors import APIError

MAX_INPUT_CHARS = 12_000
MAX_OUTPUT_CHARS = 20_000
MAX_DRAFTS = 10


class BrainDumpOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(max_length=2000)
    suggestions: list[CreateTaskSuggestion] = Field(max_length=MAX_DRAFTS)


def invalid_output() -> APIError:
    return APIError(
        status_code=422,
        code="invalid_brain_dump",
        message="Couldn't prepare valid drafts. Use at most ten thoughts in another deliberate batch; no Tasks were saved.",
    )


def validate_brain_dump(raw: dict[str, Any]) -> AssistantChatTurn:
    try:
        output = BrainDumpOutput.model_validate(raw)
        for draft in output.suggestions:
            if (
                not draft.title.strip()
                or draft.list_name is not None
                or draft.tag_names
                or draft.priority != "none"
            ):
                raise invalid_output()
        # Dates from inference are never committed or treated as deadlines. The
        # review offers an explicit deterministic date control instead.
        return AssistantChatTurn(
            message=output.message,
            suggestions=list(output.suggestions),
            discarded_count=0,
        )
    except ValidationError:
        raise invalid_output() from None


async def request_brain_dump(
    base_url: str, model: str, api_key: str, text: str
) -> AssistantChatTurn:
    schema = BrainDumpOutput.model_json_schema()
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "Turn supplied text into at most ten create_task Suggestions. Only this input is available. Never invent Lists, Tags, priority, estimates, calendar writes, medical advice or diagnoses. Missing and ambiguous dates stay null. Explicit ISO dates may be proposed for review, never accepted automatically. More than ten thoughts requires another deliberate batch; do not silently omit any. Return a short message and suggestions.",
            },
            {"role": "user", "content": text},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "brain_dump", "schema": schema, "strict": True},
        },
    }
    async with httpx.AsyncClient(base_url=base_url, timeout=30.0) as client:
        message = await _post_completion(client, api_key, payload, 30.0)
    content = message.get("content") if message else None
    if (
        not isinstance(content, str)
        or len(content) > MAX_OUTPUT_CHARS
        or (message and message.get("tool_calls"))
    ):
        raise APIError(
            status_code=503,
            code="assistant_unavailable",
            message="Assistant unavailable. Your text is unchanged; use manual Task creation.",
        )
    try:
        raw = json.loads(content)
    except ValueError:
        raise invalid_output() from None
    if not isinstance(raw, dict):
        raise invalid_output()
    return validate_brain_dump(raw)
