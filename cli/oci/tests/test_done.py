import json
from pathlib import Path

import httpx
import pytest

from tuk.cli import main

DONE_BODY = {
    "id": 7,
    "title": "Water plants",
    "completed": True,
    "completed_at": "2026-10-05T10:00:00Z",
    "due_date": "2026-10-05T10:00:00Z",
    "is_all_day": False,
    "recurrence": None,
}

ADVANCED_BODY = {
    "id": 7,
    "title": "Water plants",
    "completed": False,
    "completed_at": None,
    "due_date": "2026-10-06T10:00:00Z",
    "is_all_day": False,
    "recurrence": "RRULE:FREQ=DAILY",
}

ENDED_BODY = {
    **ADVANCED_BODY,
    "completed": True,
    "completed_at": "2026-10-05T10:00:00Z",
}

REOPENED_BODY = {**DONE_BODY, "completed": False, "completed_at": None}


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


def patch_transport(
    body: object, status: int = 200, refreshed_cookie: str | None = None
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


def test_done_completes_plain_task(logged_in: Path, capsys: pytest.CaptureFixture[str]) -> None:
    transport, seen = patch_transport(DONE_BODY)

    assert main(["done", "7"], transport=transport) == 0

    assert seen["method"] == "PATCH"
    assert seen["path"] == "/api/v1/tasks/7"
    assert json.loads(seen["body"]) == {"completed": True}
    out = capsys.readouterr().out
    assert "7" in out
    assert "advanced" not in out.lower()


def test_done_recurring_advance_reports_next_occurrence(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = patch_transport(ADVANCED_BODY)

    assert main(["done", "7"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "advanced" in out.lower()
    assert "2026-10-06" in out


def test_done_advance_renders_the_date_in_the_local_zone(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A timed occurrence is shown in the resolved zone with that zone named —
    a raw UTC instant would read as a time the owner is not keeping."""
    monkeypatch.setenv("TUK_TIMEZONE", "Asia/Tokyo")
    transport, _ = patch_transport(ADVANCED_BODY)

    assert main(["done", "7"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "19:00" in out  # 10:00Z in Tokyo
    assert "Asia/Tokyo" in out
    assert "10:00:00Z" not in out


def test_done_advance_of_an_all_day_task_stays_date_only(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """All-day values are date-only by API convention, so they are not pushed
    through a zone — doing so would shift the day for a negative offset."""
    monkeypatch.setenv("TUK_TIMEZONE", "America/New_York")
    body = {**ADVANCED_BODY, "due_date": "2026-10-06T00:00:00Z", "is_all_day": True}
    transport, _ = patch_transport(body)

    assert main(["done", "7"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "2026-10-06" in out
    assert "2026-10-05" not in out


def test_done_advance_does_not_claim_a_zone_it_could_not_apply(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A date the client cannot parse passes through unconverted, so it is not
    labelled with a zone — a zone name on an unconverted value would be a lie."""
    body = {**ADVANCED_BODY, "due_date": "not-a-date"}
    transport, _ = patch_transport(body)

    assert main(["done", "7"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "not-a-date" in out
    assert "Europe/London" not in out


def test_done_open_task_without_recurrence_is_not_called_advanced(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Only a recurring Task can advance. A response that comes back open for
    any other reason is not an advance, and must not be announced as one."""
    body = {**DONE_BODY, "completed": False, "completed_at": None}
    transport, _ = patch_transport(body)

    assert main(["done", "7"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "advanced" not in out.lower()
    assert "7" in out


def test_done_invalid_timezone_fails_loudly(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("TUK_TIMEZONE", "Not/AZone")
    transport, _ = patch_transport(ADVANCED_BODY)

    assert main(["done", "7"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "Not/AZone" in err
    assert "TUK_TIMEZONE" in err


def test_done_ended_recurrence_reports_closed(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = patch_transport(ENDED_BODY)

    assert main(["done", "7"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "advanced" not in out.lower()


def test_reopen_returns_task_to_open(logged_in: Path, capsys: pytest.CaptureFixture[str]) -> None:
    transport, seen = patch_transport(REOPENED_BODY)

    assert main(["reopen", "7"], transport=transport) == 0

    assert seen["method"] == "PATCH"
    assert json.loads(seen["body"]) == {"completed": False}
    out = capsys.readouterr().out
    assert "7" in out


def test_reopen_recurring_task_says_reopened_not_advanced(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = patch_transport({**REOPENED_BODY, "recurrence": "RRULE:FREQ=DAILY"})

    assert main(["reopen", "7"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "reopened" in out.lower()
    assert "advanced" not in out.lower()


def test_done_unknown_id_reports_not_found(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    body = {"error": {"code": "not_found", "message": "Task 9 not found"}}
    transport, _ = patch_transport(body, 404)

    assert main(["done", "9"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "not found" in err.lower()
    assert "web app" not in err


def test_done_json_emits_body_unmodified(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = patch_transport(ADVANCED_BODY)

    assert main(["done", "--json", "7"], transport=transport) == 0

    assert json.loads(capsys.readouterr().out) == ADVANCED_BODY
