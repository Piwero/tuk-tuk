"""Unit tests drive the real entrypoint with a mock transport.

One handler serves the routes `edit` touches: the Task GET for the
before-state (only on list moves and date clears), the Lists and Tags
collections for name resolution, and the Task PATCH. Tests assert the
emitted request body, the sweep/drop messages, and the rendered output.
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

BEFORE_BODY = {
    "id": 7,
    "title": "Old title",
    "completed": False,
    "description": "",
    "priority": "none",
    "list_id": 1,
    "section_id": 3,
    "start_date": None,
    "due_date": "2026-10-05T00:00:00Z",
    "is_all_day": True,
    "time_zone": None,
    "reminders": ["-PT30M", "-P1D"],
    "recurrence": "RRULE:FREQ=DAILY",
    "tags": [],
    "check_items": [],
}

UPDATED_BODY = {**BEFORE_BODY, "title": "New title"}

ZONE = ZoneInfo("Europe/London")  # pinned by the logged_in fixture's TUK_TIMEZONE


def london_today() -> str:
    return datetime.now(ZONE).date().isoformat()


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


def edit_transport(
    before: object = BEFORE_BODY,
    before_status: int = 200,
    updated: object = UPDATED_BODY,
    updated_status: int = 200,
    lists: object = LISTS_BODY,
    tags: object = TAGS_BODY,
) -> tuple[httpx.MockTransport, dict[str, object]]:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["cookie"] = request.headers.get("cookie", "")
        if request.url.path == "/api/v1/tasks/7" and request.method == "GET":
            seen["got"] = True
            return httpx.Response(before_status, json=before)
        if request.url.path == "/api/v1/tasks/7" and request.method == "PATCH":
            seen["body"] = json.loads(request.content.decode())
            return httpx.Response(updated_status, json=updated)
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


def test_edit_title_patches_only_title(logged_in: Path, capsys: pytest.CaptureFixture[str]) -> None:
    transport, seen = edit_transport()

    assert main(["edit", "7", "--title", "New title"], transport=transport) == 0

    assert seen["body"] == {"title": "New title"}
    # No before-read for a plain field edit — one round trip, not two.
    assert "got" not in seen
    out = capsys.readouterr().out
    assert "7" in out


def test_edit_maps_full_flag_set(logged_in: Path) -> None:
    transport, seen = edit_transport()

    assert (
        main(
            [
                "edit",
                "7",
                "--title",
                "New",
                "--description",
                "Details",
                "--priority",
                "high",
                "--due",
                "tomorrow",
                "--start",
                "today",
                "--all-day",
                "--list",
                "Groceries",
                "--tag",
                "home",
            ],
            transport=transport,
        )
        == 0
    )

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["title"] == "New"
    assert body["description"] == "Details"
    assert body["priority"] == "high"
    assert body["is_all_day"] is True
    assert body["list_id"] == 2
    assert body["tag_ids"] == [5]
    assert body["time_zone"] == "Europe/London"
    assert str(body["due_date"]).startswith(
        (datetime.now(ZONE).date() + timedelta(days=1)).isoformat()
    )
    assert str(body["start_date"]).startswith(london_today())


def test_edit_no_all_day_clears_the_flag(logged_in: Path) -> None:
    transport, seen = edit_transport()

    assert main(["edit", "7", "--no-all-day"], transport=transport) == 0

    assert seen["body"] == {"is_all_day": False}


def test_edit_clear_date_nulls_the_whole_schedule(logged_in: Path) -> None:
    """The whole schedule, not just the due: a start without a due is the
    API's 422, an all-day task requires a due, and the zone belongs to a date
    it no longer has."""
    transport, seen = edit_transport()

    assert main(["edit", "7", "--clear-date"], transport=transport) == 0

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["due_date"] is None
    assert body["start_date"] is None
    assert body["is_all_day"] is False
    assert body["time_zone"] is None


def test_edit_clear_date_reports_swept_reminders_and_recurrence(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    swept = {
        **BEFORE_BODY,
        "due_date": None,
        "start_date": None,
        "reminders": [],
        "recurrence": None,
    }
    transport, _ = edit_transport(updated=swept)

    assert main(["edit", "7", "--clear-date"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "2 reminders" in out
    assert "recurrence" in out


def test_edit_clear_date_silent_when_nothing_to_sweep(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    bare = {**BEFORE_BODY, "reminders": [], "recurrence": None}
    cleared = {**bare, "due_date": None, "start_date": None}
    transport, _ = edit_transport(before=bare, updated=cleared)

    assert main(["edit", "7", "--clear-date"], transport=transport) == 0

    out = capsys.readouterr().out
    assert out.strip().count("\n") == 0
    assert "reminder" not in out.lower()
    assert "recurrence" not in out.lower()


def test_edit_move_list_reports_dropped_section(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    moved = {**BEFORE_BODY, "list_id": 2, "section_id": None}
    transport, seen = edit_transport(updated=moved)

    assert main(["edit", "7", "--list", "Groceries"], transport=transport) == 0

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["list_id"] == 2
    assert "section" in capsys.readouterr().out.lower()


def test_edit_move_list_silent_without_section(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    unsectioned = {**BEFORE_BODY, "section_id": None}
    moved = {**unsectioned, "list_id": 2}
    transport, _ = edit_transport(before=unsectioned, updated=moved)

    assert main(["edit", "7", "--list", "Groceries"], transport=transport) == 0

    assert "section" not in capsys.readouterr().out.lower()


def test_edit_tags_replace_wholesale(logged_in: Path) -> None:
    transport, seen = edit_transport()

    assert main(["edit", "7", "--tag", "home", "--tag", "Urgent"], transport=transport) == 0

    body = seen["body"]
    assert isinstance(body, dict)
    assert body["tag_ids"] == [5, 6]


def test_edit_clear_tags_sends_an_empty_set(logged_in: Path) -> None:
    """Replacement has to include replacing with nothing. `--tag` appends, so
    no number of `--tag` flags can ever express the empty set."""
    transport, seen = edit_transport()

    assert main(["edit", "7", "--clear-tags"], transport=transport) == 0

    assert seen["body"] == {"tag_ids": []}
    # Nothing to resolve, so the Tags collection is never read.
    assert "tags_hit" not in seen


def test_edit_clear_tags_with_tag_rejected_locally(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = edit_transport()

    assert main(["edit", "7", "--clear-tags", "--tag", "home"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "--clear-tags" in err
    assert "--tag" in err
    assert "body" not in seen


def test_edit_help_says_tags_replace(logged_in: Path, capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        main(["edit", "--help"])

    assert exc.value.code == 0
    assert "replac" in capsys.readouterr().out.lower()


def test_edit_unknown_list_names_candidates(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = edit_transport()

    assert main(["edit", "7", "--list", "Nope"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "Nope" in err
    assert "Groceries" in err
    assert "Inbox" in err
    assert "body" not in seen


def test_edit_unknown_tag_errors_without_patching(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = edit_transport()

    assert main(["edit", "7", "--tag", "Nope"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "Nope" in err
    assert "home" in err
    assert "Urgent" in err
    assert "body" not in seen


def test_edit_bad_date_word_errors_without_patching(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = edit_transport()

    assert main(["edit", "7", "--due", "someday"], transport=transport) == 1

    assert "someday" in capsys.readouterr().err
    assert "body" not in seen


def test_edit_clear_date_with_due_rejected_locally(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = edit_transport()

    assert main(["edit", "7", "--clear-date", "--due", "tomorrow"], transport=transport) == 1

    assert "clear-date" in capsys.readouterr().err.lower()
    assert "body" not in seen
    assert "got" not in seen


@pytest.mark.parametrize("flag", ["--start", "--all-day"])
def test_edit_clear_date_with_date_flags_rejected_locally(
    logged_in: Path, capsys: pytest.CaptureFixture[str], flag: str
) -> None:
    value = [] if flag == "--all-day" else ["today"]
    transport, seen = edit_transport()

    assert main(["edit", "7", "--clear-date", flag, *value], transport=transport) == 1

    assert "clear-date" in capsys.readouterr().err.lower()
    assert "body" not in seen
    assert "got" not in seen


def test_edit_surfaces_api_validation_plainly(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    error = {"error": {"code": "invalid_schedule", "message": "A start date requires a due date"}}
    transport, _ = edit_transport(updated=error, updated_status=422)

    assert main(["edit", "7", "--start", "today"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "A start date requires a due date" in err
    assert "422" not in err


def test_edit_unknown_id_reports_not_found(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    body = {"error": {"code": "not_found", "message": "Task 7 not found"}}
    transport, _ = edit_transport(before=body, before_status=404)

    assert main(["edit", "7", "--clear-date"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "not found" in err.lower()


def test_edit_unknown_id_without_before_read_reports_not_found(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    body = {"error": {"code": "not_found", "message": "Task 7 not found"}}
    transport, _ = edit_transport(updated=body, updated_status=404)

    assert main(["edit", "7", "--title", "New"], transport=transport) == 1

    assert "not found" in capsys.readouterr().err.lower()


def test_edit_json_emits_body_unmodified(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    swept = {
        **BEFORE_BODY,
        "due_date": None,
        "start_date": None,
        "reminders": [],
        "recurrence": None,
    }
    transport, _ = edit_transport(updated=swept)

    assert main(["edit", "--json", "7", "--clear-date"], transport=transport) == 0

    # Pure body — the sweep notes stay out of the pipe.
    assert json.loads(capsys.readouterr().out) == swept


def test_edit_no_flags_reports_nothing_to_change(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = edit_transport()

    assert main(["edit", "7"], transport=transport) == 1

    assert "othing to change" in capsys.readouterr().err
    assert "body" not in seen
    assert "got" not in seen


def test_edit_expired_session_points_at_login(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    error = {"error": {"code": "unauthorized", "message": "A valid session is required"}}
    transport, _ = edit_transport(updated=error, updated_status=401)

    assert main(["edit", "7", "--title", "New"], transport=transport) == 1

    assert "tuk login" in capsys.readouterr().err


def test_edit_without_login_points_at_login(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("TUK_CONFIG_DIR", str(tmp_path / "empty"))
    transport, _ = edit_transport()

    assert main(["edit", "7", "--title", "New"], transport=transport) == 1

    assert "tuk login" in capsys.readouterr().err
