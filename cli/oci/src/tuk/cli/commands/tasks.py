"""Task commands: ls, add, edit, show, rm, done/reopen."""

import argparse
import sys
from zoneinfo import ZoneInfo

from tuk.client import Client, ClientError
from tuk.store import write_session_cookie

from ..errors import report_client_error, report_conflict, report_task_error
from ..rendering import (
    format_ls,
    format_task,
    occurrence_suffix,
    page_items,
    print_raw,
    remaining_count,
)
from ..resolving import apply_dates, resolve_ids, resolve_named
from ..session import require_session, require_today


def ls_conflict(args: argparse.Namespace) -> tuple[str, str] | None:
    """The first pair of mutually exclusive listing flags, or None.

    Two kinds of conflict, both caught here. Most of these the API refuses
    with 422, so naming the two flags locally saves a round trip whose answer
    is already known. A view with `--completed` is the other kind: the API
    accepts it and silently overrides the completion filter
    (`if view is not None: completed = False`), so forwarding it would answer
    with open tasks under a flag that asked for completed ones. That is worse
    than a refusal — it looks like an answer — so it is refused too.
    """
    view_flag = "--week" if args.week else "--all" if args.all else None
    if view_flag is not None:
        if args.unscheduled:
            return (view_flag, "--unscheduled")
        if args.search is not None:
            return (view_flag, "--search")
        if args.completed:
            return (view_flag, "--completed")
    if args.unscheduled and args.search is not None:
        return ("--unscheduled", "--search")
    return None


def cmd_ls(client: Client, args: argparse.Namespace) -> int:
    cookie = require_session()
    if cookie is None:
        return 1
    # Resolved for every view and every output format, not only the ones that
    # consume it: a misconfigured TUK_TIMEZONE must be visible rather than
    # silently shifting the day boundary, and a combination that skipped
    # resolution would be the one place it passed unnoticed.
    resolved = require_today()
    if resolved is None:
        return 1
    today, zone, zone_key = resolved
    if report_conflict(ls_conflict(args)):
        return 1
    # An explicit view (--week/--all) is judged against the local day; the
    # bare default is the Today view unless a computed listing (--completed,
    # --unscheduled, --search) replaces it — those are exclusive with views.
    view: str | None = "today"
    if args.week:
        view = "next7"
    elif args.all:
        view = "all"
    elif args.completed or args.unscheduled or args.search is not None:
        view = None
    # Only the day-bounded views are judged against a local day; `all` is
    # every open task regardless of date, so it sends no `today`.
    today_param = today.isoformat() if view in ("today", "next7") else None
    try:
        current = cookie
        list_id: int | None = None
        tag_id: int | None = None
        if args.list_name is not None:
            found = resolve_named(client, current, args.list_name, kind="list")
            if found is None:
                return 1
            list_id, current = found.only, found.cookie
        if args.tag_name is not None:
            found = resolve_named(client, current, args.tag_name, kind="tag")
            if found is None:
                return 1
            tag_id, current = found.only, found.cookie
        page, refreshed = client.list_tasks(
            current,
            view,
            today_param,
            args.limit,
            args.offset,
            list_id=list_id,
            tag_id=tag_id,
            # Forwarded untouched: unknown values are the API's 422 to report.
            priority=args.priority,
            completed=True if args.completed else None,
            scheduled=False if args.unscheduled else None,
            # An empty query matches nothing — the API's behaviour, forwarded
            # as-is and never worked around.
            search=args.search,
        )
    except ClientError as exc:
        report_client_error(exc, "Could not list tasks")
        return 1
    if args.as_json:
        print_raw(page)
    else:
        rows = page_items(page)
        print(format_ls(rows, zone, zone_key, more=remaining_count(page, len(rows))))
    if refreshed:
        write_session_cookie(refreshed)
    return 0


