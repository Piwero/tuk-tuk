"""`tuk` entrypoint. Errors to stderr, non-zero exit; success exits zero."""

import argparse
import concurrent.futures
import getpass
import json
import sys
from collections.abc import Sequence
from datetime import date, datetime
from zoneinfo import ZoneInfo

import httpx

from tuk.client import Client, ClientError
from tuk.dates import BadDateError, parse_date
from tuk.names import UnknownNameError, resolve_name
from tuk.store import read_session_cookie, resolve_base_url, write_config, write_session_cookie
from tuk.tz import TzError, local_today

SETUP_MESSAGE = "No password set yet — finish first-run setup in the web app."

# "Setup has not been completed" reaches a client under two codes. Every gated
# route answers `setup_required` from the middleware; the login endpoint is a
# public path, so it never reaches that middleware and answers `not_found` for
# itself. Both mean the same thing to the owner — go and set a password in the
# web app, which is the one thing a client deliberately cannot do — so both are
# accepted here. Keyed off the envelope code, never the bare status: on the
# login path 404 and 401 both occur, and 401 is also a wrong password.
#
# Scoped to the login path deliberately. On a gated read `not_found` means
# "no such Task" and must keep saying so — see cmd_show.
LOGIN_SETUP_CODES = frozenset({"setup_required", "not_found"})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tuk")
    sub = parser.add_subparsers(dest="command", required=True)
    login = sub.add_parser("login")
    login.add_argument("--base-url", default=None)
    show = sub.add_parser("show")
    show.add_argument("--base-url", default=None)
    show.add_argument("task_id", type=int)
    show.add_argument("--json", dest="as_json", action="store_true")
    done = sub.add_parser("done")
    done.add_argument("--base-url", default=None)
    done.add_argument("task_id", type=int)
    done.add_argument("--json", dest="as_json", action="store_true")
    rm = sub.add_parser("rm")
    rm.add_argument("--base-url", default=None)
    rm.add_argument("task_id", type=int)
    rm.add_argument("--yes", action="store_true", help="Delete without asking")
    reopen = sub.add_parser("reopen")
    reopen.add_argument("--base-url", default=None)
    reopen.add_argument("task_id", type=int)
    reopen.add_argument("--json", dest="as_json", action="store_true")
    ls = sub.add_parser("ls")
    ls.add_argument("--base-url", default=None)
    ls.add_argument("--json", dest="as_json", action="store_true")
    span = ls.add_mutually_exclusive_group()
    span.add_argument("--week", action="store_true", help="Next seven days instead of today")
    span.add_argument("--all", action="store_true", help="Every open task instead of today")
    ls.add_argument("--list", dest="list_name", default=None, help="Only tasks on this List")
    ls.add_argument("--tag", dest="tag_name", default=None, help="Only tasks with this Tag")
    ls.add_argument("--priority", default=None, help="Only tasks with this priority")
    ls.add_argument("--completed", action="store_true", help="Completed tasks, newest first")
    ls.add_argument("--unscheduled", action="store_true", help="Only tasks with no date")
    ls.add_argument("--search", default=None, help="Match titles, descriptions and Check Items")
    ls.add_argument("--limit", type=int, default=50)
    ls.add_argument("--offset", type=int, default=0)
    add = sub.add_parser("add")
    add.add_argument("--base-url", default=None)
    add.add_argument("--json", dest="as_json", action="store_true")
    add.add_argument("title")
    add.add_argument("--list", dest="list_name", default=None)
    add.add_argument("--tag", dest="tags", action="append", default=[])
    add.add_argument("--priority", default=None)
    add.add_argument("--description", default=None)
    add.add_argument("--due", default=None)
    add.add_argument("--start", default=None)
    add.add_argument("--all-day", dest="all_day", action="store_true")
    add.add_argument("--recurrence", default=None)
    add.add_argument("--reminder", dest="reminders", action="append", default=[])
    edit = sub.add_parser("edit")
    edit.add_argument("--base-url", default=None)
    edit.add_argument("task_id", type=int)
    edit.add_argument("--json", dest="as_json", action="store_true")
    edit.add_argument("--title", default=None)
    edit.add_argument("--description", default=None)
    edit.add_argument("--priority", default=None)
    edit.add_argument("--list", dest="list_name", default=None)
    edit.add_argument(
        "--tag",
        dest="tags",
        action="append",
        default=[],
        help="Replace the task's tags wholesale with these names",
    )
    edit.add_argument("--due", default=None)
    edit.add_argument("--start", default=None)
    edit.add_argument(
        "--clear-date",
        dest="clear_date",
        action="store_true",
        help="Clear the schedule (also removes reminders and recurrence)",
    )
    day = edit.add_mutually_exclusive_group()
    day.add_argument("--all-day", dest="all_day", action="store_true", default=None)
    day.add_argument("--no-all-day", dest="all_day", action="store_false", default=None)
    agenda = sub.add_parser("agenda")
    agenda.add_argument("--base-url", default=None)
    agenda.add_argument("--json", dest="as_json", action="store_true")
    habits = sub.add_parser("habits")
    habits.add_argument("--base-url", default=None)
    habits.add_argument("--json", dest="as_json", action="store_true")
    habits_sub = habits.add_subparsers(dest="habits_command")
    check = habits_sub.add_parser("check")
    check.add_argument("habit_id", type=int)
    check.add_argument("--day", default=None)
    check.add_argument("--value", type=float, default=1.0)
    undo = habits_sub.add_parser("undo")
    undo.add_argument("habit_id", type=int)
    undo.add_argument("--day", default=None)
    return parser


