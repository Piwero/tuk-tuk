"""Agenda command: tasks, habits and calendar events for today, merged."""

import concurrent.futures
import json

from tuk.client import Client, ClientError
from tuk.store import write_session_cookie

from ..errors import report_client_error
from ..rendering import format_habits, format_ls, page_items, remaining_count
from ..session import require_session, require_today


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