def cmd_add(client: Client, args: argparse.Namespace) -> int:
    cookie = require_session()
    if cookie is None:
        return 1
    body: dict[str, object] = {"title": args.title}
    if args.priority is not None:
        # Forwarded untouched: unknown values are the API's 422 to report.
        body["priority"] = args.priority
    if args.description is not None:
        body["description"] = args.description
    if args.recurrence is not None:
        body["recurrence"] = args.recurrence
    if args.reminders:
        body["reminders"] = list(args.reminders)
    if not apply_dates(args, body):
        return 1
    if args.all_day:
        body["is_all_day"] = True
    try:
        resolved = resolve_ids(client, cookie, args, body)
        if resolved is None:
            return 1
        created, refreshed = client.create_task(resolved, body)
    except ClientError as exc:
        # Scheduling, recurrence, reminder and priority rules are the API's —
        # forward its message in plain language, never a raw HTTP dump.
        report_client_error(exc, "Could not add task")
        return 1
    if args.as_json:
        print_raw(created)
    else:
        print(f"Added task #{created.get('id')}.")
    if refreshed:
        write_session_cookie(refreshed)
    return 0


def edit_conflict(args: argparse.Namespace) -> tuple[str, str] | None:
    """A clear flag combined with a value it would clear. The request would
    contradict itself, so the client names the two flags rather than
    forwarding something it already knows is incoherent.

    Not an argparse mutually-exclusive group, because `--due` and `--start`
    must still combine with each other — only their pairing with
    `--clear-date` is incoherent.
    """
    if args.clear_date:
        if args.due is not None:
            return ("--clear-date", "--due")
        if args.start is not None:
            return ("--clear-date", "--start")
        if args.all_day:
            return ("--clear-date", "--all-day")
    if args.clear_tags and args.tags:
        return ("--clear-tags", "--tag")
    return None


def edit_sweep_note(before: dict[str, object], updated: dict[str, object]) -> str | None:
    """What clearing the date swept with it, read off the before/after bodies
    rather than restated from the API's rules — no dateless reminders, no
    dateless repeats. None when nothing was swept."""
    swept: list[str] = []
    before_reminders = before.get("reminders")
    if isinstance(before_reminders, list) and before_reminders and updated.get("reminders") == []:
        count = len(before_reminders)
        swept.append(f"{count} reminder{'s' if count != 1 else ''}")
    if before.get("recurrence") is not None and updated.get("recurrence") is None:
        swept.append("the recurrence")
    if not swept:
        return None
    return f"Cleared the date — also removed {' and '.join(swept)}."


def edit_section_note(
    before: dict[str, object], updated: dict[str, object], moved: bool
) -> str | None:
    """Whether moving Lists dropped the Task's Section, read off the
    before/after bodies — a Section belongs to one List, so a move without a
    same-request reassignment leaves none behind."""
    if moved and before.get("section_id") is not None and updated.get("section_id") is None:
        return "Moved lists — dropped its Section (a Section belongs to one List)."
    return None


def cmd_edit(client: Client, args: argparse.Namespace) -> int:
    cookie = require_session()
    if cookie is None:
        return 1
    if report_conflict(edit_conflict(args)):
        return 1
    body: dict[str, object] = {}
    if args.title is not None:
        body["title"] = args.title
    if args.description is not None:
        body["description"] = args.description
    if args.priority is not None:
        # Forwarded untouched: unknown values are the API's 422 to report.
        body["priority"] = args.priority
    if args.clear_date:
        # The whole schedule, not just the due: a start without a due is the
        # API's 422, an all-day task requires a due, and the zone belongs to
        # a date it no longer has — so all four go together.
        body["due_date"] = None
        body["start_date"] = None
        body["is_all_day"] = False
        body["time_zone"] = None
    elif not apply_dates(args, body):
        return 1
    if args.all_day is not None and not args.clear_date:
        body["is_all_day"] = args.all_day
    if args.clear_tags:
        # The patch endpoint treats the Tag set as a whole-set replacement,
        # and replacing with nothing is a replacement — unreachable through
        # `--tag`, which appends.
        body["tag_ids"] = []
    try:
        current = resolve_ids(client, cookie, args, body)
        if current is None:
            return 1
    except ClientError as exc:
        # Scheduling, recurrence, reminder and priority rules are the API's —
        # forward its message in plain language, never a raw HTTP dump.
        report_client_error(exc, "Could not update task")
        return 1
    if not body:
        print("Nothing to change — pass a field to update.", file=sys.stderr)
        return 1
    # The before-state is only read when a note depends on it: a List move
    # may drop the Section, a date clear may sweep reminders and recurrence.
    # Plain field edits stay one round trip, not two.
    before: dict[str, object] | None = None
    if args.list_name is not None or args.clear_date:
        try:
            before, refreshed = client.show_task(args.task_id, current)
            if refreshed:
                current = refreshed
                write_session_cookie(current)
        except ClientError as exc:
            report_task_error(exc, args.task_id, "Could not update task")
            return 1
    try:
        updated, refreshed = client.patch_task(args.task_id, current, body)
    except ClientError as exc:
        report_task_error(exc, args.task_id, "Could not update task")
        return 1
    if args.as_json:
        print_raw(updated)
    else:
        print(f"Updated task #{args.task_id}.")
        if before is not None:
            sweep = edit_sweep_note(before, updated) if args.clear_date else None
            if sweep is not None:
                print(sweep)
            section = (
                edit_section_note(before, updated, "list_id" in body)
                if args.list_name is not None
                else None
            )
            if section is not None:
                print(section)
    if refreshed:
        write_session_cookie(refreshed)
    return 0


