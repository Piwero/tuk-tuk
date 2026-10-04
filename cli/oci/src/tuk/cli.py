"""`tuk` entrypoint. Errors to stderr, non-zero exit; success exits zero."""

import argparse
import concurrent.futures
import getpass
import json
import sys
from datetime import date, datetime
from zoneinfo import ZoneInfo

import httpx

from tuk.client import Client, ClientError
from tuk.dates import BadDateError, parse_date
from tuk.names import UnknownNameError, resolve_name
from tuk.store import read_session_cookie, resolve_base_url, write_config, write_session_cookie
from tuk.tz import TzError, local_today

SETUP_MESSAGE = "No password set yet — finish first-run setup in the web app."


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tuk")
    sub = parser.add_subparsers(dest="command", required=True)
    login = sub.add_parser("login")
    login.add_argument("--base-url", default=None)
    show = sub.add_parser("show")
    show.add_argument("--base-url", default=None)
    show.add_argument("task_id", type=int)
    show.add_argument("--json", dest="as_json", action="store_true")
    ls = sub.add_parser("ls")
    ls.add_argument("--base-url", default=None)
    ls.add_argument("--json", dest="as_json", action="store_true")
    span = ls.add_mutually_exclusive_group()
    span.add_argument("--week", action="store_true", help="Next seven days instead of today")
    span.add_argument("--all", action="store_true", help="Every open task instead of today")
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
        if exc.code == "not_found":
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
    widths = [len(cell) for cell in ("ID", "TITLE", "DUE", "PRIORITY")]
    for row in rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))

    def aligned(cells: tuple[str, str, str, str]) -> str:
        return "  ".join(cell.ljust(widths[index]) for index, cell in enumerate(cells)).rstrip()

    lines = [aligned(("ID", "TITLE", "DUE", "PRIORITY"))]
    lines += [aligned(row) for row in rows]
    lines.append(f"Dates in {zone_key}.")
    if more > 0:
        lines.append(f"… {more} more result{'s' if more != 1 else ''} not shown.")
    return "\n".join(lines)


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


def cmd_ls(client: Client, view: str, as_json: bool, limit: int, offset: int) -> int:
    cookie = read_session_cookie()
    if cookie is None:
        print("Not logged in — run `tuk login` first.", file=sys.stderr)
        return 1
    today_param: str | None = None
    zone: ZoneInfo | None = None
    zone_key = ""
    if view in ("today", "next7") or not as_json:
        # Plain rendering states the resolved zone, and today/next7 pass the
        # local day to the API — both need the caller's zone. A JSON all-open
        # dump needs neither, so it never touches timezone resolution.
        try:
            today, zone, zone_key = local_today()
        except TzError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        if view in ("today", "next7"):
            today_param = today.isoformat()
    try:
        page, refreshed = client.list_tasks(cookie, view, today_param, limit, offset)
    except ClientError as exc:
        if exc.code == "unauthorized":
            print("Session expired — run `tuk login` again.", file=sys.stderr)
        elif exc.code == "setup_required":
            print(SETUP_MESSAGE, file=sys.stderr)
        else:
            print(f"Could not list tasks: {exc.message}", file=sys.stderr)
        return 1
    if as_json:
        print(json.dumps(page))
    else:
        items = page.get("items")
        rows = list(items) if isinstance(items, list) else []
        assert zone is not None  # resolved above whenever plain output renders
        print(
            format_ls(
                [t for t in rows if isinstance(t, dict)],
                zone,
                zone_key,
                more=remaining_count(page, len(rows)),
            )
        )
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


def format_habits(habits: list[dict[str, object]]) -> str:
    rows = [(str(habit.get("id")), str(habit.get("name"))) for habit in habits]
    widths = [len(cell) for cell in ("ID", "HABIT")]
    for row in rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))

    def aligned(cells: tuple[str, str]) -> str:
        return "  ".join(cell.ljust(widths[index]) for index, cell in enumerate(cells)).rstrip()

    return "\n".join([aligned(("ID", "HABIT"))] + [aligned(row) for row in rows])


def cmd_habits_list(client: Client, as_json: bool) -> int:
    cookie = require_session()
    if cookie is None:
        return 1
    resolved = require_today()
    if resolved is None:
        return 1
    today, _, zone_key = resolved
    try:
        habits, refreshed = client.read_habits(cookie, today.isoformat())
    except ClientError as exc:
        report_client_error(exc, "Could not list habits")
        return 1
    if as_json:
        print(json.dumps({"items": habits, "total": len(habits), "limit": 200, "offset": 0}))
    else:
        print(format_habits(habits))
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


def _read_events_isolated(client: Client, cookie: str, day: str) -> list[dict[str, object]]:
    """The day's events, or nothing: calendar trouble never fails the view."""
    try:
        events, _ = client.read_events(cookie, day)
    except Exception:
        return []
    return events


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
            habits_future = pool.submit(client.read_habits, cookie, day)
            events_future = pool.submit(_read_events_isolated, client, cookie, day)
            page, _ = tasks_future.result()
            habits, _ = habits_future.result()
            events = events_future.result()
    except ClientError as exc:
        report_client_error(exc, "Could not build agenda")
        return 1
    items = page.get("items")
    tasks = [t for t in items if isinstance(t, dict)] if isinstance(items, list) else []
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
        print(format_ls(tasks, zone, zone_key))
        print("")
        print("Habits due")
        print(format_habits(habits))
        if events:
            print("")
            print("Events")
            for event in events:
                print(f"- {event.get('title')}")
        print(f"Agenda for {day}. Dates in {zone_key}.")
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
        if args.command == "add":
            return cmd_add(client, args)
        if args.command == "agenda":
            return cmd_agenda(client, args.as_json)
        if args.command == "habits":
            if args.habits_command == "check":
                return cmd_habits_check(client, args.habit_id, args.day, args.value)
            if args.habits_command == "undo":
                return cmd_habits_undo(client, args.habit_id, args.day)
            return cmd_habits_list(client, args.as_json)
        view = "today"
        if args.week:
            view = "next7"
        elif args.all:
            view = "all"
        return cmd_ls(client, view, args.as_json, args.limit, args.offset)
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