def cmd_login(client: Client, resolved_base_url: str) -> int:
    password = getpass.getpass("Password: ")
    try:
        cookie = client.login(password)
    except ClientError as exc:
        if exc.code in LOGIN_SETUP_CODES:
            print(SETUP_MESSAGE, file=sys.stderr)
        else:
            print(f"Login failed: {exc.message}", file=sys.stderr)
        return 1
    write_config(resolved_base_url)
    write_session_cookie(cookie)
    print("Logged in.")
    return 0


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


def ls_conflict(args: argparse.Namespace) -> tuple[str, str] | None:
    """The first pair of mutually exclusive listing flags, or None. The API
    refuses these combinations with 422, so the client names the two flags
    rather than forwarding a request it already knows will be refused."""
    # Only pairs the API refuses with 422. View additionally overrides a
    # completed filter server-side, so an explicit view with --completed is
    # forwarded, not rejected — the API's override semantics are inherited.
    view_flag = "--week" if args.week else "--all" if args.all else None
    if view_flag is not None:
        if args.unscheduled:
            return (view_flag, "--unscheduled")
        if args.search is not None:
            return (view_flag, "--search")
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
    conflict = ls_conflict(args)
    if conflict is not None:
        first, second = conflict
        print(f"Cannot combine {first} with {second}.", file=sys.stderr)
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
            lists, refreshed = client.read_lists(current)
            if refreshed:
                current = refreshed
                write_session_cookie(current)
            try:
                list_id = resolve_name(args.list_name, lists, "list")
            except UnknownNameError as exc:
                print(str(exc), file=sys.stderr)
                return 1
        if args.tag_name is not None:
            tags, refreshed = client.read_tags(current)
            if refreshed:
                current = refreshed
                write_session_cookie(current)
            try:
                tag_id = resolve_name(args.tag_name, tags, "tag")
            except UnknownNameError as exc:
                print(str(exc), file=sys.stderr)
                return 1
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
        print(json.dumps(page))
    else:
        rows = page_items(page)
        print(format_ls(rows, zone, zone_key, more=remaining_count(page, len(rows))))
    if refreshed:
        write_session_cookie(refreshed)
    return 0


def report_client_error(exc: ClientError, action: str) -> None:
    """Any API failure in plain language — session, setup, validation alike.
    The message is always the API's own; never a raw HTTP dump."""
    if exc.code == "unauthorized":
        print("Session expired — run `tuk login` again.", file=sys.stderr)
    elif exc.code == "setup_required":
        print(SETUP_MESSAGE, file=sys.stderr)
    else:
        print(f"{action}: {exc.message}", file=sys.stderr)


def cmd_add(client: Client, args: argparse.Namespace) -> int:
    cookie = read_session_cookie()
    if cookie is None:
        print("Not logged in — run `tuk login` first.", file=sys.stderr)
        return 1
    dated = args.due is not None or args.start is not None
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
    zone_key = ""
    if dated:
        # Parsing a date word needs the caller's day and zone; the zone
        # travels with the task so the API judges the right local day.
        try:
            today, zone, zone_key = local_today()
        except TzError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        try:
            if args.due is not None:
                body["due_date"] = parse_date(args.due, today, zone).isoformat()
            if args.start is not None:
                body["start_date"] = parse_date(args.start, today, zone).isoformat()
        except BadDateError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        body["time_zone"] = zone_key
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
        print(json.dumps(created))
    else:
        print(f"Added task #{created.get('id')}.")
    if refreshed:
        write_session_cookie(refreshed)
    return 0


