"""`tuk` entrypoint. Errors to stderr, non-zero exit; success exits zero."""

import argparse
import getpass
import json
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from tuk.client import Client, ClientError
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


def main(argv: list[str] | None = None, transport: httpx.BaseTransport | None = None) -> int:
    args = build_parser().parse_args(argv)
    resolved = resolve_base_url(args.base_url)
    client = Client(resolved, transport=transport)
    try:
        if args.command == "login":
            return cmd_login(client, resolved)
        if args.command == "show":
            return cmd_show(client, args.task_id, args.as_json)
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
