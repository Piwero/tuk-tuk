"""Check item commands: add, tick, untick."""

import sys
from zoneinfo import ZoneInfo

from tuk.client import Client, ClientError
from tuk.store import write_session_cookie

from ..errors import report_client_error, report_task_error
from ..rendering import format_check_items, occurrence_suffix, print_raw
from ..session import require_session, require_today


def cmd_check_add(client: Client, task_id: int, title: str, as_json: bool) -> int:
    cookie = require_session()
    if cookie is None:
        return 1
    try:
        task, refreshed = client.create_check_item(task_id, cookie, title)
    except ClientError as exc:
        report_task_error(exc, task_id, "Could not add check item")
        return 1
    if as_json:
        print_raw(task)
    else:
        print(f"Added check item to task #{task_id}.")
        print(format_check_items(task))
    if refreshed:
        write_session_cookie(refreshed)
    return 0


def _check_tick_line(
    task_id: int,
    check_item_id: int,
    task: dict[str, object],
    ticking: bool,
    zone: ZoneInfo,
    zone_key: str,
) -> str:
    """What ticking did to the parent. The API completes the Task when its
    last open line closes — a recurring one advances instead (ADR 0003) — so
    the command names the aggregate effect; without it the Task closing (or
    its dates jumping) reads as the command misbehaving."""
    # Completed because of this tick: every line is now closed. A tick on an
    # already-completed Task (all lines long closed) reports a plain tick —
    # the response alone cannot say what caused the completion, but an open
    # line remaining rules this tick out.
    if ticking and task.get("completed") and _all_items_done(task):
        return f"Check item #{check_item_id} ticked — task #{task_id} completed."
    if ticking and _advanced_instead(task, check_item_id):
        suffix = occurrence_suffix(task, zone, zone_key)
        return f"Check item #{check_item_id} ticked — task #{task_id} advanced{suffix}."
    verb = "ticked" if ticking else "unticked"
    return f"Check item #{check_item_id} {verb}."


def _all_items_done(task: dict[str, object]) -> bool:
    items = task.get("check_items")
    return (
        isinstance(items, list)
        and bool(items)
        and all(isinstance(item, dict) and item.get("done") for item in items)
    )


def _advanced_instead(task: dict[str, object], check_item_id: int) -> bool:
    """Whether the tick advanced a recurring Task instead of closing it.

    Read as an observation of the response this command provoked, not of how
    the API produced it: the request said `done: true`, and a recurring Task
    that is still open with that same line reading `done: false` can only
    have had its checklist reset underneath the tick. A plain tick leaves the
    line done. One response, no second read."""
    if task.get("recurrence") is None or task.get("completed"):
        return False
    items = task.get("check_items")
    if not isinstance(items, list):
        return False
    for item in items:
        if isinstance(item, dict) and item.get("id") == check_item_id:
            return not item.get("done")
    return False


def cmd_check_tick(
    client: Client, task_id: int, check_item_id: int, ticking: bool, as_json: bool
) -> int:
    cookie = require_session()
    if cookie is None:
        return 1
    # Resolved before the request: ticking the last open line of a recurring
    # Task advances it, and the occurrence it moved to is rendered in this
    # zone — so a bad TUK_TIMEZONE must fail rather than print a wrong hour.
    resolved = require_today()
    if resolved is None:
        return 1
    _, zone, zone_key = resolved
    try:
        task, refreshed = client.patch_check_item(task_id, check_item_id, cookie, ticking)
    except ClientError as exc:
        # A line belonging to another Task answers the same 404 as an unknown
        # Task — both are "no such line on this Task", reported with both ids.
        if exc.code == "not_found":
            print(
                f"Check item {check_item_id} on task {task_id} not found.",
                file=sys.stderr,
            )
        else:
            action = "Could not tick check item" if ticking else "Could not untick check item"
            report_client_error(exc, action)
        return 1
    if as_json:
        print_raw(task)
    else:
        print(_check_tick_line(task_id, check_item_id, task, ticking, zone, zone_key))
        print(format_check_items(task))
    if refreshed:
        write_session_cookie(refreshed)
    return 0
