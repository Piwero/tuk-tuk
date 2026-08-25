"""The Assistant's chat turn (ADR 0009; issue #187): one OpenAI-compatible
`/chat/completions` call, plus the Suggestion vocabulary and the validation
that stands between whatever the model returns and anything a caller could
act on.

Mirrors `app.assist`'s never-raises posture: an unreachable provider, a
timeout, or an unparseable response all degrade to an apologetic assistant
message with no Suggestions, never a 5xx and never an exception a router
has to catch.

**Writes are not tools (ADR 0009).** There is no write tool in the request
sent to the provider — the model can only ever answer with prose plus a
`suggestions[]` array via structured output. Validation here is what makes
that guarantee real rather than aspirational: every Suggestion is
Pydantic-shaped, and every task id it names must already have appeared in
the snapshot sent this turn (`app.assistant_snapshot`) — there is no other
identifier in play, so a Suggestion naming anything else is unrepresentable
rather than merely rejected. `set_list`/`add_tags` resolve only against
List/Tag names the snapshot carried, through the same `resolve_name_phrase`
discipline Assisted Capture uses (issue #45) — the Assistant brings no List
or Tag into being, exactly as an unpicked Quick-Add token does not.
"""

import json
import logging
from datetime import datetime
from typing import Annotated, Any, Literal

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.assistant_snapshot import WeekSnapshot
from app.name_phrase import resolve_name_phrase
from app.schemas import Priority

logger = logging.getLogger(__name__)

# A chat turn is a deliberate, session-based interaction (ADR 0009) — long
# enough for a real completion, short enough that a hung provider doesn't
# strand the request indefinitely.
_TIMEOUT_SECONDS = 30.0

# The transcript cap (ADR 0009's accepted trade-off): a long session's cost
# grows quadratically since the whole transcript re-sends every turn, so it
# is bounded and trimmed oldest-first. The system prompt is never part of
# this list — it is always sent in addition to it.
_TRANSCRIPT_MESSAGE_CAP = 20

_FALLBACK_MESSAGE = (
    "Sorry, I couldn't reach the planning assistant just now. Please try again in a moment."
)

_SUGGESTION_TYPES = (
    "create_task",
    "schedule_task",
    "reschedule_task",
    "complete_task",
    "set_priority",
    "set_list",
    "add_tags",
    "add_check_items",
)

# A single flat schema shared by every Suggestion shape (mirrors
# `app.assist._EXTRACTION_SCHEMA`'s precedent of one shape rather than a
# `oneOf` per type) — friendlier to the range of OpenAI-compatible
# providers ADR 0009 targets. Every field the model doesn't need for a
# given `type` is simply left null; the real per-type shape is enforced in
# Python by `_build_suggestion`, never trusted from the wire.
_SUGGESTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": list(_SUGGESTION_TYPES)},
        "task_id": {"type": ["integer", "null"]},
        "title": {"type": ["string", "null"]},
        "list_name": {"type": ["string", "null"]},
        "tag_names": {"type": "array", "items": {"type": "string"}},
        "priority": {"type": ["string", "null"]},
        "start_date": {"type": ["string", "null"]},
        "due_date": {"type": ["string", "null"]},
        "is_all_day": {"type": ["boolean", "null"]},
        "time_zone": {"type": ["string", "null"]},
        "check_item_titles": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "type",
        "task_id",
        "title",
        "list_name",
        "tag_names",
        "priority",
        "start_date",
        "due_date",
        "is_all_day",
        "time_zone",
        "check_item_titles",
    ],
    "additionalProperties": False,
}

_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "message": {"type": "string"},
        "suggestions": {"type": "array", "items": _SUGGESTION_SCHEMA},
    },
    "required": ["message", "suggestions"],
    "additionalProperties": False,
}

