"""The tool roster. THIS LIST IS THE ENFORCEMENT BOUNDARY (ADR 0014).

The process holds the full session cookie, so every endpoint is technically
reachable; what constrains the model is that no tool exists for anything
outside the write set. That is structural against a model, and NOT against a
bug or a compromised binary. HTTP mode is the network transport (ADR 0016);
it changes how clients reach the server, not this roster boundary.

Write tools are admitted by a principle, not a list: idempotent,
non-destructive, scoped to Tasks and Habits. There is no delete tool of any
kind and there will not be one. tests/test_mcp.py pins the roster, so adding
or removing a tool fails loudly.

Writable ids come only from reads in this process (the allowlist): an id the
model never received is rejected, not attempted.
"""

import concurrent.futures
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from tuk_core.client import Client, ClientError
from tuk_core.dates import BadDateError, parse_date
from tuk_core.names import UnknownNameError, resolve_name
from tuk_core.tz import TzError, local_today

from .session import FileSession, Session

PRIORITIES = ["none", "low", "medium", "high"]
DATE_HELP = (
    "today, tomorrow, yesterday, a weekday name, or ISO date YYYY-MM-DD, "
    "optionally followed by a time, e.g. 'tomorrow 14:00'. Judged in the owner's timezone."
)


class ToolError(Exception):
    """A failure worded for the model to relay or correct."""


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    properties: dict[str, Any]
    required: list[str]
    run: Callable[["Toolbox", dict[str, Any]], object]

    def spec(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "inputSchema": {
                "type": "object",
                "properties": self.properties,
                "required": self.required,
                "additionalProperties": False,
            },
        }


def _id(description: str) -> dict[str, Any]:
    return {"type": "integer", "description": description}


TASK_ID = _id("Task id, as returned by get_agenda, search_tasks, get_task or create_task.")


def _brief(task: dict[str, object]) -> dict[str, object]:
    tags = task.get("tags")
    return {
        "id": task.get("id"),
        "title": task.get("title"),
        "completed": task.get("completed"),
        "priority": task.get("priority"),
        "start_date": task.get("start_date"),
        "due_date": task.get("due_date"),
        "is_all_day": task.get("is_all_day"),
        "list_id": task.get("list_id"),
        "recurrence": task.get("recurrence"),
        "tags": [t.get("name") for t in tags if isinstance(t, dict)]
        if isinstance(tags, list)
        else [],
    }


def _items(page: dict[str, object]) -> list[dict[str, object]]:
    rows = page.get("items")
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


class Toolbox:
    def __init__(self, client: Client, session: Session | None = None) -> None:
        self.client = client
        self.session = session or FileSession()
        self.task_ids: set[int] = set()
        self.habit_ids: set[int] = set()
        self._cookie = ""

    # -- plumbing ---------------------------------------------------------
    def has(self, name: str) -> bool:
        return name in TOOLS

    def describe(self) -> list[dict[str, Any]]:
        return [tool.spec() for tool in TOOLS.values()]

    def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        try:
            cookie = self.session.cookie()
            if cookie is None:
                raise ToolError("Not logged in — the owner must run `tuk login` in a terminal.")
            self._cookie = cookie
            try:
                result = TOOLS[name].run(self, arguments)
            except ClientError as exc:
                # One re-login and one retry, never a loop: the backend throttles logins.
                renewed = self.session.renew() if exc.code == "unauthorized" else None
                if renewed is None:
                    raise
                self._cookie = renewed
                result = TOOLS[name].run(self, arguments)
            return {"content": [{"type": "text", "text": json.dumps(result)}]}
        except ClientError as exc:
            if exc.code == "unauthorized":
                text = self.session.expired_hint
            elif exc.code == "setup_required":
                text = "No password set yet — the owner must finish first-run setup in the web app."
            else:
                text = exc.message
        except (ValueError, TypeError) as exc:  # bad model-supplied arguments, e.g. int("x")
            text = f"Invalid arguments: {exc}"
        except (ToolError, UnknownNameError, BadDateError, TzError) as exc:
            text = str(exc)
        return {"isError": True, "content": [{"type": "text", "text": text}]}

    def keep(self, refreshed: str | None) -> None:
        if refreshed:
            self._cookie = refreshed
            self.session.keep(refreshed)

    def writable_task(self, args: dict[str, Any]) -> int:
        task_id = args.get("task_id")
        if not isinstance(task_id, int) or isinstance(task_id, bool):
            raise ToolError("task_id must be an integer.")
        if task_id not in self.task_ids:
            raise ToolError(
                f"Task {task_id} was not read in this session — call get_agenda, "
                "search_tasks or get_task first and use an id they return."
            )
        return task_id

    def seen(self, tasks: list[dict[str, object]]) -> None:
        self.task_ids |= {t["id"] for t in tasks if isinstance(t.get("id"), int)}  # type: ignore[misc]

    def patch(self, task_id: int, body: dict[str, object]) -> dict[str, object]:
        try:
            task, refreshed = self.client.patch_task(task_id, self._cookie, body)
        except ClientError as exc:
            raise self._missing(exc, task_id) from None
        self.keep(refreshed)
        return task

    def fetch(self, task_id: int) -> dict[str, object]:
        try:
            task, refreshed = self.client.show_task(task_id, self._cookie)
        except ClientError as exc:
            raise self._missing(exc, task_id) from None
        self.keep(refreshed)
        return task

    @staticmethod
    def _missing(exc: ClientError, task_id: int) -> Exception:
        if exc.code == "not_found":
            return ToolError(f"Task {task_id} not found.")
        return exc

    def named_id(self, name: str, kind: str) -> int:
        reader = self.client.read_lists if kind == "list" else self.client.read_tags
        items, refreshed = reader(self._cookie)
        self.keep(refreshed)
        return resolve_name(name, items, kind)  # type: ignore[arg-type]

    def schedule_fields(self, args: dict[str, Any]) -> dict[str, object]:
        if args.get("due") is None:
            raise ToolError("due is required.")
        today, zone, zone_key = local_today()
        body: dict[str, object] = {"time_zone": zone_key}
        for field in ("start", "due"):
            word = args.get(field)
            if word is not None:
                body[f"{field}_date"] = parse_date(str(word), today, zone).isoformat()
        # A bare day word is all-day; a word with a time is not.
        body["is_all_day"] = " " not in str(args["due"]).strip()
        return body