def resolve_ids(
    client: Client, cookie: str, args: argparse.Namespace, body: dict[str, object]
) -> str | None:
    """Fill body with the resolved list_id / tag_ids. Returns the current
    cookie, or None when a name missed (already reported) — nothing created."""
    if args.list_name is None and not args.tags:
        return cookie
    current = cookie
    if args.list_name is not None:
        lists, refreshed = client.read_lists(current)
        if refreshed:
            current = refreshed
            write_session_cookie(current)
        try:
            body["list_id"] = resolve_name(args.list_name, lists, "list")
        except UnknownNameError as exc:
            print(str(exc), file=sys.stderr)
            return None
    if args.tags:
        tags, refreshed = client.read_tags(current)
        if refreshed:
            current = refreshed
            write_session_cookie(current)
        ids = []
        for name in args.tags:
            try:
                ids.append(resolve_name(name, tags, "tag"))
            except UnknownNameError as exc:
                print(str(exc), file=sys.stderr)
                return None
        body["tag_ids"] = ids
    return current


def edit_conflict(args: argparse.Namespace) -> tuple[str, str] | None:
    """A --clear-date combined with a date it would clear. The request would
    contradict itself, so the client names the two flags rather than
    forwarding something it already knows is incoherent."""
    if args.clear_date:
        if args.due is not None:
            return ("--clear-date", "--due")
        if args.start is not None:
            return ("--clear-date", "--start")
        if args.all_day:
            return ("--clear-date", "--all-day")
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
    conflict = edit_conflict(args)
    if conflict is not None:
        first, second = conflict
        print(f"Cannot combine {first} with {second}.", file=sys.stderr)
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
    elif args.due is not None or args.start is not None:
        # Parsing a date word needs the caller's day and zone; the zone
        # travels with the task so the API judges the right local day.
        try:
            today, zone, zone_key = local_today()
        except TzError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        try:
            if args.due is not None:
                body["due_date"] = parse_date(args.due, today, zone).isoformat()
            if args.start is not None:
                body["start_date"] = parse_date(args.start, today, zone).isoformat()
        except BadDateError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        body["time_zone"] = zone_key
    if args.all_day is not None and not args.clear_date:
        body["is_all_day"] = args.all_day
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
            if exc.code == "not_found":
                print(f"Task {args.task_id} not found.", file=sys.stderr)
            else:
                report_client_error(exc, "Could not update task")
            return 1
    try:
        updated, refreshed = client.patch_task(args.task_id, current, body)
    except ClientError as exc:
        if exc.code == "not_found":
            print(f"Task {args.task_id} not found.", file=sys.stderr)
        else:
            report_client_error(exc, "Could not update task")
        return 1
    if args.as_json:
        print(json.dumps(updated))
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


def require_session() -> str | None:
    """The cached session cookie, or None after reporting the login
    instruction — the one guard every authenticated command repeats."""
    cookie = read_session_cookie()
    if cookie is None:
        print("Not logged in — run `tuk login` first.", file=sys.stderr)
    return cookie


def require_today() -> tuple[date, ZoneInfo, str] | None:
    """The caller's local day and zone, or None after reporting a bad
    TUK_TIMEZONE — the one guard every day-aware command repeats."""
    try:
        return local_today()
    except TzError as exc:
        print(str(exc), file=sys.stderr)
        return None


def format_habits(habits: list[dict[str, object]], more: int = 0) -> str:
    rows = [(str(habit.get("id")), str(habit.get("name"))) for habit in habits]
    lines = aligned_table(("ID", "HABIT"), rows)
    return "\n".join(lines + more_line(more))


def cmd_habits_list(client: Client, as_json: bool) -> int:
    cookie = require_session()
    if cookie is None:
        return 1
    resolved = require_today()
    if resolved is None:
        return 1
    today, _, zone_key = resolved
    try:
        page, refreshed = client.list_habits(cookie, today.isoformat())
    except ClientError as exc:
        report_client_error(exc, "Could not list habits")
        return 1
    if as_json:
        print(json.dumps(page))
    else:
        rows = page_items(page)
        print(format_habits(rows, more=remaining_count(page, len(rows))))
        print(f"Habits due. Dates in {zone_key}.")
    if refreshed:
        write_session_cookie(refreshed)
    return 0