_SYSTEM_PROMPT_TEMPLATE = """You are the Assistant inside tuk-tuk, a task manager. The owner \
describes their day or week in prose; you reply with a short, friendly \
plan in the same language they wrote in (English or Spanish — never \
translate), plus zero or more structured suggestions.

You cannot write anything directly. Every change you want made must be \
expressed as one entry in a "suggestions" array; the owner reviews and \
accepts each one by hand. There is no delete suggestion of any kind — \
never propose removing a task.

Treat every entry in "events" as an immovable wall today: never suggest \
scheduling a task on top of one. Plan tasks into the gaps between them and \
around the owner's stated preferences below, which apply exactly as \
written every turn:

Planning preferences: {planning_preferences}

You may only reference a task by the "id" it already has in the snapshot \
below — never invent an id, and never reference a task that isn't listed. \
You may only reference a List or Tag by a name that already appears in \
"list_names" / "tag_names" below — never invent a new List or Tag name.

Today is {local_date} in the {time_zone} timezone. Snapshot of today and \
the next seven days:

{snapshot_json}

Each suggestion is one JSON object with a "type" field, one of:
- create_task: title (required), and optionally list_name, tag_names, \
priority (one of none/low/medium/high), start_date, due_date, is_all_day, \
time_zone.
- schedule_task / reschedule_task: task_id (required, from the snapshot), \
and start_date and/or due_date, plus is_all_day and time_zone.
- complete_task: task_id (required).
- set_priority: task_id and priority (required, one of \
none/low/medium/high).
- set_list: task_id and list_name (required, an existing name from the \
snapshot).
- add_tags: task_id and tag_names (required, existing names from the \
snapshot).
- add_check_items: task_id and check_item_titles (required, one or more \
short strings).

Dates are ISO-8601 datetimes. Leave every field you don't need null or \
empty rather than guessing. Respond only with the JSON object described by \
the schema — a "message" string plus a "suggestions" array."""


class AssistantChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class CreateTaskSuggestion(BaseModel):
    type: Literal["create_task"] = "create_task"
    title: str = Field(min_length=1, max_length=500)
    list_name: str | None = None
    tag_names: list[str] = Field(default_factory=list)
    priority: Priority = "none"
    start_date: datetime | None = None
    due_date: datetime | None = None
    is_all_day: bool = False
    time_zone: str | None = None


class ScheduleTaskSuggestion(BaseModel):
    type: Literal["schedule_task"] = "schedule_task"
    task_id: int
    start_date: datetime | None = None
    due_date: datetime | None = None
    is_all_day: bool = False
    time_zone: str | None = None


class RescheduleTaskSuggestion(BaseModel):
    type: Literal["reschedule_task"] = "reschedule_task"
    task_id: int
    start_date: datetime | None = None
    due_date: datetime | None = None
    is_all_day: bool = False
    time_zone: str | None = None


class CompleteTaskSuggestion(BaseModel):
    type: Literal["complete_task"] = "complete_task"
    task_id: int


class SetPrioritySuggestion(BaseModel):
    type: Literal["set_priority"] = "set_priority"
    task_id: int
    priority: Priority


class SetListSuggestion(BaseModel):
    type: Literal["set_list"] = "set_list"
    task_id: int
    list_name: str


class AddTagsSuggestion(BaseModel):
    type: Literal["add_tags"] = "add_tags"
    task_id: int
    tag_names: list[str] = Field(min_length=1)


class AddCheckItemsSuggestion(BaseModel):
    type: Literal["add_check_items"] = "add_check_items"
    task_id: int
    check_item_titles: list[str] = Field(min_length=1)


Suggestion = Annotated[
    CreateTaskSuggestion
    | ScheduleTaskSuggestion
    | RescheduleTaskSuggestion
    | CompleteTaskSuggestion
    | SetPrioritySuggestion
    | SetListSuggestion
    | AddTagsSuggestion
    | AddCheckItemsSuggestion,
    Field(discriminator="type"),
]


class AssistantChatTurn(BaseModel):
    message: str
    suggestions: list[Suggestion]
    discarded_count: int