# -- reads ------------------------------------------------------------------
def get_agenda(box: Toolbox, args: dict[str, Any]) -> object:
    today, _, zone_key = local_today()
    day, end = today.isoformat(), (today + timedelta(days=6)).isoformat()
    ck = box._cookie
    c = box.client
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        f_tasks = pool.submit(c.list_tasks, ck, "next7", day, 200, 0)
        f_habits = pool.submit(c.list_habits, ck, day)
        f_events = pool.submit(read_events_isolated_range, c, ck, day, end)
        f_lists = pool.submit(c.read_lists, ck)
        f_tags = pool.submit(c.read_tags, ck)
        tasks, c1 = f_tasks.result()
        habits, c2 = f_habits.result()
        events, c3 = f_events.result()
        lists, c4 = f_lists.result()
        tags, c5 = f_tags.result()
    box.keep(c3 or c2 or c1 or c4 or c5)
    rows = _items(tasks)
    box.seen(rows)
    due = _items(habits)
    box.habit_ids |= {h["id"] for h in due if isinstance(h.get("id"), int)}  # type: ignore[misc]
    return {
        "today": day,
        "window_end": end,
        "time_zone": zone_key,
        "tasks": [_brief(t) for t in rows],
        "tasks_total": tasks.get("total"),
        "habits_due_today": [{"id": h.get("id"), "name": h.get("name")} for h in due],
        "events": events,
        "lists": [{"id": x.get("id"), "name": x.get("name")} for x in lists],
        "tags": [{"id": x.get("id"), "name": x.get("name")} for x in tags],
    }


def read_events_isolated_range(
    client: Client, cookie: str, day: str, end: str
) -> tuple[list[dict[str, object]], str | None]:
    try:
        return client.read_events(cookie, day, end)
    except Exception:  # noqa: BLE001 - calendar failure isolation per ADR 0007
        return [], None


def search_tasks(box: Toolbox, args: dict[str, Any]) -> object:
    query = args.get("query")
    if not isinstance(query, str) or not query.strip():
        raise ToolError("query must be a non-empty string.")
    limit = min(int(args.get("limit", 20)), 50)
    page, refreshed = box.client.list_tasks(box._cookie, None, None, limit, 0, search=query.strip())
    box.keep(refreshed)
    rows = _items(page)
    box.seen(rows)
    return {"tasks": [_brief(t) for t in rows], "total": page.get("total")}


def get_task(box: Toolbox, args: dict[str, Any]) -> object:
    task_id = args.get("task_id")
    if not isinstance(task_id, int) or isinstance(task_id, bool):
        raise ToolError("task_id must be an integer.")
    task = box.fetch(task_id)
    box.seen([task])
    return dict(task)


