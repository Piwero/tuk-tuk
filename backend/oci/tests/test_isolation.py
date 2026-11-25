"""The cross-user isolation proof (ADR 0018, issue #411): the spec's required
check.

Alice creates one of every resource type. Bea, signed in as herself, then
probes every route that names one of Alice's rows or reads a collection:

- `Reach`: Bea is told 404 on GET, PATCH and DELETE of each of Alice's rows,
  and when she names one of Alice's ids as a parent or link of her own.
- `Read`: Bea's lists, searches, Smart Lists, calendar, statistics,
  stand-up suggestions and Assistant snapshot carry none of Alice's rows.
- `OwnWrite`: writes that act on "whatever is mine" (focusing a Goal, a
  bulk delete, Google credentials, a Stand-up Entry keyed by date) succeed
  for Bea and stay inside her own rows.

Every probe is non-vacuous twice over: Alice's view of her own data
(every `Read` probe, as Alice) must be unchanged by Bea's request, and
Alice making the same request must succeed, so Bea's 404 can only come
from whose row it is.

A new resource type, or a new route over one, is not isolated until this
test covers it. Each probe also runs once per way of signing in
(`SIGN_IN`): a session cookie, and an API token (issue #413), whose own
list and revoke routes are probed like any other owned row.
"""

import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient

from app.calendar_source import CalendarEventEntry, CalendarListEntry
from app.config import Settings
from app.main import create_app
from app.session import SESSION_COOKIE_NAME
from tests.conftest import FakeCalendarSource, FakeClock, create_user_row, log_in
from tests.test_assistant_chat import StubChatProvider

MARKER = "alice"
TOKENS = "/api/v1/auth/me/tokens"
ALICES_RUN = "alice-run"


