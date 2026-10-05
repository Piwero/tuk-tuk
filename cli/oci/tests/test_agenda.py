"""Unit tests drive the real entrypoint with a mock transport.

`agenda` composes three existing reads — the Today Smart List, Habits due
on the local day, and the day's Events — in parallel. The Events read is
failure-isolated: whatever goes wrong on the calendar side contributes
nothing and never fails the command.
"""

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from tuk.cli import main

TASKS_PAGE = {
    "items": [
        {
            "id": 7,
            "title": "Water plants",
            "due_date": "2026-10-04T00:00:00Z",
            "is_all_day": True,
            "priority": "high",
        },
    ],
    "total": 1,
    "limit": 50,
    "offset": 0,
}

HABITS_PAGE = {
    "items": [
        {
            "id": 3,
            "name": "Drink water",
            "type": "boolean",
            "frequency": "daily",
        },
    ],
    "total": 1,
    "limit": 200,
    "offset": 0,
}

EVENTS_BODY = {
    "events": [
        {
            "id": "1:abc",
            "title": "Standup",
            "start_date": "2026-10-04T09:00:00Z",
            "due_date": "2026-10-04T09:30:00Z",
            "is_all_day": False,
        },
    ],
    "failures": [],
}

EMPTY_EVENTS = {"events": [], "failures": []}

REVOKED_EVENTS = {
    "events": [],
    "failures": [
        {
            "account_id": 1,
            "email": "owner@example.com",
            "kind": "terminal",
            "message": "Grant revoked",
        },
    ],
}