def _capped_transcript(
    transcript: list[AssistantChatMessage],
) -> list[AssistantChatMessage]:
    if len(transcript) <= _TRANSCRIPT_MESSAGE_CAP:
        return transcript
    return transcript[-_TRANSCRIPT_MESSAGE_CAP:]


def build_messages(
    planning_preferences: str | None,
    snapshot: WeekSnapshot,
    transcript: list[AssistantChatMessage],
) -> list[dict[str, str]]:
    """The wire messages for one turn: a system prompt carrying the
    planning preferences verbatim and the whole snapshot, followed by the
    capped transcript. The system prompt is never counted against the cap
    — only the owner/assistant turns are trimmed."""
    system_content = _SYSTEM_PROMPT_TEMPLATE.format(
        planning_preferences=planning_preferences or "(none given)",
        local_date=snapshot.local_date.isoformat(),
        time_zone=snapshot.time_zone,
        snapshot_json=snapshot.model_dump_json(),
    )
    messages = [{"role": "system", "content": system_content}]
    messages.extend(
        {"role": turn.role, "content": turn.content} for turn in _capped_transcript(transcript)
    )
    return messages


async def request_assistant_turn(
    base_url: str, model: str, api_key: str, messages: list[dict[str, str]]
) -> dict[str, Any] | None:
    """One `/chat/completions` call against an OpenAI-compatible provider.
    Returns the parsed `{message, suggestions}` object, or None on any
    failure — unreachable, non-200, or a response that isn't the JSON
    object asked for — so the caller always has an apologetic fallback to
    degrade to (never raises, per ADR 0009 mirroring `app.assist`)."""
    payload = {
        "model": model,
        "messages": messages,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "assistant_turn",
                "schema": _RESPONSE_SCHEMA,
                "strict": True,
            },
        },
    }
    try:
        async with httpx.AsyncClient(base_url=base_url, timeout=_TIMEOUT_SECONDS) as client:
            response = await client.post(
                "/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    try:
        body = response.json()
        content = body["choices"][0]["message"]["content"]
        parsed = json.loads(content)
    except (ValueError, KeyError, TypeError, IndexError):
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed


def _resolve_names(phrases: list[str], candidates: list[str]) -> list[str] | None:
    """Resolves every phrase against `candidates` (issue #45's discipline);
    None if any phrase fails to resolve to an existing name — a Suggestion
    naming even one nonexistent List/Tag has no legitimate representation,
    same as a Suggestion naming an unknown task id."""
    resolved: list[str] = []
    for phrase in phrases:
        match = resolve_name_phrase(phrase, candidates)
        if match is None:
            return None
        if match not in resolved:
            resolved.append(match)
    return resolved


def _build_suggestion(raw: object, snapshot: WeekSnapshot, task_ids: set[int]) -> Suggestion | None:
    """Builds one validated Suggestion from a raw wire object, or None —
    logging why — when it can't be represented. Every failure mode
    (unknown type, missing/invalid field, a task id or List/Tag name
    outside the snapshot) collapses to the same None, per ADR 0009: the
    caller only ever needs a count, and the reason is for the operator."""
    if not isinstance(raw, dict):
        logger.info("assistant: discarding non-object suggestion: %r", raw)
        return None
    suggestion_type = raw.get("type")
    if suggestion_type not in _SUGGESTION_TYPES:
        logger.info("assistant: discarding suggestion with unknown type: %r", suggestion_type)
        return None

    task_id = raw.get("task_id")
    if suggestion_type != "create_task" and (
        not isinstance(task_id, int) or task_id not in task_ids
    ):
        logger.info(
            "assistant: discarding %s referencing task id outside the snapshot: %r",
            suggestion_type,
            task_id,
        )
        return None

    try:
        if suggestion_type == "create_task":
            list_name = raw.get("list_name")
            if list_name is not None:
                resolved = resolve_name_phrase(list_name, snapshot.list_names)
                if resolved is None:
                    logger.info("assistant: discarding create_task with unknown list %r", list_name)
                    return None
                list_name = resolved
            tag_names = raw.get("tag_names") or []
            resolved_tags = _resolve_names(tag_names, snapshot.tag_names)
            if resolved_tags is None:
                logger.info("assistant: discarding create_task with unknown tag in %r", tag_names)
                return None
            return CreateTaskSuggestion(
                title=raw.get("title") or "",
                list_name=list_name,
                tag_names=resolved_tags,
                priority=raw.get("priority") or "none",
                start_date=raw.get("start_date"),
                due_date=raw.get("due_date"),
                is_all_day=bool(raw.get("is_all_day") or False),
                time_zone=raw.get("time_zone"),
            )

        if suggestion_type in ("schedule_task", "reschedule_task"):
            if not raw.get("start_date") and not raw.get("due_date"):
                logger.info("assistant: discarding %s with no date to set", suggestion_type)
                return None
            model_cls = (
                ScheduleTaskSuggestion
                if suggestion_type == "schedule_task"
                else RescheduleTaskSuggestion
            )
            return model_cls(
                task_id=task_id,
                start_date=raw.get("start_date"),
                due_date=raw.get("due_date"),
                is_all_day=bool(raw.get("is_all_day") or False),
                time_zone=raw.get("time_zone"),
            )

        if suggestion_type == "complete_task":
            return CompleteTaskSuggestion(task_id=task_id)

        if suggestion_type == "set_priority":
            return SetPrioritySuggestion(task_id=task_id, priority=raw.get("priority"))

        if suggestion_type == "set_list":
            list_name = raw.get("list_name")
            if not list_name:
                logger.info("assistant: discarding set_list with no list_name")
                return None
            resolved = resolve_name_phrase(list_name, snapshot.list_names)
            if resolved is None:
                logger.info("assistant: discarding set_list with unknown list %r", list_name)
                return None
            return SetListSuggestion(task_id=task_id, list_name=resolved)

        if suggestion_type == "add_tags":
            tag_names = raw.get("tag_names") or []
            resolved_tags = _resolve_names(tag_names, snapshot.tag_names)
            if not resolved_tags:
                logger.info(
                    "assistant: discarding add_tags with no resolvable tag in %r", tag_names
                )
                return None
            return AddTagsSuggestion(task_id=task_id, tag_names=resolved_tags)

        if suggestion_type == "add_check_items":
            titles = [
                title
                for title in (raw.get("check_item_titles") or [])
                if isinstance(title, str) and title.strip()
            ]
            if not titles:
                logger.info("assistant: discarding add_check_items with no titles")
                return None
            return AddCheckItemsSuggestion(task_id=task_id, check_item_titles=titles)
    except (ValidationError, TypeError, ValueError) as exc:
        logger.info("assistant: discarding %s: %s", suggestion_type, exc)
        return None

    logger.info("assistant: discarding suggestion of unhandled type: %r", suggestion_type)
    return None


def validate_turn(raw: dict[str, Any], snapshot: WeekSnapshot) -> AssistantChatTurn:
    """Validates one provider response against the snapshot just sent.
    Never raises: an unparseable shape degrades to the apologetic fallback
    message with no Suggestions, exactly like an unreachable provider."""
    message = raw.get("message")
    if not isinstance(message, str) or not message.strip():
        return AssistantChatTurn(message=_FALLBACK_MESSAGE, suggestions=[], discarded_count=0)

    raw_suggestions = raw.get("suggestions")
    if not isinstance(raw_suggestions, list):
        return AssistantChatTurn(message=message, suggestions=[], discarded_count=0)

    task_ids = {task.id for task in snapshot.tasks}
    valid: list[Suggestion] = []
    discarded = 0
    for item in raw_suggestions:
        built = _build_suggestion(item, snapshot, task_ids)
        if built is None:
            discarded += 1
        else:
            valid.append(built)
    return AssistantChatTurn(message=message, suggestions=valid, discarded_count=discarded)


def fallback_turn() -> AssistantChatTurn:
    return AssistantChatTurn(message=_FALLBACK_MESSAGE, suggestions=[], discarded_count=0)
