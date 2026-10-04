"""Unit tests drive the real entrypoint with a mock transport.

One handler serves the three routes `add` touches: the Lists and Tags
collections for name resolution, and the Task creation POST. Tests assert
the emitted request body, the resolution behaviour (hits, misses,
case-insensitivity), the date vocabulary mapping, and the rendered output.
"""

import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from tuk.cli import main

LISTS_BODY = {
    "items": [
        {"id": 1, "name": "Inbox"},
        {"id": 2, "name": "Groceries"},
    ],
    "total": 2,
    "limit": 200,
    "offset": 0,
}

TAGS_BODY = {
    "items": [
        {"id": 5, "name": "home"},
        {"id": 6, "name": "Urgent"},
    ],
    "total": 2,
    "limit": 200,
    "offset": 0,
}

CREATED_BODY = {"id": 42, "title": "Buy milk"}


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


def add_transport(
    created: object = CREATED_BODY,
    create_status: int = 201,
    lists: object = LISTS_BODY,
    tags: object = TAGS_BODY,
) -> tuple[httpx.MockTransport, dict[str, object]]:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["cookie"] = request.headers.get("cookie", "")
        seen["path"] = request.url.path
        if request.url.path == "/api/v1/tasks" and request.method == "POST":
            seen["body"] = json.loads(request.content.decode())
            return httpx.Response(create_status, json=created)
        if request.url.path == "/api/v1/lists":
            assert request.method == "GET", request.method
            seen["lists_hit"] = True
            return httpx.Response(200, json=lists)
        if request.url.path == "/api/v1/tags":
            assert request.method == "GET", request.method
            seen["tags_hit"] = True
            return httpx.Response(200, json=tags)
        raise AssertionError(f"unexpected {request.method} {request.url.path}")

    return httpx.MockTransport(handler), seen


def test_add_title_only_sends_minimal_body(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = add_transport()

    assert main(["add", "Buy milk"], transport=transport) == 0

    assert seen["body"] == {"title": "Buy milk"}
    assert "lists_hit" not in seen
    assert "42" in capsys.readouterr().out


def test_add_unknown_priority_surfaces_api_message(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    error = {"error": {"code": "invalid_priority", "message": "Unknown priority 'urgent-ish'"}}
    transport, seen = add_transport(created=error, create_status=422)

    assert main(["add", "Buy milk", "--priority", "urgent-ish"], transport=transport) == 1

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["priority"] == "urgent-ish"
    err = capsys.readouterr().err
    assert "Unknown priority" in err
    assert "422" not in err


def test_add_json_emits_created_body(logged_in: Path, capsys: pytest.CaptureFixture[str]) -> None:
    transport, _ = add_transport()

    assert main(["add", "--json", "Buy milk"], transport=transport) == 0

    assert json.loads(capsys.readouterr().out) == CREATED_BODY


def test_add_resolves_list_name_case_insensitively(logged_in: Path) -> None:
    transport, seen = add_transport()

    assert main(["add", "Buy milk", "--list", "groceries"], transport=transport) == 0

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["list_id"] == 2
    assert seen["lists_hit"] is True


def test_add_unknown_list_names_candidates(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = add_transport()

    assert main(["add", "Buy milk", "--list", "Nope"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "Nope" in err
    assert "Groceries" in err
    assert "path" not in seen or seen.get("body") is None


def test_add_resolves_tag_names(logged_in: Path) -> None:
    transport, seen = add_transport()

    assert main(["add", "Buy milk", "--tag", "HOME", "--tag", "urgent"], transport=transport) == 0

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["tag_ids"] == [5, 6]


def test_add_unknown_tag_errors_without_creating(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = add_transport()

    assert main(["add", "Buy milk", "--tag", "Nope"], transport=transport) == 1

    assert "Nope" in capsys.readouterr().err
    assert "body" not in seen


def test_add_maps_full_flag_set(logged_in: Path) -> None:
    transport, seen = add_transport()

    assert (
        main(
            [
                "add",
                "Buy milk",
                "--list",
                "Groceries",
                "--tag",
                "home",
                "--priority",
                "high",
                "--description",
                "Oat if they have it",
                "--due",
                "tomorrow",
                "--start",
                "today",
                "--all-day",
                "--recurrence",
                "RRULE:FREQ=DAILY",
                "--reminder",
                "-PT30M",
            ],
            transport=transport,
        )
        == 0
    )

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["list_id"] == 2
    assert body["tag_ids"] == [5]
    assert body["priority"] == "high"
    assert body["description"] == "Oat if they have it"
    assert body["is_all_day"] is True
    assert body["recurrence"] == "RRULE:FREQ=DAILY"
    assert body["reminders"] == ["-PT30M"]
    assert body["time_zone"] == "Europe/London"
    london_tomorrow = (
        datetime.now(ZoneInfo("Europe/London")).date() + timedelta(days=1)
    ).isoformat()
    assert str(body["due_date"]).startswith(london_tomorrow)


def test_add_timed_due_carries_time(logged_in: Path) -> None:
    transport, seen = add_transport()

    assert main(["add", "Call", "--due", "tomorrow 09:30"], transport=transport) == 0

    body = seen["body"]
    assert isinstance(body, dict)
    assert "T09:30" in str(body["due_date"])


def test_add_full_date_vocabulary_at_seam(logged_in: Path) -> None:
    london_today = datetime.now(ZoneInfo("Europe/London")).date()
    cases = {
        "today": london_today,
        "tomorrow": london_today + timedelta(days=1),
        "yesterday": london_today - timedelta(days=1),
        "2026-12-25": datetime(2026, 12, 25).date(),
    }
    weekday = london_today + timedelta(days=((0 - london_today.weekday()) % 7 or 7))
    cases["monday"] = weekday
    for word, expected in cases.items():
        transport, seen = add_transport()
        assert main(["add", "T", "--due", word], transport=transport) == 0
        body = seen["body"]
        assert isinstance(body, dict)
        assert str(body["due_date"]).startswith(expected.isoformat()), word


def test_add_unknown_date_word_errors(logged_in: Path, capsys: pytest.CaptureFixture[str]) -> None:
    transport, seen = add_transport()

    assert main(["add", "Buy milk", "--due", "someday"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "someday" in err
    assert "today" in err
    assert "body" not in seen


def test_add_surfaces_api_validation_plainly(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    error = {"error": {"code": "invalid_schedule", "message": "A start date requires a due date"}}
    transport, _ = add_transport(created=error, create_status=422)

    assert main(["add", "Buy milk", "--start", "today"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "A start date requires a due date" in err
    assert "422" not in err


def test_add_expired_session_points_at_login(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    error = {"error": {"code": "unauthorized", "message": "A valid session is required"}}
    transport, _ = add_transport(created=error, create_status=401)

    assert main(["add", "Buy milk"], transport=transport) == 1

    assert "tuk login" in capsys.readouterr().err


def test_add_without_login_points_at_login(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("TUK_CONFIG_DIR", str(tmp_path / "empty"))
    transport, _ = add_transport()

    assert main(["add", "Buy milk"], transport=transport) == 1

    assert "tuk login" in capsys.readouterr().err