@pytest.fixture
def logged_in(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    target = tmp_path / "config"
    monkeypatch.setenv("TUK_CONFIG_DIR", str(target))
    monkeypatch.setenv("TUK_TIMEZONE", "Europe/London")
    target.mkdir(parents=True, exist_ok=True)
    (target / "tuk").mkdir(exist_ok=True)
    (target / "tuk" / "config.json").write_text(json.dumps({"base_url": "http://x"}))
    (target / "tuk" / "session.json").write_text(json.dumps({"session_cookie": "sess"}))
    return target


def agenda_transport(
    tasks: object = TASKS_PAGE,
    tasks_status: int = 200,
    habits: object = HABITS_PAGE,
    events: object = EVENTS_BODY,
    events_status: int = 200,
) -> tuple[httpx.MockTransport, dict[str, object], list[str]]:
    seen: dict[str, object] = {}
    hits: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        hits.append(request.url.path)
        if request.url.path == "/api/v1/tasks":
            for key, value in request.url.params.items():
                seen[f"tasks:{key}"] = value
            return httpx.Response(tasks_status, json=tasks)
        if request.url.path == "/api/v1/habits":
            for key, value in request.url.params.items():
                seen[f"habits:{key}"] = value
            return httpx.Response(200, json=habits)
        if request.url.path == "/api/v1/events":
            for key, value in request.url.params.items():
                seen[f"events:{key}"] = value
            if isinstance(events, BaseException):
                raise events
            return httpx.Response(events_status, json=events)
        raise AssertionError(f"unexpected {request.method} {request.url.path}")

    return httpx.MockTransport(handler), seen, hits


def test_agenda_renders_tasks_habits_and_events(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _, hits = agenda_transport()

    assert main(["agenda"], transport=transport) == 0

    assert set(hits) == {"/api/v1/tasks", "/api/v1/habits", "/api/v1/events"}
    out = capsys.readouterr().out
    assert "7" in out
    assert "Water plants" in out
    assert "3" in out
    assert "Drink water" in out
    assert "Standup" in out
    assert "Europe/London" in out


def test_agenda_reads_share_the_local_day(logged_in: Path) -> None:
    transport, seen, _ = agenda_transport()
    expected = datetime.now(ZoneInfo("Europe/London")).date().isoformat()

    assert main(["agenda"], transport=transport) == 0

    assert seen["tasks:view"] == "today"
    assert seen["tasks:today"] == expected
    assert seen["habits:due"] == expected
    assert seen["events:range_start"] == expected
    assert seen["events:range_end"] == expected


def test_agenda_unconfigured_google_omits_events_section(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _, _ = agenda_transport(events=EMPTY_EVENTS)

    assert main(["agenda"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "Water plants" in out
    assert "Drink water" in out
    assert "Events" not in out


def test_agenda_failed_event_read_still_renders_tasks_and_habits(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    error = {"error": {"code": "http_error", "message": "Google is down"}}
    transport, _, _ = agenda_transport(events=error, events_status=500)

    assert main(["agenda"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "Water plants" in out
    assert "Drink water" in out
    assert "Events" not in out


def test_agenda_revoked_grant_still_renders_tasks_and_habits(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _, _ = agenda_transport(events=REVOKED_EVENTS)

    assert main(["agenda"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "Water plants" in out
    assert "Drink water" in out
    assert "Events" not in out


def test_agenda_network_failure_still_renders_tasks_and_habits(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _, _ = agenda_transport(events=httpx.ConnectError("boom"))

    assert main(["agenda"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "Water plants" in out
    assert "Drink water" in out
    assert "Events" not in out


def test_agenda_json_emits_composed_shape(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _, _ = agenda_transport()
    expected_day = datetime.now(ZoneInfo("Europe/London")).date().isoformat()

    assert main(["agenda", "--json"], transport=transport) == 0

    body = json.loads(capsys.readouterr().out)
    assert body["date"] == expected_day
    assert body["time_zone"] == "Europe/London"
    assert [task["id"] for task in body["tasks"]] == [7]
    assert [habit["id"] for habit in body["habits"]] == [3]
    assert [event["title"] for event in body["events"]] == ["Standup"]


def test_agenda_json_reports_no_events_when_calendar_fails(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    error = {"error": {"code": "http_error", "message": "Google is down"}}
    transport, _, _ = agenda_transport(events=error, events_status=500)

    assert main(["agenda", "--json"], transport=transport) == 0

    body = json.loads(capsys.readouterr().out)
    assert body["events"] == []
    assert [task["id"] for task in body["tasks"]] == [7]


def test_agenda_says_when_a_page_left_rows_behind(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Both reads are one page, so both have to state their remainder — an
    Agenda that quietly dropped the day's overflow would read as complete."""
    transport, _, _ = agenda_transport(
        tasks={"items": TASKS_PAGE["items"], "total": 4, "limit": 1, "offset": 0},
        habits={"items": HABITS_PAGE["items"], "total": 3, "limit": 1, "offset": 0},
    )

    assert main(["agenda"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "3 more" in out
    assert "2 more" in out


def reissuing_agenda_transport(reissue_on: str) -> httpx.MockTransport:
    """An agenda transport where exactly one of the three reads reissues the
    cookie, named in the returned value so the test can tell which."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        headers = (
            {"set-cookie": f"tuktuk_session=rolled-by-{reissue_on}; Path=/; HttpOnly"}
            if path.endswith(reissue_on)
            else {}
        )
        bodies = {
            "/api/v1/tasks": TASKS_PAGE,
            "/api/v1/habits": HABITS_PAGE,
            "/api/v1/events": EMPTY_EVENTS,
        }
        if path not in bodies:
            raise AssertionError(f"unexpected {request.method} {path}")
        return httpx.Response(200, json=bodies[path], headers=headers)

    return httpx.MockTransport(handler)


@pytest.mark.parametrize("reissue_on", ["tasks", "habits", "events"])
def test_agenda_persists_a_reissued_session_cookie(logged_in: Path, reissue_on: str) -> None:
    """The middleware's rolling reissue is what keeps a daily-use session
    alive, so the daily-use command has to keep the cookie it hands back —
    whichever of the three parallel reads was the one to carry it."""
    assert main(["agenda"], transport=reissuing_agenda_transport(reissue_on)) == 0

    session = json.loads((logged_in / "tuk" / "session.json").read_text())
    assert session == {"session_cookie": f"rolled-by-{reissue_on}"}


def test_agenda_expired_session_points_at_login(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    body = {"error": {"code": "unauthorized", "message": "A valid session is required"}}
    transport, _, _ = agenda_transport(tasks=body, tasks_status=401)

    assert main(["agenda"], transport=transport) == 1

    assert "tuk login" in capsys.readouterr().err
