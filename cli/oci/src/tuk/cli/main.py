"""`tuk` entrypoint. Errors to stderr, non-zero exit; success exits zero."""

import httpx

from tuk.client import Client
from tuk.store import resolve_base_url

from .commands.agenda import cmd_agenda
from .commands.checks import cmd_check_add, cmd_check_tick
from .commands.habits import cmd_habits_check, cmd_habits_list, cmd_habits_undo
from .commands.login import cmd_login
from .commands.tasks import cmd_add, cmd_complete, cmd_edit, cmd_ls, cmd_rm, cmd_show
from .parser import build_parser, glue_reminder_dash_arg


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
        if args.command == "check":
            if args.check_command == "add":
                return cmd_check_add(client, args.task_id, args.title, args.as_json)
            if args.check_command == "tick":
                return cmd_check_tick(client, args.task_id, args.check_item_id, True, args.as_json)
            return cmd_check_tick(client, args.task_id, args.check_item_id, False, args.as_json)
        return cmd_ls(client, args)
    finally:
        client.close()
