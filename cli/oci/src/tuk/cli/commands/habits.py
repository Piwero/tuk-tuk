"""Habit commands: list, check, undo."""

import sys
from datetime import date

from tuk.client import Client, ClientError
from tuk.store import write_session_cookie

from ..errors import report_client_error
from ..rendering import format_habits, page_items, print_raw, remaining_count
from ..session import require_session, require_today


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
        print_raw(page)
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
