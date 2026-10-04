"""`tuk` entrypoint. Errors to stderr, non-zero exit; success exits zero."""

import argparse
import getpass
import json
import sys

import httpx

from tuk.client import Client, ClientError
from tuk.store import read_session_cookie, resolve_base_url, write_config, write_session_cookie

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
        return cmd_show(client, args.task_id, args.as_json)
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
