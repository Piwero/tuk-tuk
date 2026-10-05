"""Unit tests drive the real entrypoint with a mock transport.

`check add` grows a Task's checklist; `check tick` / `check untick` flip one
line. Every mutation returns the full parent Task, so output renders the
checklist from the response already returned — no second read. Ticking the
last open line completes the parent (the API's doing); the command says so.
"""

import json
from pathlib import Path

import httpx
import pytest

from tuk.cli import main

ADDED_BODY = {
    "id": 7,
    "title": "Pack bag",
    "completed": False,
    "check_items": [
        {"id": 1, "title": "Socks", "done": False, "sort_order": 0},
        {"id": 2, "title": "Charger", "done": False, "sort_order": 1024},
    ],
}

TICKED_BODY = {
    "id": 7,
    "title": "Pack bag",
    "completed": False,
    "check_items": [
        {"id": 1, "title": "Socks", "done": True, "sort_order": 0},
        {"id": 2, "title": "Charger", "done": False, "sort_order": 1024},
    ],
}

FINISHED_BODY = {
    "id": 7,
    "title": "Pack bag",
    "completed": True,
    "check_items": [
        {"id": 1, "title": "Socks", "done": True, "sort_order": 0},
        {"id": 2, "title": "Charger", "done": True, "sort_order": 1024},
    ],
}

ADVANCED_BODY = {
    "id": 7,
    "title": "Pack bag",
    "completed": False,
    "recurrence": "RRULE:FREQ=DAILY",
    "due_date": "2026-10-06T10:00:00Z",
    "check_items": [
        {"id": 1, "title": "Socks", "done": False, "sort_order": 0},
        {"id": 2, "title": "Charger", "done": False, "sort_order": 1024},
    ],
}

UNTICKED_BODY = {
    "id": 7,
    "title": "Pack bag",
    "completed": False,
    "check_items": [
        {"id": 1, "title": "Socks", "done": False, "sort_order": 0},
        {"id": 2, "title": "Charger", "done": False, "sort_order": 1024},
    ],
}

NOT_FOUND = {"error": {"code": "not_found", "message": "Task 9 not found"}}


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


def check_transport(
    body: object, status: int = 201, refreshed_cookie: str | None = None
) -> tuple[httpx.MockTransport, dict[str, str]]:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["path"] = request.url.path
        seen["body"] = request.content.decode()
        headers = (
            {"set-cookie": f"tuktuk_session={refreshed_cookie}; Path=/; HttpOnly"}
            if refreshed_cookie
            else {}
        )
        return httpx.Response(status, headers=headers, json=body)

    return httpx.MockTransport(handler), seen


def test_check_add_posts_title_and_shows_checklist(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = check_transport(ADDED_BODY)

    assert main(["check", "add", "7", "Charger"], transport=transport) == 0

    assert seen["method"] == "POST"
    assert seen["path"] == "/api/v1/tasks/7/check-items"
    assert json.loads(seen["body"]) == {"title": "Charger"}
    out = capsys.readouterr().out
    assert "7" in out
    assert "Charger" in out
    assert "[ ]" in out


def test_check_tick_patches_done_true_and_shows_state(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = check_transport(TICKED_BODY, status=200)

    assert main(["check", "tick", "7", "1"], transport=transport) == 0

    assert seen["method"] == "PATCH"
    assert seen["path"] == "/api/v1/tasks/7/check-items/1"
    assert json.loads(seen["body"]) == {"done": True}
    out = capsys.readouterr().out
    assert "[x]" in out
    assert "Socks" in out
    assert "[ ]" in out
    assert "completed" not in out.lower()


def test_check_tick_last_open_item_reports_parent_completed(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = check_transport(FINISHED_BODY, status=200)

    assert main(["check", "tick", "7", "2"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "7" in out
    assert "completed" in out.lower()


def test_check_tick_advancing_recurrence_reports_next_occurrence(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = check_transport(ADVANCED_BODY, status=200)

    assert main(["check", "tick", "7", "2"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "advanced" in out.lower()
    assert "2026-10-06" in out


def test_check_tick_on_already_completed_task_reports_plain_tick(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    body = {
        **FINISHED_BODY,
        "check_items": [TICKED_BODY["check_items"][0], UNTICKED_BODY["check_items"][1]],
    }
    transport, _ = check_transport(body, status=200)

    assert main(["check", "tick", "7", "1"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "ticked" in out.lower()
    assert "completed" not in out.lower()


def test_check_untick_patches_done_false(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = check_transport(UNTICKED_BODY, status=200)

    assert main(["check", "untick", "7", "1"], transport=transport) == 0

    assert seen["method"] == "PATCH"
    assert seen["path"] == "/api/v1/tasks/7/check-items/1"
    assert json.loads(seen["body"]) == {"done": False}
    out = capsys.readouterr().out
    assert "[ ]" in out
    assert "completed" not in out.lower()


def test_check_add_unknown_task_reports_not_found(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = check_transport(NOT_FOUND, status=404)

    assert main(["check", "add", "9", "Socks"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "not found" in err.lower()
    assert "web app" not in err


def test_check_tick_foreign_parents_item_reports_not_found(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    body = {"error": {"code": "not_found", "message": "Check item 1 not found on task 8"}}
    transport, _ = check_transport(body, status=404)

    assert main(["check", "tick", "8", "1"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "not found" in err.lower()


def test_check_json_emits_body_unmodified(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = check_transport(TICKED_BODY, status=200)

    assert main(["check", "--json", "tick", "7", "1"], transport=transport) == 0

    assert json.loads(capsys.readouterr().out) == TICKED_BODY


@pytest.mark.parametrize(
    "argv",
    [
        ["check", "add", "7", "Socks", "--json"],
        ["check", "tick", "7", "1", "--json"],
        ["check", "untick", "7", "1", "--json"],
    ],
    ids=["add", "tick", "untick"],
)
def test_check_json_accepted_after_the_subcommand(
    logged_in: Path, capsys: pytest.CaptureFixture[str], argv: list[str]
) -> None:
    """`--json` reads naturally at the end of the line, which is also where
    the README puts it. It used to sit only on the `check` parser, so the
    documented position was the one argparse rejected."""
    status = 201 if argv[1] == "add" else 200
    transport, _ = check_transport(TICKED_BODY, status=status)

    assert main(argv, transport=transport) == 0

    assert json.loads(capsys.readouterr().out) == TICKED_BODY


def test_check_tick_advance_renders_the_date_in_the_local_zone(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """The occurrence an advancing tick moved to is shown in the resolved zone
    with that zone named, like every other date the client renders."""
    monkeypatch.setenv("TUK_TIMEZONE", "Asia/Tokyo")
    transport, _ = check_transport(ADVANCED_BODY, status=200)

    assert main(["check", "tick", "7", "2"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "19:00" in out  # 10:00Z in Tokyo
    assert "Asia/Tokyo" in out
    assert "10:00:00Z" not in out


def test_check_tick_invalid_timezone_fails_loudly(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("TUK_TIMEZONE", "Not/AZone")
    transport, _ = check_transport(TICKED_BODY, status=200)

    assert main(["check", "tick", "7", "1"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "Not/AZone" in err
    assert "TUK_TIMEZONE" in err
