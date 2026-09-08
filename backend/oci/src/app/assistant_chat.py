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

**Read-only drill-down tools (issue #189).** Beyond the snapshot, the model
may call two read-only tools (`find_tasks`, `habit_status`) for questions
the week's window can't answer — capped at `_TOOL_ITERATION_CAP` round
trips per turn (ADR 0009). No tool ever writes; a tool call is answered by
`_execute_tool_call` with a plain result dict, never an exception, and
never anything the caller applies directly. Reaching the cap without a
final answer degrades to the fallback turn, same as an unreachable
provider — never a 5xx.

**Explicit decision (issue #189): tool-surfaced task ids join the writable
allow-list.** `find_tasks` can return a task id from outside the snapshot
(e.g. an overdue task from last week); `validate_turn` unions those ids
into the same set snapshot ids populate, rather than withholding them. This
still can't be gamed into inventing an id — every id `find_tasks` returns
came from a real, read-only database query this turn, never from the
model — and withholding them would silently break the feature's own
example use ("what did I drop last week?" → propose rescheduling it).
"""

import json
import logging
import time
from datetime import UTC, date, datetime, tzinfo
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

import httpx
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant_snapshot import WeekSnapshot
from app.habit_stats import current_streak
from app.models import CheckIn, Habit, Task, TaskList
from app.name_phrase import resolve_name_phrase
from app.routers.v1.tasks import in_range_window
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

# ADR 0009: "a cap of three tool iterations per turn... reaching the cap
# returns whatever Suggestions exist rather than failing the turn." A
# well-formed turn is expected to need none of them.
_TOOL_ITERATION_CAP = 3

_FALLBACK_MESSAGE = (
    "Sorry, I couldn't reach the planning assistant just now. Please try again in a moment."
)

# Distinct from _FALLBACK_MESSAGE: reaching the tool-iteration cap is not a
# provider failure — the provider answered every time, it just never
# stopped asking for tools. Telling the owner "couldn't reach" for that
# would misreport what actually happened (issue #189).
_TOOL_CAP_MESSAGE = (
    "I wasn't able to finish looking into that within the usual number of steps. "
    "Please try asking again, maybe with a narrower question."
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

# Read-only drill-down tools (ADR 0009; issue #189) — fewer than six, for
# questions the week's snapshot can't answer. Every tool call is answered
# by `_execute_tool_call` with a plain read; none of them can write, and
# none of them is a Suggestion — the model still proposes changes only
# through `suggestions[]`.
_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "find_tasks",
            "description": (
                "Search tasks outside the current week's snapshot — e.g. "
                "unfinished tasks from last week, or tasks in a past date "
                "range. Returns tasks the same shape as the snapshot, so "
                "any id returned can be used in a suggestion."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "range_start": {
                        "type": "string",
                        "description": "Inclusive start date (YYYY-MM-DD) of the search window.",
                    },
                    "range_end": {
                        "type": "string",
                        "description": "Inclusive end date (YYYY-MM-DD) of the search window.",
                    },
                    "completed": {
                        "type": ["boolean", "null"],
                        "description": "Filter by completion state; omit/null for either.",
                    },
                },
                "required": ["range_start", "range_end", "completed"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "habit_status",
            "description": (
                "The current streak for one habit by name (a name from the "
                "snapshot's 'habits' list) — for questions like 'which "
                "habits am I behind on?' the snapshot's name-only list can't "
                "answer on its own."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "habit_name": {"type": "string", "description": "An exact habit name."},
                },
                "required": ["habit_name"],
                "additionalProperties": False,
            },
        },
    },
]

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

You may only reference a task by an "id" that already appeared this turn — \
either in the snapshot below, or in the result of a tool call you made — \
never invent an id, and never reference a task that isn't listed. \
You may only reference a List or Tag by a name that already appears in \
"list_names" / "tag_names" below — never invent a new List or Tag name.

Two read-only tools are available for questions this week's snapshot \
can't answer: find_tasks (tasks outside the current week, e.g. last \
week's unfinished tasks) and habit_status (one habit's current streak). \
Use them only when the owner's question needs them — most turns need \
neither. Every tool result you use to answer honestly reflects reality; \
never guess an answer a tool would give.

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

Dates are ISO-8601 datetimes with an offset. A dated task always needs a \
due_date: for a task at a single moment ("tomorrow at 9 a.m.") put that \
moment in due_date and leave start_date null; only use start_date for a \
task that genuinely spans a range, and then start_date must be earlier \
than due_date on the same calendar day. All-day dates are date-only \
(midnight). Leave every field you don't need null or empty rather than \
guessing. Respond only with the JSON object described by \
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


def _completion_payload(model: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "model": model,
        "messages": messages,
        "tools": _TOOLS,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "assistant_turn",
                "schema": _RESPONSE_SCHEMA,
                "strict": True,
            },
        },
    }


async def _post_completion(
    client: httpx.AsyncClient, api_key: str, payload: dict[str, Any], remaining_seconds: float
) -> dict[str, Any] | None:
    """One `/chat/completions` call, given the time left in the turn's
    budget. Returns the raw `message` object, or None on any failure —
    no time left, unreachable, non-200, or an unparseable body — so the
    caller always has an apologetic fallback to degrade to (never raises,
    per ADR 0009 mirroring `app.assist`)."""
    if remaining_seconds <= 0:
        return None
    try:
        response = await client.post(
            "/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=remaining_seconds,
        )
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    try:
        body = response.json()
        message = body["choices"][0]["message"]
    except (ValueError, KeyError, TypeError, IndexError):
        return None
    return message if isinstance(message, dict) else None


def _parse_date(value: object) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


async def _find_tasks(
    session: AsyncSession, arguments: dict[str, Any]
) -> tuple[dict[str, Any], set[int]]:
    """The `find_tasks` tool: tasks whose scheduled window intersects
    [range_start, range_end], outside the week the snapshot already
    covers. Reuses `in_range_window`, the same predicate the calendar's
    own range query runs in Python, rather than a second date dialect."""
    range_start = _parse_date(arguments.get("range_start"))
    range_end = _parse_date(arguments.get("range_end"))
    if range_start is None or range_end is None or range_start > range_end:
        return {
            "error": "range_start and range_end must be YYYY-MM-DD dates, start on or before end"
        }, set()
    completed = arguments.get("completed")
    list_names = {row.id: row.name for row in await session.scalars(select(TaskList))}
    rows = await session.scalars(select(Task).order_by(Task.sort_order, Task.id))
    matches = [
        task
        for task in rows
        if in_range_window(task, range_start, range_end)
        and (completed is None or task.completed == bool(completed))
    ]
    # Breadth here costs tokens the same way the snapshot's does — capped
    # well below what a real week could return, per ADR 0009's "breadth in
    # a tool loop costs reliability."
    matches = matches[:20]
    tasks = [
        {
            "id": task.id,
            "title": task.title,
            "start_date": task.start_date.isoformat() if task.start_date is not None else None,
            "due_date": task.due_date.isoformat() if task.due_date is not None else None,
            "is_all_day": task.is_all_day,
            "priority": task.priority,
            "list_name": list_names.get(task.list_id, ""),
            "tag_names": [tag.name for tag in task.tags],
            "completed": task.completed,
        }
        for task in matches
    ]
    return {"tasks": tasks}, {task.id for task in matches}


async def _habit_status(
    session: AsyncSession, arguments: dict[str, Any], local_date: date
) -> tuple[dict[str, Any], set[int]]:
    """The `habit_status` tool: one habit's current streak, judged as of
    the caller's own local day — never server time, same discipline as the
    snapshot itself."""
    habit_name = arguments.get("habit_name")
    if not isinstance(habit_name, str) or not habit_name.strip():
        return {"error": "habit_name is required"}, set()
    habit = await session.scalar(select(Habit).where(Habit.name == habit_name, ~Habit.is_archived))
    if habit is None:
        return {"error": f"no habit named {habit_name!r}"}, set()
    checked = {
        row.date
        for row in await session.scalars(select(CheckIn).where(CheckIn.habit_id == habit.id))
    }
    streak = current_streak(habit.frequency, checked, local_date)
    return {"habit_name": habit.name, "current_streak": streak}, set()


async def _execute_tool_call(
    call: dict[str, Any], session: AsyncSession, local_date: date
) -> tuple[dict[str, Any], set[int]]:
    """Runs one read-only tool call, never raising: malformed arguments, an
    unknown tool name, or a bad query all degrade to an `{"error": ...}`
    result the model can react to conversationally, rather than failing
    the whole turn (issue #189: tool errors degrade into the turn)."""
    function = call.get("function")
    name = function.get("name") if isinstance(function, dict) else None
    raw_arguments = function.get("arguments") if isinstance(function, dict) else None
    try:
        arguments = json.loads(raw_arguments) if isinstance(raw_arguments, str) else {}
    except ValueError:
        return {"error": "invalid tool arguments"}, set()
    if not isinstance(arguments, dict):
        return {"error": "invalid tool arguments"}, set()
    if name == "find_tasks":
        return await _find_tasks(session, arguments)
    if name == "habit_status":
        return await _habit_status(session, arguments, local_date)
    return {"error": f"unknown tool {name!r}"}, set()


async def request_assistant_turn(
    base_url: str,
    model: str,
    api_key: str,
    messages: list[dict[str, Any]],
    session: AsyncSession,
    local_date: date,
) -> tuple[dict[str, Any] | None, set[int], bool]:
    """The whole turn against an OpenAI-compatible provider, including any
    read-only tool round trips (ADR 0009; issue #189). Returns the parsed
    final `{message, suggestions}` object, every task id surfaced by a tool
    call this turn (the writable allow-list `validate_turn` unions into the
    snapshot's own ids — see the module docstring's explicit decision), and
    whether the tool-iteration cap was reached without a final answer.

    The cap-hit flag matters because it is a *different* failure than an
    unreachable provider — the provider answered every time, it just never
    stopped asking for tools — and the caller reports it with a distinct,
    honest message (`_TOOL_CAP_MESSAGE`) rather than the generic
    "couldn't reach" fallback.

    One deadline covers the whole turn, tool calls included: each
    `/chat/completions` call gets whatever's left of `_TIMEOUT_SECONDS`,
    not a fresh budget of its own. At most `_TOOL_ITERATION_CAP` tool
    round trips run; reaching the cap without a final answer still
    degrades non-fatally — no Suggestions, never a 5xx — per ADR 0009's
    "reaching the cap returns whatever Suggestions exist rather than
    failing the turn" (which is none, since Suggestions only ever arrive
    in a final answer)."""
    deadline = time.monotonic() + _TIMEOUT_SECONDS
    extra_task_ids: set[int] = set()
    messages = list(messages)
    async with httpx.AsyncClient(base_url=base_url, timeout=_TIMEOUT_SECONDS) as client:
        for iteration in range(_TOOL_ITERATION_CAP + 1):
            payload = _completion_payload(model, messages)
            message = await _post_completion(client, api_key, payload, deadline - time.monotonic())
            if message is None:
                return None, extra_task_ids, False

            tool_calls = message.get("tool_calls")
            if not tool_calls or not isinstance(tool_calls, list):
                content = message.get("content")
                try:
                    parsed = json.loads(content) if isinstance(content, str) else None
                except ValueError:
                    return None, extra_task_ids, False
                if not isinstance(parsed, dict):
                    return None, extra_task_ids, False
                return parsed, extra_task_ids, False

            if iteration >= _TOOL_ITERATION_CAP:
                # The cap is reached and the model still wants to call a
                # tool rather than answer: no further tool round trips run.
                return None, extra_task_ids, True

            messages.append(
                {
                    "role": "assistant",
                    "content": message.get("content"),
                    "tool_calls": tool_calls,
                }
            )
            for call in tool_calls:
                result, ids = await _execute_tool_call(call, session, local_date)
                extra_task_ids |= ids
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id") if isinstance(call, dict) else None,
                        "content": json.dumps(result),
                    }
                )
    return None, extra_task_ids, False  # pragma: no cover - loop always returns above


def _coerce_datetime(value: object) -> datetime | None:
    """A wire value as an aware UTC datetime, or None when absent/unparseable.
    Naive input is taken as UTC, matching `app.schemas.normalize_to_utc`."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _normalize_schedule(
    start_date: object,
    due_date: object,
    is_all_day: bool,
    time_zone: object,
) -> tuple[datetime | None, datetime | None, bool, str | None]:
    """Bends a model-proposed schedule into one the v1 schedule invariants
    accept (`app.routers.v1.tasks.validate_schedule`), rather than letting
    the owner discover the mismatch as a red "Failed:" on a card.

    Models routinely answer "tomorrow at 9 a.m." as a lone `start_date`,
    which the API rejects — a start requires a due. The owner's intent is a
    point in time, so a lone start becomes start == due; an inverted pair is
    swapped; all-day values are floored to midnight UTC; a timed pair that
    straddles two local days keeps the due and drops the start; and an
    unknown IANA key is dropped rather than failing the whole Suggestion.
    """
    zone: tzinfo = UTC
    zone_name: str | None = None
    if isinstance(time_zone, str) and time_zone:
        try:
            zone = ZoneInfo(time_zone)
        except (KeyError, ValueError):
            zone = UTC
        else:
            zone_name = time_zone

    start = _coerce_datetime(start_date)
    due = _coerce_datetime(due_date)

    if start is not None and due is not None and start > due:
        start, due = due, start
    if due is None:
        due = start
    if is_all_day:
        start = None if start is None else start.replace(hour=0, minute=0, second=0, microsecond=0)
        due = None if due is None else due.replace(hour=0, minute=0, second=0, microsecond=0)
    elif (
        start is not None
        and due is not None
        and start.astimezone(zone).date() != due.astimezone(zone).date()
    ):
        start = None
    if due is None:
        # Nothing to schedule at all: an all-day flag with no date is a
        # schedule the API would reject on its own.
        is_all_day = False
    return start, due, is_all_day, zone_name


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
            start, due, all_day, zone_name = _normalize_schedule(
                raw.get("start_date"),
                raw.get("due_date"),
                bool(raw.get("is_all_day") or False),
                raw.get("time_zone"),
            )
            return CreateTaskSuggestion(
                title=raw.get("title") or "",
                list_name=list_name,
                tag_names=resolved_tags,
                priority=raw.get("priority") or "none",
                start_date=start,
                due_date=due,
                is_all_day=all_day,
                time_zone=zone_name,
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
            start, due, all_day, zone_name = _normalize_schedule(
                raw.get("start_date"),
                raw.get("due_date"),
                bool(raw.get("is_all_day") or False),
                raw.get("time_zone"),
            )
            if due is None:
                logger.info("assistant: discarding %s with no usable date to set", suggestion_type)
                return None
            return model_cls(
                task_id=task_id,
                start_date=start,
                due_date=due,
                is_all_day=all_day,
                time_zone=zone_name,
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


def validate_turn(
    raw: dict[str, Any], snapshot: WeekSnapshot, extra_task_ids: set[int] | None = None
) -> AssistantChatTurn:
    """Validates one provider response against the snapshot just sent, plus
    any task ids a read-only tool call surfaced this same turn
    (`extra_task_ids` — issue #189's explicit decision that tool-surfaced
    ids join the writable allow-list, documented in the module docstring).
    Never raises: an unparseable shape degrades to the apologetic fallback
    message with no Suggestions, exactly like an unreachable provider."""
    message = raw.get("message")
    if not isinstance(message, str) or not message.strip():
        return AssistantChatTurn(message=_FALLBACK_MESSAGE, suggestions=[], discarded_count=0)

    raw_suggestions = raw.get("suggestions")
    if not isinstance(raw_suggestions, list):
        return AssistantChatTurn(message=message, suggestions=[], discarded_count=0)

    task_ids = {task.id for task in snapshot.tasks} | (extra_task_ids or set())
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


def tool_cap_turn() -> AssistantChatTurn:
    """The turn shown when `request_assistant_turn` hits the tool-iteration
    cap without a final answer (issue #189) — distinct from `fallback_turn`
    because this is not a provider failure, and telling the owner
    "couldn't reach" would misreport what happened."""
    return AssistantChatTurn(message=_TOOL_CAP_MESSAGE, suggestions=[], discarded_count=0)
