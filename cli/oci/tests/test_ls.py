"""Unit tests drive the real entrypoint with a mock transport.

The only seam is the HTTP transport, taken at client construction and
passed through `main`. Tests assert both the emitted query parameters
and the rendered output. TUK_CONFIG_DIR redirects file I/O at a
temporary path; TUK_TIMEZONE pins the resolved zone.
"""

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from tuk.cli import main

PAGE_BODY = {
    "items": [
        {
            "id": 7,
            "title": "Water plants",
            "due_date": "2026-10-04T00:00:00Z",
            "is_all_day": True,
            "priority": "high",
        },
        {
            "id": 9,
            "title": "Overdue bill",
            "due_date": "2026-09-01T00:00:00Z",
            "is_all_day": True,
            "priority": "medium",
        },
    ],
    "total": 2,
    "limit": 50,
    "offset": 0,
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


def ls_transport(
    body: object = PAGE_BODY, status: int = 200
) -> tuple[httpx.MockTransport, dict[str, str]]:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["cookie"] = request.headers.get("cookie", "")
        seen["path"] = request.url.path
        for key, value in request.url.params.items():
            seen[f"param:{key}"] = value
        return httpx.Response(status, json=body)

    return httpx.MockTransport(handler), seen


def test_ls_defaults_to_today_view(logged_in: Path, capsys: pytest.CaptureFixture[str]) -> None:
    transport, seen = ls_transport()

    assert main(["ls"], transport=transport) == 0

    expected_day = datetime.now(ZoneInfo("Europe/London")).date().isoformat()
    assert seen["path"] == "/api/v1/tasks"
    assert seen["param:view"] == "today"
    assert seen["param:today"] == expected_day
    assert "sess" in seen["cookie"]

    out = capsys.readouterr().out
    assert "7" in out
    assert "Water plants" in out
    assert "2026-10-04" in out
    assert "high" in out
    assert "ID" in out
    assert "PRIORITY" in out
    assert "Europe/London" in out


def test_ls_renders_overdue_tasks_without_filtering(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = ls_transport()

    assert main(["ls"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "Overdue bill" in out


def test_ls_week_selects_next_seven_days_view(logged_in: Path) -> None:
    transport, seen = ls_transport()

    assert main(["ls", "--week"], transport=transport) == 0

    assert seen["param:view"] == "next7"
    assert "param:today" in seen


def test_ls_all_selects_all_open_view_without_day(logged_in: Path) -> None:
    transport, seen = ls_transport()

    assert main(["ls", "--all"], transport=transport) == 0

    assert seen["param:view"] == "all"
    assert "param:today" not in seen


def test_ls_json_emits_page_body_unmodified(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = ls_transport()

    assert main(["ls", "--json"], transport=transport) == 0

    assert json.loads(capsys.readouterr().out) == PAGE_BODY


def test_ls_limit_offset_map_onto_api_params(logged_in: Path) -> None:
    transport, seen = ls_transport()

    assert main(["ls", "--limit", "10", "--offset", "20"], transport=transport) == 0

    assert seen["param:limit"] == "10"
    assert seen["param:offset"] == "20"


def test_ls_says_when_more_results_exist(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    body = dict(PAGE_BODY, total=3, limit=2, offset=0)
    transport, _ = ls_transport(body)

    assert main(["ls", "--limit", "2"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "1 more" in out or "more result" in out


def test_ls_quiet_when_page_is_whole_set(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = ls_transport()

    assert main(["ls"], transport=transport) == 0

    assert "more" not in capsys.readouterr().out.lower()


def test_ls_all_day_date_ignores_negative_offset(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = ls_transport()
    monkeypatch.setenv("TUK_TIMEZONE", "America/New_York")

    assert main(["ls"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "2026-10-04" in out
    assert "2026-10-03" not in out


def test_ls_all_json_skips_timezone_resolution(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = ls_transport()
    monkeypatch.setenv("TUK_TIMEZONE", "Not/AZone")

    assert main(["ls", "--all", "--json"], transport=transport) == 0

    assert json.loads(capsys.readouterr().out) == PAGE_BODY
    assert seen["param:view"] == "all"
    assert "param:today" not in seen


def test_ls_timezone_override_changes_local_day(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    transport, seen = ls_transport()
    monkeypatch.setenv("TUK_TIMEZONE", "Pacific/Kiritimati")

    assert main(["ls"], transport=transport) == 0

    expected = datetime.now(ZoneInfo("Pacific/Kiritimati")).date().isoformat()
    assert seen["param:today"] == expected


def test_ls_invalid_timezone_fails_loudly(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = ls_transport()
    monkeypatch.setenv("TUK_TIMEZONE", "Not/AZone")

    assert main(["ls"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "Not/AZone" in err
    assert "TUK_TIMEZONE" in err


def test_ls_expired_session_points_at_login(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    body = {"error": {"code": "unauthorized", "message": "A valid session is required"}}
    transport, _ = ls_transport(body, 401)

    assert main(["ls"], transport=transport) == 1

    assert "tuk login" in capsys.readouterr().err


def test_ls_without_login_points_at_login(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("TUK_CONFIG_DIR", str(tmp_path / "empty"))
    transport, _ = ls_transport()

    assert main(["ls"], transport=transport) == 1

    assert "tuk login" in capsys.readouterr().err