@dataclass(frozen=True)
class Actor:
    """One signed-in User. Every request carries only their own credential:
    the shared TestClient's cookie jar is emptied first, so nothing one
    actor's response set can leak into the other's request."""

    client: TestClient
    credentials: dict[str, str]

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> httpx.Response:
        self.client.cookies.clear()
        return self.client.request(method, path, json=body, headers=self.credentials)

    def ok(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        response = self.request(method, path, body)
        assert response.status_code < 400, (method, path, response.text)
        return response.json() if response.content else None


type SignIn = Callable[[TestClient, str], dict[str, str]]


def sign_in_with_cookie(client: TestClient, username: str) -> dict[str, str]:
    client.cookies.clear()
    log_in(client, username)
    token = client.cookies[SESSION_COOKIE_NAME]
    client.cookies.clear()
    return {"Cookie": f"{SESSION_COOKIE_NAME}={token}"}


def create_api_token(client: TestClient, username: str, name: str) -> dict[str, Any]:
    """`username` mints a token, signed in with their password: a token
    can't mint another."""
    client.cookies.clear()
    log_in(client, username)
    response = client.post(TOKENS, json={"name": name})
    client.cookies.clear()
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


def sign_in_with_token(client: TestClient, username: str) -> dict[str, str]:
    token = create_api_token(client, username, f"{username} client")["token"]
    return {"Authorization": f"Bearer {token}"}


# Every way a client can prove who it is. Each probe runs once per entry.
SIGN_IN: dict[str, SignIn] = {"cookie": sign_in_with_cookie, "token": sign_in_with_token}


@dataclass(frozen=True)
class World:
    """The ids of what one User owns."""

    today: date
    inbox: int
    list: int
    task: int
    goal: int
    focus_session: int
    timer: int


@dataclass(frozen=True)
class AliceWorld(World):
    """Alice owns one of every resource type."""

    folder: int
    section: int
    tag: int
    check_item: int
    habit: int
    key_result: int
    standup_entry: int
    bullet: int
    google_account: int
    google_calendar: int
    api_token: int


type Request = Callable[[AliceWorld, World], tuple[str, str, dict[str, Any] | None]]


@dataclass(frozen=True)
class Reach:
    """Bea gets 404; Alice, making the same request, succeeds."""

    request: Request


@dataclass(frozen=True)
class Read:
    """Bea's answer carries no row of Alice's; Alice's own does.

    `rows` picks Alice's rows out of a body for reads whose rows carry no
    marker text (an Inbox, a Check-in); otherwise Alice's rows are found by
    the "alice" every one of her names, titles and notes contains.
    `seen_by_assistant` judges what the Assistant's provider was sent
    rather than the response itself."""

    request: Request
    rows: Callable[[Any, AliceWorld], list[Any]] | None = None
    seen_by_assistant: bool = False


@dataclass(frozen=True)
class OwnWrite:
    """Bea's request succeeds, on her own rows only."""

    request: Request


type Probe = Reach | Read | OwnWrite


def get(path: Callable[[AliceWorld, World], str]) -> Request:
    return lambda a, me: ("GET", path(a, me), None)


def items(body: Any, _a: AliceWorld) -> list[Any]:
    return list(body["items"])


READS: dict[str, Read] = {
    "lists": Read(
        get(lambda a, me: "/api/v1/lists"),
        rows=lambda body, a: [r for r in body["items"] if r["id"] in (a.inbox, a.list)],
    ),
    "folders": Read(get(lambda a, me: "/api/v1/folders")),
    "sections": Read(get(lambda a, me: "/api/v1/sections")),
    "sections of a list": Read(get(lambda a, me: f"/api/v1/sections?list_id={a.list}")),
    "tags": Read(get(lambda a, me: "/api/v1/tags")),
    "tasks": Read(get(lambda a, me: "/api/v1/tasks")),
    "tasks of a list": Read(get(lambda a, me: f"/api/v1/tasks?list_id={a.list}")),
    "tasks with a tag": Read(get(lambda a, me: f"/api/v1/tasks?tag_id={a.tag}")),
    "tasks toward a key result": Read(
        get(lambda a, me: f"/api/v1/tasks?key_result_id={a.key_result}")
    ),
    "search by title": Read(get(lambda a, me: "/api/v1/tasks?search=task")),
    "search by description": Read(get(lambda a, me: "/api/v1/tasks?search=notes")),
    "search by check item": Read(get(lambda a, me: "/api/v1/tasks?search=step")),
    "smart list today": Read(get(lambda a, me: f"/api/v1/tasks?view=today&today={a.today}")),
    "smart list next 7 days": Read(get(lambda a, me: f"/api/v1/tasks?view=next7&today={a.today}")),
    "smart list all": Read(get(lambda a, me: "/api/v1/tasks?view=all")),
    "scheduled tasks": Read(get(lambda a, me: "/api/v1/tasks?scheduled=true")),
    "completed view": Read(get(lambda a, me: "/api/v1/tasks?completed=true")),
    "calendar window": Read(
        get(lambda a, me: f"/api/v1/tasks?range_start={a.today}&range_end={a.today}")
    ),
    "completed occurrences": Read(get(lambda a, me: "/api/v1/completed-occurrences")),
    "completed occurrences of a list": Read(
        get(lambda a, me: f"/api/v1/completed-occurrences?list_id={a.inbox}")
    ),
    "habits": Read(get(lambda a, me: "/api/v1/habits")),
    "habits due today": Read(get(lambda a, me: f"/api/v1/habits?due={a.today}")),
    "check-ins": Read(get(lambda a, me: "/api/v1/check-ins"), rows=items),
    "check-ins of a day": Read(get(lambda a, me: f"/api/v1/check-ins?date={a.today}"), rows=items),
    "check-ins of a habit": Read(
        get(lambda a, me: f"/api/v1/check-ins?habit_id={a.habit}"), rows=items
    ),
    "goals": Read(get(lambda a, me: "/api/v1/goals")),
    "focus sessions": Read(get(lambda a, me: "/api/v1/focus-sessions")),
    "focus stats": Read(
        get(lambda a, me: f"/api/v1/focus-stats?start={a.today}&end={a.today}&tz=UTC")
    ),
    "timers": Read(get(lambda a, me: "/api/v1/timers")),
    "now": Read(
        get(lambda a, me: "/api/v1/now"),
        rows=lambda body, a: [body["task_id"]] if body["task_id"] else [],
    ),
    "now resume note": Read(get(lambda a, me: "/api/v1/now/note")),
    "now shortlist": Read(
        get(lambda a, me: "/api/v1/now/shortlist"), rows=lambda body, a: list(body["task_ids"])
    ),
    "now toggle": Read(
        get(lambda a, me: "/api/v1/settings/now"),
        rows=lambda body, a: [body] if body["enabled"] else [],
    ),
    "gentle return toggle": Read(
        get(lambda a, me: "/api/v1/settings/gentle-return"),
        rows=lambda body, a: [body] if body["enabled"] else [],
    ),
    "reminder notifications toggle": Read(
        get(lambda a, me: "/api/v1/settings/reminder-notifications"),
        rows=lambda body, a: [body] if body["enabled"] else [],
    ),
    "stand-up suggestions today": Read(
        get(lambda a, me: f"/api/v1/stand-up/suggestions/today?date={a.today}")
    ),
    "stand-up suggestions yesterday": Read(
        get(
            lambda a, me: (
                f"/api/v1/stand-up/suggestions/yesterday?date={a.today + timedelta(days=1)}"
            )
        )
    ),
    "stand-up focused goal": Read(get(lambda a, me: "/api/v1/stand-up/focused-goal")),
    "stand-up entries": Read(
        get(lambda a, me: "/api/v1/stand-up/entries"),
        rows=lambda body, a: [r for r in body["items"] if r["id"] == a.standup_entry],
    ),
    "stand-up entry of a shared date": Read(
        get(lambda a, me: f"/api/v1/stand-up/entries/{a.today}")
    ),
    "google accounts": Read(get(lambda a, me: "/api/v1/google/accounts")),
    "calendar events": Read(
        get(lambda a, me: f"/api/v1/events?range_start={a.today}&range_end={a.today}")
    ),
    "api tokens": Read(get(lambda a, me: TOKENS)),
}

ASSISTANT_READ = Read(
    lambda a, me: (
        "POST",
        "/api/v1/assistant/chat",
        {
            "transcript": [{"role": "user", "content": "plan my day"}],
            "local_date": a.today.isoformat(),
            "time_zone": "UTC",
        },
    ),
    seen_by_assistant=True,
)


def item(path: Callable[[AliceWorld], str], patch: dict[str, Any]) -> dict[str, Reach]:
    """GET, PATCH and DELETE of one of Alice's rows."""
    return {
        "GET": Reach(lambda a, me: ("GET", path(a), None)),
        "PATCH": Reach(lambda a, me: ("PATCH", path(a), patch)),
        "DELETE": Reach(lambda a, me: ("DELETE", path(a), None)),
    }


ITEM_PATCHES: dict[str, tuple[Callable[[AliceWorld], str], dict[str, Any]]] = {
    "folder": (lambda a: f"/api/v1/folders/{a.folder}", {"name": "x"}),
    "list": (lambda a: f"/api/v1/lists/{a.list}", {"name": "x"}),
    "section": (lambda a: f"/api/v1/sections/{a.section}", {"name": "x"}),
    "tag": (lambda a: f"/api/v1/tags/{a.tag}", {"name": "x"}),
    "task": (lambda a: f"/api/v1/tasks/{a.task}", {"title": "x"}),
    "check item": (
        lambda a: f"/api/v1/tasks/{a.task}/check-items/{a.check_item}",
        {"title": "x"},
    ),
    "habit": (lambda a: f"/api/v1/habits/{a.habit}", {"name": "x"}),
    "goal": (lambda a: f"/api/v1/goals/{a.goal}", {"title": "x"}),
    "key result": (
        lambda a: f"/api/v1/goals/{a.goal}/key-results/{a.key_result}",
        {"name": "x"},
    ),
    "focus session": (lambda a: f"/api/v1/focus-sessions/{a.focus_session}", {"note": "x"}),
    "timer": (lambda a: f"/api/v1/timers/{a.timer}", {"name": "x"}),
}

REACHES: dict[str, Reach] = {
    f"{verb} {name}": probe
    for name, (path, patch) in ITEM_PATCHES.items()
    for verb, probe in item(path, patch).items()
}
REACHES |= {
    # The Inbox only takes a view mode, and nobody may delete it.
    "GET inbox": Reach(get(lambda a, me: f"/api/v1/lists/{a.inbox}")),
    "PATCH inbox": Reach(
        lambda a, me: ("PATCH", f"/api/v1/lists/{a.inbox}", {"view_mode": "kanban"})
    ),
    "habit stats": Reach(
        get(lambda a, me: f"/api/v1/habits/{a.habit}/stats?today={a.today}&tz=UTC")
    ),
    "revoke api token": Reach(lambda a, me: ("DELETE", f"{TOKENS}/{a.api_token}", None)),
    "PUT check-in": Reach(
        lambda a, me: ("PUT", f"/api/v1/habits/{a.habit}/check-ins/{a.today}", {"value": 1})
    ),
    "DELETE check-in": Reach(
        lambda a, me: ("DELETE", f"/api/v1/habits/{a.habit}/check-ins/{a.today}", None)
    ),
    "PATCH stand-up bullet": Reach(
        lambda a, me: (
            "PATCH",
            f"/api/v1/stand-up/entries/{a.today}/bullets/{a.bullet}",
            {"text": "x"},
        )
    ),
    "DELETE stand-up bullet": Reach(
        lambda a, me: ("DELETE", f"/api/v1/stand-up/entries/{a.today}/bullets/{a.bullet}", None)
    ),
    "google calendars": Reach(
        get(lambda a, me: f"/api/v1/google/accounts/{a.google_account}/calendars")
    ),
    "refresh google calendars": Reach(
        lambda a, me: (
            "POST",
            f"/api/v1/google/accounts/{a.google_account}/calendars/refresh",
            None,
        )
    ),
    "PATCH google calendar": Reach(
        lambda a, me: (
            "PATCH",
            f"/api/v1/google/accounts/{a.google_account}/calendars/{a.google_calendar}",
            {"enabled": False},
        )
    ),
    "DELETE google account": Reach(
        lambda a, me: ("DELETE", f"/api/v1/google/accounts/{a.google_account}", None)
    ),
}

# Alice's ids named as the parent of, or a link from, one of the requester's
# own rows.
PARENTS: dict[str, Reach] = {
    "section in a list": Reach(
        lambda a, me: ("POST", "/api/v1/sections", {"list_id": a.list, "name": "x"})
    ),
    "task in a list": Reach(
        lambda a, me: ("POST", "/api/v1/tasks", {"title": "x", "list_id": a.list})
    ),
    "task in a section": Reach(
        lambda a, me: (
            "POST",
            "/api/v1/tasks",
            {"title": "x", "list_id": me.list, "section_id": a.section},
        )
    ),
    "task with a tag": Reach(
        lambda a, me: ("POST", "/api/v1/tasks", {"title": "x", "tag_ids": [a.tag]})
    ),
    "task toward a key result": Reach(
        lambda a, me: ("POST", "/api/v1/tasks", {"title": "x", "key_result_id": a.key_result})
    ),
    "task from a google calendar": Reach(
        lambda a, me: (
            "POST",
            "/api/v1/tasks",
            {
                "title": "x",
                "source_google_calendar_id": a.google_calendar,
                "source_google_event_id": "evt-x",
            },
        )
    ),
    "task moved to a list": Reach(
        lambda a, me: ("PATCH", f"/api/v1/tasks/{me.task}", {"list_id": a.list})
    ),
    "task moved to a section": Reach(
        lambda a, me: (
            "PATCH",
            f"/api/v1/tasks/{me.task}",
            {"list_id": me.list, "section_id": a.section},
        )
    ),
    "task retagged": Reach(
        lambda a, me: ("PATCH", f"/api/v1/tasks/{me.task}", {"tag_ids": [a.tag]})
    ),
    "task linked to a key result": Reach(
        lambda a, me: ("PATCH", f"/api/v1/tasks/{me.task}", {"key_result_id": a.key_result})
    ),
    "list moved to a folder": Reach(
        lambda a, me: ("PATCH", f"/api/v1/lists/{me.list}", {"folder_id": a.folder})
    ),
    "check item on a task": Reach(
        lambda a, me: ("POST", f"/api/v1/tasks/{a.task}/check-items", {"title": "x"})
    ),
    "key result on a goal": Reach(
        lambda a, me: ("POST", f"/api/v1/goals/{a.goal}/key-results", {"name": "x"})
    ),
    "key result counting a habit": Reach(
        lambda a, me: (
            "POST",
            f"/api/v1/goals/{me.goal}/key-results",
            {"name": "x", "source": "habit_checkins", "source_habit_id": a.habit},
        )
    ),
    "focus session on a task": Reach(
        lambda a, me: ("POST", "/api/v1/focus-sessions", focus_session(a.today, task_id=a.task))
    ),
    "focus session on a habit": Reach(
        lambda a, me: ("POST", "/api/v1/focus-sessions", focus_session(a.today, habit_id=a.habit))
    ),
    "focus session relinked to a task": Reach(
        lambda a, me: ("PATCH", f"/api/v1/focus-sessions/{me.focus_session}", {"task_id": a.task})
    ),
    "focus session relinked to a habit": Reach(
        lambda a, me: (
            "PATCH",
            f"/api/v1/focus-sessions/{me.focus_session}",
            {"task_id": None, "habit_id": a.habit},
        )
    ),
    "timer on a task": Reach(
        lambda a, me: (
            "POST",
            "/api/v1/timers",
            {"name": "x", "mode": "stopwatch", "task_id": a.task},
        )
    ),
    "timer on a habit": Reach(
        lambda a, me: (
            "POST",
            "/api/v1/timers",
            {"name": "x", "mode": "stopwatch", "habit_id": a.habit},
        )
    ),
    "timer relinked to a task": Reach(
        lambda a, me: (
            "PATCH",
            f"/api/v1/timers/{me.timer}",
            {"habit_id": None, "task_id": a.task},
        )
    ),
    "now on a task": Reach(lambda a, me: ("PUT", "/api/v1/now", {"task_id": a.task})),
    "now shortlist of a task": Reach(
        lambda a, me: ("PUT", "/api/v1/now/shortlist", {"task_ids": [a.task]})
    ),
    "check item ticked without auto-complete": Reach(
        lambda a, me: (
            "PATCH",
            f"/api/v1/tasks/{a.task}/check-items/{a.check_item}?auto_complete=false",
            {"done": True},
        )
    ),
    "timer relinked to a habit": Reach(
        lambda a, me: ("PATCH", f"/api/v1/timers/{me.timer}", {"habit_id": a.habit})
    ),
}

OWN_WRITES: dict[str, OwnWrite] = {
    "focusing a goal": OwnWrite(
        lambda a, me: ("PATCH", f"/api/v1/goals/{me.goal}", {"is_focused": True})
    ),
    "a tag named like another user's": OwnWrite(
        lambda a, me: ("POST", "/api/v1/tags", {"name": "alice tag"})
    ),
    "clearing completed tasks": OwnWrite(
        lambda a, me: ("DELETE", "/api/v1/tasks?completed=true", None)
    ),
    "clearing another user's list's completed tasks": OwnWrite(
        lambda a, me: ("DELETE", f"/api/v1/tasks?completed=true&list_id={a.inbox}", None)
    ),
    "a stand-up entry on a shared date": OwnWrite(
        lambda a, me: ("PUT", f"/api/v1/stand-up/entries/{a.today}", None)
    ),
    "a stand-up bullet on a shared date": OwnWrite(
        lambda a, me: (
            "POST",
            f"/api/v1/stand-up/entries/{a.today}/bullets",
            {"section": "blockers", "text": "x"},
        )
    ),
    "deleting a stand-up entry on a shared date": OwnWrite(
        lambda a, me: ("DELETE", f"/api/v1/stand-up/entries/{a.today}", None)
    ),
    "saving google credentials": OwnWrite(
        lambda a, me: (
            "PUT",
            "/api/v1/google/credentials",
            {"client_id": "client-b2", "client_secret": "secret-b2"},
        )
    ),
    "choosing now": OwnWrite(lambda a, me: ("PUT", "/api/v1/now", {"task_id": me.task})),
    "clearing now": OwnWrite(lambda a, me: ("PUT", "/api/v1/now", {"task_id": None})),
    "discarding a resume note": OwnWrite(lambda a, me: ("PUT", "/api/v1/now/note", {"note": None})),
    "a shortlist of my own": OwnWrite(
        lambda a, me: ("PUT", "/api/v1/now/shortlist", {"task_ids": [me.task]})
    ),
    "turning now off": OwnWrite(lambda a, me: ("PUT", "/api/v1/settings/now", {"enabled": False})),
    "turning gentle return off": OwnWrite(
        lambda a, me: ("PUT", "/api/v1/settings/gentle-return", {"enabled": False})
    ),
    "turning reminder notifications off": OwnWrite(
        lambda a, me: ("PUT", "/api/v1/settings/reminder-notifications", {"enabled": False})
    ),
    "a focus session reusing another user's run id": OwnWrite(
        lambda a, me: (
            "POST",
            "/api/v1/focus-sessions",
            {**focus_session(a.today), "client_run_id": ALICES_RUN},
        )
    ),
    "removing google credentials": OwnWrite(
        lambda a, me: ("DELETE", "/api/v1/google/credentials", None)
    ),
}

PROBES: dict[str, Probe] = {
    **{f"read {name}": probe for name, probe in READS.items()},
    "read assistant snapshot": ASSISTANT_READ,
    **{f"reach {name}": probe for name, probe in REACHES.items()},
    **{f"parent {name}": probe for name, probe in PARENTS.items()},
    **{f"own {name}": probe for name, probe in OWN_WRITES.items()},
}


def focus_session(
    day: date, *, note: str = "x", task_id: int | None = None, habit_id: int | None = None
) -> dict[str, Any]:
    return {
        "mode": "pomo",
        "started_at": f"{day}T09:00:00Z",
        "ended_at": f"{day}T09:25:00Z",
        "note": note,
        "task_id": task_id,
        "habit_id": habit_id,
    }


@dataclass(frozen=True)
class Pair:
    alice: Actor
    bea: Actor
    a: AliceWorld
    b: World
    assistant: StubChatProvider


def connect_google(
    actor: Actor, calendar_source: FakeCalendarSource, name: str, today: date
) -> tuple[int, int]:
    actor.ok("PUT", "/api/v1/google/credentials", {"client_id": "c", "client_secret": "s"})
    redirect = actor.request("GET", "/api/v1/google/connect")
    state = parse_qs(urlparse(redirect.headers["location"]).query)["state"][0]
    refresh_token = f"{name}-refresh"
    calendar_source.register_code(
        f"{name}-code",
        google_account_id=f"{name}-google",
        email=f"{name}@gmail.com",
        refresh_token=refresh_token,
    )
    callback = actor.request(
        "GET", "/api/v1/google/callback?" + urlencode({"code": f"{name}-code", "state": state})
    )
    assert "googleConnected=1" in callback.headers["location"], callback.headers
    calendar_source.register_calendars(
        refresh_token, [CalendarListEntry(f"{name}-cal", f"{name} calendar", selected=True)]
    )
    calendar_source.register_events(
        refresh_token,
        f"{name}-cal",
        [
            CalendarEventEntry(
                google_event_id=f"{name}-event",
                summary=f"{name} event",
                start=f"{today}T10:00:00Z",
                end=f"{today}T11:00:00Z",
                is_all_day=False,
            )
        ],
    )
    [account] = actor.ok("GET", "/api/v1/google/accounts")
    [calendar] = actor.ok("GET", f"/api/v1/google/accounts/{account['id']}/calendars")
    return account["id"], calendar["id"]


def build_alice(
    alice: Actor,
    calendar_source: FakeCalendarSource,
    assistant: StubChatProvider,
    today: date,
    api_token: int,
) -> AliceWorld:
    """One of every resource type, each named so "alice" finds it.
    `api_token` is minted beforehand: only a password session can."""
    google_account, google_calendar = connect_google(alice, calendar_source, MARKER, today)
    alice.ok(
        "PUT",
        "/api/v1/assistant/config",
        {"base_url": assistant.base_url, "model": "m", "api_key": "k"},
    )
    [inbox] = [r["id"] for r in alice.ok("GET", "/api/v1/lists")["items"]]
    folder = alice.ok("POST", "/api/v1/folders", {"name": "alice folder"})["id"]
    task_list = alice.ok("POST", "/api/v1/lists", {"name": "alice list"})["id"]
    alice.ok("PATCH", f"/api/v1/lists/{task_list}", {"folder_id": folder})
    section = alice.ok("POST", "/api/v1/sections", {"list_id": task_list, "name": "alice section"})
    tag = alice.ok("POST", "/api/v1/tags", {"name": "alice tag"})["id"]
    goal = alice.ok("POST", "/api/v1/goals", {"title": "alice goal"})["id"]
    alice.ok("PATCH", f"/api/v1/goals/{goal}", {"is_focused": True})
    key_result = alice.ok("POST", f"/api/v1/goals/{goal}/key-results", {"name": "alice kr"})[
        "key_results"
    ][0]["id"]
    habit = alice.ok("POST", "/api/v1/habits", {"name": "alice habit"})["id"]
    alice.ok("PUT", f"/api/v1/habits/{habit}/check-ins/{today}", {"value": 1})
    task = alice.ok(
        "POST",
        "/api/v1/tasks",
        {
            "title": "alice task",
            "description": "alice notes",
            "list_id": task_list,
            "section_id": section["id"],
            "tag_ids": [tag],
            "key_result_id": key_result,
            "due_date": f"{today}T15:00:00Z",
        },
    )["id"]
    check_item = alice.ok("POST", f"/api/v1/tasks/{task}/check-items", {"title": "alice step"})[
        "check_items"
    ][0]["id"]
    recurring = alice.ok(
        "POST",
        "/api/v1/tasks",
        {"title": "alice daily", "due_date": f"{today}T08:00:00Z", "recurrence": "FREQ=DAILY"},
    )["id"]
    alice.ok("PATCH", f"/api/v1/tasks/{recurring}", {"completed": True})
    done = alice.ok("POST", "/api/v1/tasks", {"title": "alice done"})["id"]
    alice.ok("PATCH", f"/api/v1/tasks/{done}", {"completed": True})
    alice.ok(
        "POST",
        "/api/v1/tasks",
        {
            "title": "alice converted",
            "source_google_calendar_id": google_calendar,
            "source_google_event_id": "alice-converted-event",
        },
    )
    focus = alice.ok(
        "POST",
        "/api/v1/focus-sessions",
        {**focus_session(today, note="alice focus", task_id=task), "client_run_id": ALICES_RUN},
    )["id"]
    shortlisted = alice.ok("POST", "/api/v1/tasks", {"title": "alice shortlisted"})["id"]
    alice.ok("PUT", "/api/v1/settings/now", {"enabled": True})
    alice.ok("PUT", "/api/v1/now", {"task_id": task})
    alice.ok("PUT", "/api/v1/now/note", {"note": "alice resume note"})
    alice.ok("PUT", "/api/v1/now/shortlist", {"task_ids": [shortlisted]})
    alice.ok("PUT", "/api/v1/settings/gentle-return", {"enabled": True})
    alice.ok("PUT", "/api/v1/settings/reminder-notifications", {"enabled": True})
    timer = alice.ok(
        "POST", "/api/v1/timers", {"name": "alice timer", "mode": "stopwatch", "habit_id": habit}
    )["id"]
    entry = alice.ok(
        "POST",
        f"/api/v1/stand-up/entries/{today}/bullets",
        {"section": "today", "text": "alice bullet"},
    )
    return AliceWorld(
        today=today,
        inbox=inbox,
        list=task_list,
        task=task,
        goal=goal,
        focus_session=focus,
        timer=timer,
        folder=folder,
        section=section["id"],
        tag=tag,
        check_item=check_item,
        habit=habit,
        key_result=key_result,
        standup_entry=entry["id"],
        bullet=entry["bullets"][0]["id"],
        google_account=google_account,
        google_calendar=google_calendar,
        api_token=api_token,
    )


def build_bea(bea: Actor, assistant: StubChatProvider, today: date) -> World:
    """Just enough of her own for probes that name a row of hers, plus the
    same integrations as Alice, so no 404 of hers is down to a missing
    setting."""
    bea.ok("PUT", "/api/v1/google/credentials", {"client_id": "c", "client_secret": "s"})
    bea.ok(
        "PUT",
        "/api/v1/assistant/config",
        {"base_url": assistant.base_url, "model": "m", "api_key": "k"},
    )
    [inbox] = [r["id"] for r in bea.ok("GET", "/api/v1/lists")["items"]]
    bea.ok(
        "POST",
        f"/api/v1/stand-up/entries/{today}/bullets",
        {"section": "today", "text": "bea bullet"},
    )
    return World(
        today=today,
        inbox=inbox,
        list=bea.ok("POST", "/api/v1/lists", {"name": "bea list"})["id"],
        task=bea.ok("POST", "/api/v1/tasks", {"title": "bea task"})["id"],
        goal=bea.ok("POST", "/api/v1/goals", {"title": "bea goal"})["id"],
        focus_session=bea.ok("POST", "/api/v1/focus-sessions", focus_session(today))["id"],
        timer=bea.ok("POST", "/api/v1/timers", {"name": "bea timer", "mode": "stopwatch"})["id"],
    )


@pytest.fixture(params=sorted(SIGN_IN))
def sign_in(request: pytest.FixtureRequest) -> SignIn:
    return SIGN_IN[request.param]


@pytest.fixture
def assistant() -> Iterator[StubChatProvider]:
    stub = StubChatProvider()
    stub.set_json_content({"message": "Hi", "suggestions": []})
    yield stub
    stub.stop()


@pytest.fixture
def pair(
    database_url: str,
    fake_clock: FakeClock,
    fake_calendar_source: FakeCalendarSource,
    assistant: StubChatProvider,
    sign_in: SignIn,
) -> Iterator[Pair]:
    app = create_app(
        Settings(database_url=database_url), clock=fake_clock, calendar_source=fake_calendar_source
    )
    with TestClient(app, follow_redirects=False) as client:
        create_user_row(app, "alice", "alice@example.com")
        create_user_row(app, "bea", "bea@example.com")
        alices_token = create_api_token(client, "alice", "alice token")["id"]
        alice = Actor(client, sign_in(client, "alice"))
        bea = Actor(client, sign_in(client, "bea"))
        today = fake_clock.now.date()
        yield Pair(
            alice=alice,
            bea=bea,
            a=build_alice(alice, fake_calendar_source, assistant, today, alices_token),
            b=build_bea(bea, assistant, today),
            assistant=assistant,
        )


def seen(response: httpx.Response, probe: Read, assistant: StubChatProvider) -> str:
    if probe.seen_by_assistant:
        assert response.status_code == 200, response.text
        return json.dumps(assistant.request_at(assistant.request_count - 1))
    return response.text


def alices_view(pair: Pair) -> dict[str, str]:
    """Everything Alice can read, as Alice reads it."""
    views = {}
    for name, probe in READS.items():
        method, path, body = probe.request(pair.a, pair.a)
        views[name] = pair.alice.request(method, path, body).text
    return views


@pytest.mark.parametrize("probe", PROBES.values(), ids=PROBES.keys())
def test_one_user_cannot_reach_another_users_rows(pair: Pair, probe: Probe) -> None:
    before = alices_view(pair)

    method, path, body = probe.request(pair.a, pair.b)
    response = pair.bea.request(method, path, body)

    match probe:
        case Reach():
            assert response.status_code == 404, response.text
            assert response.json()["error"]["code"] == "not_found"
        case Read():
            assert response.status_code == 200, response.text
            assert MARKER not in seen(response, probe, pair.assistant)
            if probe.rows is not None:
                assert probe.rows(response.json(), pair.a) == []
        case OwnWrite():
            assert response.status_code < 300, response.text
    assert alices_view(pair) == before, "Bea's request changed what Alice sees"

    if isinstance(probe, OwnWrite):
        return
    # The same request is Alice's to make, so Bea's answer can only be
    # down to whose rows they are.
    method, path, body = probe.request(pair.a, pair.a)
    response = pair.alice.request(method, path, body)
    assert response.status_code < 300, response.text
    if isinstance(probe, Read):
        if probe.rows is not None:
            assert probe.rows(response.json(), pair.a) != []
        else:
            assert MARKER in seen(response, probe, pair.assistant)


def test_a_run_id_is_only_matched_among_the_users_own_sessions(pair: Pair) -> None:
    """Retry-safe saves (#546) look a run up by `client_run_id`: Bea reusing
    Alice's id records her own session rather than being handed Alice's."""
    body = {**focus_session(pair.a.today, note="bea focus"), "client_run_id": ALICES_RUN}

    response = pair.bea.request("POST", "/api/v1/focus-sessions", body)

    assert response.status_code == 201, response.text
    assert response.json()["note"] == "bea focus"