def get_goals(box: Toolbox, args: dict[str, Any]) -> object:
    page, refreshed = box.client.list_goals(box._cookie)
    box.keep(refreshed)
    return dict(page)


def get_focus_stats(box: Toolbox, args: dict[str, Any]) -> object:
    today, _, zone_key = local_today()
    days = int(args.get("days", 7))
    if not 1 <= days <= 366:
        raise ToolError("days must be between 1 and 366.")
    start = (today - timedelta(days=days - 1)).isoformat()
    stats, refreshed = box.client.read_focus_stats(box._cookie, start, today.isoformat(), zone_key)
    box.keep(refreshed)
    return {"start": start, "end": today.isoformat(), "time_zone": zone_key, **stats}


# -- writes -----------------------------------------------------------------
def create_task(box: Toolbox, args: dict[str, Any]) -> object:
    title = args.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ToolError("title must be a non-empty string.")
    body: dict[str, object] = {"title": title.strip()}
    for field in ("description", "priority"):
        if args.get(field) is not None:
            body[field] = args[field]
    if args.get("due") is not None:
        body.update(box.schedule_fields(args))
    if args.get("list") is not None:
        body["list_id"] = box.named_id(str(args["list"]), "list")  # else: Inbox, API's doing
    if args.get("tags"):
        body["tag_ids"] = [box.named_id(str(n), "tag") for n in args["tags"]]
    task, refreshed = box.client.create_task(box._cookie, body)
    box.keep(refreshed)
    box.seen([task])
    return _brief(task)


def schedule_task(box: Toolbox, args: dict[str, Any]) -> object:
    task_id = box.writable_task(args)
    if box.fetch(task_id).get("due_date") is not None:
        raise ToolError(f"Task {task_id} is already scheduled — use reschedule_task.")
    return _brief(box.patch(task_id, box.schedule_fields(args)))


def reschedule_task(box: Toolbox, args: dict[str, Any]) -> object:
    task_id = box.writable_task(args)
    if box.fetch(task_id).get("due_date") is None:
        raise ToolError(f"Task {task_id} is not scheduled — use schedule_task.")
    return _brief(box.patch(task_id, box.schedule_fields(args)))


def complete_task(box: Toolbox, args: dict[str, Any]) -> object:
    task_id = box.writable_task(args)
    task = box.patch(task_id, {"completed": True})
    result = _brief(task)
    # A recurring Task advances in place instead of closing (ADR 0003).
    result["advanced_to_next_occurrence"] = (
        not task.get("completed") and task.get("recurrence") is not None
    )
    return result


def set_priority(box: Toolbox, args: dict[str, Any]) -> object:
    task_id = box.writable_task(args)
    priority = args.get("priority")
    if priority not in PRIORITIES:
        raise ToolError(f"priority must be one of: {', '.join(PRIORITIES)}.")
    return _brief(box.patch(task_id, {"priority": priority}))


def set_list(box: Toolbox, args: dict[str, Any]) -> object:
    task_id = box.writable_task(args)
    list_id = box.named_id(str(args.get("list", "")), "list")
    return _brief(box.patch(task_id, {"list_id": list_id}))


def add_tags(box: Toolbox, args: dict[str, Any]) -> object:
    task_id = box.writable_task(args)
    names = args.get("tags")
    if not isinstance(names, list) or not names:
        raise ToolError("tags must be a non-empty list of existing Tag names.")
    wanted = [box.named_id(str(n), "tag") for n in names]
    # The patch endpoint replaces the whole set, so union with what is there.
    existing = box.fetch(task_id).get("tags")
    have = (
        [t["id"] for t in existing if isinstance(t, dict) and isinstance(t.get("id"), int)]
        if isinstance(existing, list)
        else []
    )
    merged = have + [i for i in dict.fromkeys(wanted) if i not in have]
    return _brief(box.patch(task_id, {"tag_ids": merged}))


def add_check_items(box: Toolbox, args: dict[str, Any]) -> object:
    task_id = box.writable_task(args)
    titles = args.get("titles")
    if not isinstance(titles, list) or not titles or not all(isinstance(t, str) for t in titles):
        raise ToolError("titles must be a non-empty list of strings.")
    task: dict[str, object] = {}
    for title in titles:
        try:
            task, refreshed = box.client.create_check_item(task_id, box._cookie, title)
        except ClientError as exc:
            raise box._missing(exc, task_id) from None
        box.keep(refreshed)
    return {**_brief(task), "check_items": task.get("check_items")}