def cmd_show(client: Client, task_id: int, as_json: bool) -> int:
    cookie = require_session()
    if cookie is None:
        return 1
    try:
        task, refreshed = client.show_task(task_id, cookie)
    except ClientError as exc:
        report_task_error(exc, task_id, "Could not fetch task")
        return 1
    if as_json:
        print_raw(task)
    else:
        print(format_task(task))
    if refreshed:
        write_session_cookie(refreshed)
    return 0


def cmd_rm(client: Client, task_id: int, skip_confirm: bool) -> int:
    """Delete a Task behind a confirmation prompt naming its title. A declined
    prompt deletes nothing. `--yes` skips the prompt for scripts; without it a
    non-terminal stdin fails rather than hanging on a prompt nobody can see."""
    cookie = require_session()
    if cookie is None:
        return 1
    if not skip_confirm and not sys.stdin.isatty():
        print("Not a terminal — pass --yes to delete without prompting.", file=sys.stderr)
        return 1
    try:
        task, refreshed = client.show_task(task_id, cookie)
        current = refreshed or cookie
    except ClientError as exc:
        report_task_error(exc, task_id, "Could not delete task")
        return 1
    title = str(task.get("title", ""))
    if not skip_confirm:
        try:
            answer = input(f"Delete task #{task_id} {title!r}? [y/N] ").strip().lower()
        except EOFError:
            print("Delete cancelled.", file=sys.stderr)
            return 1
        if answer not in ("y", "yes"):
            print("Delete cancelled.", file=sys.stderr)
            return 1
    try:
        refreshed = client.delete_task(task_id, current)
    except ClientError as exc:
        report_task_error(exc, task_id, "Could not delete task")
        return 1
    print(f"Deleted task #{task_id} {title!r}.")
    if refreshed:
        write_session_cookie(refreshed)
    elif current != cookie:
        write_session_cookie(current)
    return 0


def _completion_line(
    task_id: int, task: dict[str, object], complete: bool, zone: ZoneInfo, zone_key: str
) -> str:
    # A recurring Task that advanced came back still open with new dates
    # (ADR 0003) — name it, or the owner reasonably concludes `done` broke.
    # Keyed on intent first: a reopened Task is open by definition, so only
    # `done` can advance one; and only a recurring Task can advance at all,
    # so a response that came back open for any other reason is not one.
    if complete and not task.get("completed") and task.get("recurrence") is not None:
        return f"Task #{task_id} advanced{occurrence_suffix(task, zone, zone_key)}."
    if complete:
        return f"Task #{task_id} completed."
    return f"Task #{task_id} reopened."


def cmd_complete(client: Client, task_id: int, complete: bool, as_json: bool) -> int:
    cookie = require_session()
    if cookie is None:
        return 1
    # Resolved before the request, because the occurrence a recurring Task
    # advances to is rendered in it — and a bad TUK_TIMEZONE must fail rather
    # than print an hour the owner is not keeping.
    resolved = require_today()
    if resolved is None:
        return 1
    _, zone, zone_key = resolved
    action = "Could not complete task" if complete else "Could not reopen task"
    try:
        task, refreshed = client.patch_task(task_id, cookie, {"completed": complete})
    except ClientError as exc:
        report_task_error(exc, task_id, action)
        return 1
    if as_json:
        print_raw(task)
    else:
        print(_completion_line(task_id, task, complete, zone, zone_key))
    if refreshed:
        write_session_cookie(refreshed)
    return 0
