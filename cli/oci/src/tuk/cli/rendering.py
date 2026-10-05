"""Shared output formatting: tables, task/habit rendering, raw JSON passthrough."""

import sys
from collections.abc import Sequence
from datetime import datetime
from zoneinfo import ZoneInfo

from tuk.client import Body


def format_task(task: dict[str, object]) -> str:
    lines = [f"#{task.get('id')} {task.get('title')}"]
    lines.append(f"Status: {'done' if task.get('completed') else 'open'}")
    lines.append(f"Priority: {task.get('priority', 'none')}")
    if task.get("due_date"):
        lines.append(f"Due: {task.get('due_date')}")
    tags = task.get("tags")
    if isinstance(tags, list) and tags:
        names = [str(tag.get("name")) for tag in tags if isinstance(tag, dict)]
        lines.append(f"Tags: {', '.join(names)}")
    items = task.get("check_items")
    if isinstance(items, list) and items:
        done = sum(1 for item in items if isinstance(item, dict) and item.get("done"))
        lines.append(f"Check items: {done}/{len(items)} done")
    if task.get("description"):
        lines.append(str(task.get("description")))
    return "\n".join(lines)


def aligned_table(headers: tuple[str, ...], rows: Sequence[tuple[str, ...]]) -> list[str]:
    """A column-aligned table, header row included. Every listing renders
    through this, so columns line up the same way whatever is being listed."""
    widths = [len(header) for header in headers]
    for row in rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))

    def aligned(cells: tuple[str, ...]) -> str:
        return "  ".join(cell.ljust(widths[index]) for index, cell in enumerate(cells)).rstrip()

    return [aligned(headers)] + [aligned(row) for row in rows]


def more_line(more: int) -> list[str]:
    """What a page left behind. Reading one page rather than walking the whole
    collection is only safe if the remainder is stated — a listing that
    silently stopped at the page boundary would look complete."""
    if more <= 0:
        return []
    return [f"… {more} more result{'s' if more != 1 else ''} not shown."]


def format_ls(tasks: list[dict[str, object]], zone: ZoneInfo, zone_key: str, more: int = 0) -> str:
    rows = [
        (
            str(task.get("id")),
            str(task.get("title")),
            format_due(task, zone),
            str(task.get("priority", "none")),
        )
        for task in tasks
    ]
    lines = aligned_table(("ID", "TITLE", "DUE", "PRIORITY"), rows)
    lines.append(f"Dates in {zone_key}.")
    return "\n".join(lines + more_line(more))


def page_items(page: dict[str, object]) -> list[dict[str, object]]:
    """The rows of an API page body. The body itself is what `--json` prints,
    so rendering reads the rows out of it rather than the client returning a
    second, rebuilt shape."""
    items = page.get("items")
    if not isinstance(items, list):
        return []
    return [row for row in items if isinstance(row, dict)]


def remaining_count(page: dict[str, object], shown: int) -> int:
    total = page.get("total")
    offset = page.get("offset")
    if not isinstance(total, int) or not isinstance(offset, int):
        return 0
    return max(0, total - offset - shown)


def format_due(task: dict[str, object], zone: ZoneInfo) -> str:
    raw = task.get("due_date")
    if not isinstance(raw, str):
        return "-"
    try:
        moment = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return raw
    if task.get("is_all_day"):
        # All-day values are date-only (midnight UTC by API convention) — the
        # backend reads them in UTC, so the display must too. Converting them
        # through the local zone would shift the day for negative offsets.
        return moment.date().isoformat()
    if moment.tzinfo is None:
        return raw
    return moment.astimezone(zone).isoformat()


def occurrence_suffix(task: dict[str, object], zone: ZoneInfo, zone_key: str) -> str:
    """The occurrence a recurring Task advanced to, or nothing when the
    response carries no date.

    Rendered by `format_due`, the same way a listing renders a date: a raw UTC
    instant printed here would be the one date in the client's output the
    owner has to convert themselves. The zone is only named when the value
    actually went through it — `format_due` passes a date it cannot parse
    straight back, and labelling that with a zone would be a lie.
    """
    if not isinstance(task.get("due_date"), str):
        return ""
    rendered = format_due(task, zone)
    converted = rendered != task.get("due_date")
    return f" to its next occurrence {rendered}{f' ({zone_key})' if converted else ''}"


def format_habits(habits: list[dict[str, object]], more: int = 0) -> str:
    rows = [(str(habit.get("id")), str(habit.get("name"))) for habit in habits]
    lines = aligned_table(("ID", "HABIT"), rows)
    return "\n".join(lines + more_line(more))


def format_check_items(task: dict[str, object]) -> str:
    """The parent Task with its checklist, rendered from the mutation response
    already returned — a second read would only re-fetch what the API sent."""
    lines = [f"#{task.get('id')} {task.get('title')}"]
    items = task.get("check_items")
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict):
                mark = "x" if item.get("done") else " "
                lines.append(f"[{mark}] {item.get('id')} {item.get('title')}")
    return "\n".join(lines)


def print_raw(body: Body) -> None:
    """The API's response body, byte for byte. Not `json.dumps` of the parsed
    object: that escapes non-ASCII, re-formats numbers and normalises
    whitespace, which would make `--json` a second schema rather than a
    transparent window onto the API.

    Written to the byte layer, so nothing re-encodes on the way out. The text
    layer is flushed first because the two buffer independently and a
    human-readable line printed earlier must not land after this one."""
    sys.stdout.flush()
    sys.stdout.buffer.write(body.raw.rstrip(b"\n") + b"\n")
    sys.stdout.buffer.flush()
