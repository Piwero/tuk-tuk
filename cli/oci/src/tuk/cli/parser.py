"""Argument parser for the `tuk` CLI."""

import argparse


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
    edit.add_argument(
        "--clear-tags",
        dest="clear_tags",
        action="store_true",
        help="Replace the task's tags with none",
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
    # A habit Check-in, not a Check Item: two glossary concepts share the
    # word `check` on the command line, so they do not share an identifier.
    habit_check = habits_sub.add_parser("check")
    habit_check.add_argument("habit_id", type=int)
    habit_check.add_argument("--day", default=None)
    habit_check.add_argument("--value", type=float, default=1.0)
    undo = habits_sub.add_parser("undo")
    undo.add_argument("habit_id", type=int)
    undo.add_argument("--day", default=None)
    check_item = sub.add_parser("check")
    check_item.add_argument("--base-url", default=None)
    check_item.add_argument("--json", dest="as_json", action="store_true")
    check_sub = check_item.add_subparsers(dest="check_command", required=True)
    check_add = check_sub.add_parser("add")
    check_add.add_argument("task_id", type=int)
    check_add.add_argument("title")
    check_tick = check_sub.add_parser("tick")
    check_tick.add_argument("task_id", type=int)
    check_tick.add_argument("check_item_id", type=int)
    check_untick = check_sub.add_parser("untick")
    check_untick.add_argument("task_id", type=int)
    check_untick.add_argument("check_item_id", type=int)
    # A flag declared on a parent parser is only accepted *before* the
    # subcommand, so `check tick 7 1 --json` — where a reader naturally puts
    # it, and where the README shows it — would be rejected. Declaring it on
    # both makes either position parse; SUPPRESS is what stops the
    # subcommand's unset default from overwriting a value the parent took.
    for leaf in (check_add, check_tick, check_untick):
        leaf.add_argument(
            "--json",
            dest="as_json",
            action="store_true",
            default=argparse.SUPPRESS,
            help="Emit the API's response unmodified",
        )
    return parser


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
