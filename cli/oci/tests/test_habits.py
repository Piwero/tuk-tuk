"""Unit tests drive the real entrypoint with a mock transport.

`habits` lists the Habits due on the local day; `check` records today's
check-in by default (or `--day` for a past day, idempotent by construction);
`undo` removes a day's check-in.
"""

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from tuk.cli import main

HABITS_PAGE = {
    "items": [
        {"id": 3, "name": "Drink water", "type": "boolean", "frequency": "daily"},
        {"id": 4, "name": "Run 5k", "type": "numeric", "frequency": "daily"},
    ],
    "total": 2,
    "limit": 200,
    "offset": 0,
}

CHECK_IN_BODY = {"id": 11, "habit_id": 3, "date": "2026-10-04", "value": 1.0}


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


def habits_transport(
    habits: object = HABITS_PAGE,
    habit_status: int = 200,
) -> tuple[httpx.MockTransport, dict[str, object]]:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["path"] = request.url.path
        for key, value in request.url.params.items():
            seen[f"param:{key}"] = value
        if request.method in ("PUT", "POST"):
            seen["body"] = json.loads(request.content.decode())
        if request.url.path == "/api/v1/habits":
            return httpx.Response(habit_status, json=habits)
        if request.url.path.startswith("/api/v1/habits/") and "/check-ins/" in request.url.path:
            if request.method == "PUT":
                body = seen.get("body")
                assert isinstance(body, dict)
                day = request.url.path.rsplit("/", 1)[1]
                return httpx.Response(
                    200,
                    json={**CHECK_IN_BODY, "date": day, "value": body.get("value", 1)},
                )
            return httpx.Response(204)
        raise AssertionError(f"unexpected {request.method} {request.url.path}")

    return httpx.MockTransport(handler), seen


def test_habits_lists_due_on_local_day(logged_in: Path, capsys: pytest.CaptureFixture[str]) -> None:
    transport, seen = habits_transport()
    expected = datetime.now(ZoneInfo("Europe/London")).date().isoformat()

    assert main(["habits"], transport=transport) == 0

    assert seen["path"] == "/api/v1/habits"
    assert seen["param:due"] == expected
    out = capsys.readouterr().out
    assert "Drink water" in out
    assert "Run 5k" in out
    assert "Europe/London" in out


def test_habits_json_emits_page_body(logged_in: Path, capsys: pytest.CaptureFixture[str]) -> None:
    transport, _ = habits_transport()

    assert main(["habits", "--json"], transport=transport) == 0

    assert json.loads(capsys.readouterr().out) == HABITS_PAGE


def test_check_records_today_by_default(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = habits_transport()
    expected = datetime.now(ZoneInfo("Europe/London")).date().isoformat()

    assert main(["habits", "check", "3"], transport=transport) == 0

    assert seen["method"] == "PUT"
    assert seen["path"] == f"/api/v1/habits/3/check-ins/{expected}"
    assert seen["body"] == {"value": 1}
    assert "3" in capsys.readouterr().out


def test_check_accepts_explicit_day_and_value(logged_in: Path) -> None:
    transport, seen = habits_transport()

    assert (
        main(
            ["habits", "check", "4", "--day", "2026-10-01", "--value", "5"],
            transport=transport,
        )
        == 0
    )

    assert seen["path"] == "/api/v1/habits/4/check-ins/2026-10-01"
    assert seen["body"] == {"value": 5.0}


def test_repeating_a_check_in_is_harmless(logged_in: Path) -> None:
    """The check-in endpoint is day-keyed and idempotent: calling `check`
    twice for the same day sends the same upsert both times rather than
    accumulating, and both calls succeed."""
    calls: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/habits/3/check-ins/2026-10-01":
            body = json.loads(request.content.decode())
            calls.append(body)
            return httpx.Response(200, json={**CHECK_IN_BODY, "date": "2026-10-01"})
        raise AssertionError(f"unexpected {request.method} {request.url.path}")

    transport = httpx.MockTransport(handler)

    assert main(["habits", "check", "3", "--day", "2026-10-01"], transport=transport) == 0
    assert main(["habits", "check", "3", "--day", "2026-10-01"], transport=transport) == 0

    assert calls == [{"value": 1}, {"value": 1}]


def test_check_rejects_malformed_day(logged_in: Path, capsys: pytest.CaptureFixture[str]) -> None:
    transport, _ = habits_transport()

    assert main(["habits", "check", "3", "--day", "not-a-day"], transport=transport) == 1

    assert "not-a-day" in capsys.readouterr().err


def test_undo_removes_day_check_in(logged_in: Path, capsys: pytest.CaptureFixture[str]) -> None:
    transport, seen = habits_transport()
    expected = datetime.now(ZoneInfo("Europe/London")).date().isoformat()

    assert main(["habits", "undo", "3"], transport=transport) == 0

    assert seen["method"] == "DELETE"
    assert seen["path"] == f"/api/v1/habits/3/check-ins/{expected}"
    assert "3" in capsys.readouterr().out


def test_undo_missing_check_in_surfaces_api_message(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            404,
            json={"error": {"code": "not_found", "message": "No check-in on 2026-10-04"}},
        )

    transport = httpx.MockTransport(handler)

    assert main(["habits", "undo", "3"], transport=transport) == 1

    assert "No check-in" in capsys.readouterr().err