def check_in_habit(box: Toolbox, args: dict[str, Any]) -> object:
    habit_id = args.get("habit_id")
    if not isinstance(habit_id, int) or habit_id not in box.habit_ids:
        raise ToolError(
            f"Habit {habit_id} was not read in this session — call get_agenda first "
            "and use a habit id it returns."
        )
    today, _, _ = local_today()
    day = args.get("day") or today.isoformat()
    try:
        date.fromisoformat(str(day))
    except ValueError:
        raise ToolError("day must be an ISO date YYYY-MM-DD.") from None
    body, refreshed = box.client.put_check_in(
        box._cookie, habit_id, str(day), float(args.get("value", 1))
    )
    box.keep(refreshed)
    return dict(body)


def _tool(
    name: str,
    description: str,
    props: dict[str, Any],
    required: list[str],
    run: Callable[[Toolbox, dict[str, Any]], object],
) -> tuple[str, Tool]:
    return name, Tool(name, description, props, required, run)


_DUE = {"type": "string", "description": DATE_HELP}
_PRIORITY = {"type": "string", "enum": PRIORITIES}

TOOLS: dict[str, Tool] = dict(
    [
        _tool(
            "get_agenda",
            "START HERE. The owner's open Tasks for today and the next 6 days (with ids), "
            "Habits due today (with ids), calendar Events for that window, and the names of "
            "their Lists and Tags. Call before any write: write tools only accept ids returned "
            "by a read.",
            {},
            [],
            get_agenda,
        ),
        _tool(
            "search_tasks",
            "Find Tasks by text in title or description, any date, open or completed. "
            "Use when a Task is not in the agenda window.",
            {
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
            },
            ["query"],
            search_tasks,
        ),
        _tool(
            "get_task",
            "One Task in full: description, Check Items, Tags, reminders, recurrence.",
            {"task_id": _id("Task id.")},
            ["task_id"],
            get_task,
        ),
        _tool(
            "get_goals",
            "The owner's Goals with their Key Results and progress.",
            {},
            [],
            get_goals,
        ),
        _tool(
            "get_focus_stats",
            "Focus time totals per day and week, and per Task/Habit, for the last N days "
            "ending today.",
            {"days": {"type": "integer", "minimum": 1, "maximum": 366}},
            [],
            get_focus_stats,
        ),
        _tool(
            "create_task",
            "Create a Task. With no list it lands in the Inbox. List and tag names must "
            "already exist (exact, case-insensitive); nothing is created.",
            {
                "title": {"type": "string"},
                "description": {"type": "string"},
                "priority": _PRIORITY,
                "due": _DUE,
                "start": _DUE,
                "list": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            ["title"],
            create_task,
        ),
        _tool(
            "schedule_task",
            "Give an UNSCHEDULED Task a date (block time for it). Fails if already scheduled.",
            {"task_id": TASK_ID, "due": _DUE, "start": _DUE},
            ["task_id", "due"],
            schedule_task,
        ),
        _tool(
            "reschedule_task",
            "Move an already SCHEDULED Task to a new date. Fails if it has no date.",
            {"task_id": TASK_ID, "due": _DUE, "start": _DUE},
            ["task_id", "due"],
            reschedule_task,
        ),
        _tool(
            "complete_task",
            "Mark a Task done. A recurring Task advances to its next occurrence instead of "
            "closing; the result says which happened.",
            {"task_id": TASK_ID},
            ["task_id"],
            complete_task,
        ),
        _tool(
            "set_priority",
            "Set a Task's priority.",
            {"task_id": TASK_ID, "priority": _PRIORITY},
            ["task_id", "priority"],
            set_priority,
        ),
        _tool(
            "set_list",
            "Move a Task to an existing List, by name. Drops the Task's Section.",
            {"task_id": TASK_ID, "list": {"type": "string"}},
            ["task_id", "list"],
            set_list,
        ),
        _tool(
            "add_tags",
            "Add existing Tags to a Task, by name. Keeps the Tags it already has.",
            {"task_id": TASK_ID, "tags": {"type": "array", "items": {"type": "string"}}},
            ["task_id", "tags"],
            add_tags,
        ),
        _tool(
            "add_check_items",
            "Append Check Items (sub-steps) to a Task.",
            {"task_id": TASK_ID, "titles": {"type": "array", "items": {"type": "string"}}},
            ["task_id", "titles"],
            add_check_items,
        ),
        _tool(
            "check_in_habit",
            "Record a Habit check-in (default today). Repeating it for the same day is harmless.",
            {
                "habit_id": _id("Habit id from get_agenda."),
                "day": {"type": "string", "description": "ISO date; default today."},
                "value": {"type": "number", "description": "Numeric habits: amount. Default 1."},
            },
            ["habit_id"],
            check_in_habit,
        ),
    ]
)