def _check_in_day(raw: str | None, today: date) -> date | None:
    if raw is None:
        return today
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _report_bad_day(raw_day: str) -> None:
    print(
        f"Could not understand day {raw_day!r} — use an ISO date (YYYY-MM-DD).",
        file=sys.stderr,
    )


def cmd_habits_check(client: Client, habit_id: int, raw_day: str | None, value: float) -> int:
    cookie = require_session()
    if cookie is None:
        return 1
    resolved = require_today()
    if resolved is None:
        return 1
    today, _, _ = resolved
    day = _check_in_day(raw_day, today)
    if day is None:
        assert raw_day is not None  # None only when _check_in_day defaults to today
        _report_bad_day(raw_day)
        return 1
    try:
        _, refreshed = client.put_check_in(cookie, habit_id, day.isoformat(), value)
    except ClientError as exc:
        report_client_error(exc, "Could not record check-in")
        return 1
    print(f"Checked in habit #{habit_id} for {day.isoformat()}.")
    if refreshed:
        write_session_cookie(refreshed)
    return 0


def cmd_habits_undo(client: Client, habit_id: int, raw_day: str | None) -> int:
    cookie = require_session()
    if cookie is None:
        return 1
    resolved = require_today()
    if resolved is None:
        return 1
    today, _, _ = resolved
    day = _check_in_day(raw_day, today)
    if day is None:
        assert raw_day is not None  # None only when _check_in_day defaults to today
        _report_bad_day(raw_day)
        return 1
    try:
        refreshed = client.delete_check_in(cookie, habit_id, day.isoformat())
    except ClientError as exc:
        report_client_error(exc, "Could not undo check-in")
        return 1
    print(f"Undid check-in for habit #{habit_id} on {day.isoformat()}.")
    if refreshed:
        write_session_cookie(refreshed)
    return 0


def _read_events_isolated(
    client: Client, cookie: str, day: str
) -> tuple[list[dict[str, object]], str | None]:
    """The day's events, or nothing: calendar trouble never fails the view.
    Catches broadly on purpose — an unconfigured integration, a revoked grant
    and a network failure must all contribute nothing (ADR 0006, ADR 0007),
    and the Agenda must not become collateral damage of a Google problem."""
    try:
        return client.read_events(cookie, day)
    except Exception:  # noqa: BLE001 - calendar failure isolation per ADR 0007
        return [], None


def cmd_agenda(client: Client, as_json: bool) -> int:
    cookie = require_session()
    if cookie is None:
        return 1
    resolved = require_today()
    if resolved is None:
        return 1
    today, zone, zone_key = resolved
    day = today.isoformat()
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            tasks_future = pool.submit(client.list_tasks, cookie, "today", day, 50, 0)
            habits_future = pool.submit(client.list_habits, cookie, day)
            events_future = pool.submit(_read_events_isolated, client, cookie, day)
            page, task_cookie = tasks_future.result()
            habits_page, habit_cookie = habits_future.result()
            events, event_cookie = events_future.result()
    except ClientError as exc:
        report_client_error(exc, "Could not build agenda")
        return 1
    # All three reads present the same cookie, so the middleware either
    # reissues for all of them or none, and each reissued value is
    # independently signed and equally valid. Any one of them keeps the
    # session alive for the command the owner runs most; which is taken is
    # arbitrary, so the first one present wins.
    refreshed = event_cookie or habit_cookie or task_cookie
    tasks = page_items(page)
    habits = page_items(habits_page)
    if as_json:
        print(
            json.dumps(
                {
                    "date": day,
                    "time_zone": zone_key,
                    "tasks": tasks,
                    "habits": habits,
                    "events": events,
                }
            )
        )
    else:
        print("Tasks")
        print(format_ls(tasks, zone, zone_key, more=remaining_count(page, len(tasks))))
        print("")
        print("Habits due")
        print(format_habits(habits, more=remaining_count(habits_page, len(habits))))
        if events:
            print("")
            print("Events")
            for event in events:
                print(f"- {event.get('title')}")
        print(f"Agenda for {day}. Dates in {zone_key}.")
    if refreshed:
        write_session_cookie(refreshed)
    return 0


def cmd_show(client: Client, task_id: int, as_json: bool) -> int:
    cookie = read_session_cookie()
    if cookie is None:
        print("Not logged in — run `tuk login` first.", file=sys.stderr)
        return 1
    try:
        task, refreshed = client.show_task(task_id, cookie)
    except ClientError as exc:
        if exc.code == "unauthorized":
            print("Session expired — run `tuk login` again.", file=sys.stderr)
        elif exc.code == "setup_required":
            print(SETUP_MESSAGE, file=sys.stderr)
        elif exc.code == "not_found":
            print(f"Task {task_id} not found.", file=sys.stderr)
        else:
            print(f"Could not fetch task: {exc.message}", file=sys.stderr)
        return 1
    if as_json:
        print(json.dumps(task))
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
        if exc.code == "not_found":
            print(f"Task {task_id} not found.", file=sys.stderr)
        else:
            report_client_error(exc, "Could not delete task")
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
        if exc.code == "not_found":
            print(f"Task {task_id} not found.", file=sys.stderr)
        else:
            report_client_error(exc, "Could not delete task")
        return 1
    print(f"Deleted task #{task_id} {title!r}.")
    if refreshed:
        write_session_cookie(refreshed)
    elif current != cookie:
        write_session_cookie(current)
    return 0


def _completion_line(task_id: int, task: dict[str, object], complete: bool) -> str:
    # A recurring Task that advanced came back still open with new dates
    # (ADR 0003) — name it, or the owner reasonably concludes `done` broke.
    # Keyed on intent first: a reopened Task is open by definition, so only
    # `done` can advance one.
    if complete and not task.get("completed"):
        due = task.get("due_date")
        suffix = f", next occurrence {due}" if isinstance(due, str) else ""
        return f"Task #{task_id} advanced to its next occurrence{suffix}."
    if complete:
        return f"Task #{task_id} completed."
    return f"Task #{task_id} reopened."


def cmd_complete(client: Client, task_id: int, complete: bool, as_json: bool) -> int:
    cookie = require_session()
    if cookie is None:
        return 1
    action = "Could not complete task" if complete else "Could not reopen task"
    try:
        task, refreshed = client.patch_task(task_id, cookie, {"completed": complete})
    except ClientError as exc:
        if exc.code == "not_found":
            print(f"Task {task_id} not found.", file=sys.stderr)
        else:
            report_client_error(exc, action)
        return 1
    if as_json:
        print(json.dumps(task))
    else:
        print(_completion_line(task_id, task, complete))
    if refreshed:
        write_session_cookie(refreshed)
    return 0


def glue_reminder_dash_arg(argv: list[str]) -> list[str]:
    """Glue `--reminder -PT30M` into `--reminder=-PT30M`: durations start with
    a dash, which argparse otherwise reads as another flag. The `=` form is
    argparse-native; this just lets humans use the space form too."""
    glued = []
    index = 0
    while index < len(argv):
        if (
            argv[index] == "--reminder"
            and index + 1 < len(argv)
            and argv[index + 1].startswith("-")
        ):
            glued.append(f"--reminder={argv[index + 1]}")
            index += 2
        else:
            glued.append(argv[index])
            index += 1
    return glued


def main(argv: list[str] | None = None, transport: httpx.BaseTransport | None = None) -> int:
    args = build_parser().parse_args(argv if argv is None else glue_reminder_dash_arg(argv))
    resolved = resolve_base_url(args.base_url)
    client = Client(resolved, transport=transport)
    try:
        if args.command == "login":
            return cmd_login(client, resolved)
        if args.command == "show":
            return cmd_show(client, args.task_id, args.as_json)
        if args.command == "done":
            return cmd_complete(client, args.task_id, True, args.as_json)
        if args.command == "reopen":
            return cmd_complete(client, args.task_id, False, args.as_json)
        if args.command == "rm":
            return cmd_rm(client, args.task_id, args.yes)
        if args.command == "add":
            return cmd_add(client, args)
        if args.command == "edit":
            return cmd_edit(client, args)
        if args.command == "agenda":
            return cmd_agenda(client, args.as_json)
        if args.command == "habits":
            if args.habits_command == "check":
                return cmd_habits_check(client, args.habit_id, args.day, args.value)
            if args.habits_command == "undo":
                return cmd_habits_undo(client, args.habit_id, args.day)
            return cmd_habits_list(client, args.as_json)
        return cmd_ls(client, args)
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
