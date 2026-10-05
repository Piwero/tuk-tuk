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


def test_ls_all_json_emits_page_body_without_a_local_day(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """`--json` passes the API's page body through untouched, so it carries no
    zone key of its own — and `--all` is not judged against a local day, so no
    `today` parameter is sent either."""
    transport, seen = ls_transport()

    assert main(["ls", "--all", "--json"], transport=transport) == 0

    assert json.loads(capsys.readouterr().out) == PAGE_BODY
    assert seen["param:view"] == "all"
    assert "param:today" not in seen


@pytest.mark.parametrize(
    "argv",
    [
        ["ls"],
        ["ls", "--week"],
        ["ls", "--all"],
        ["ls", "--json"],
        ["ls", "--all", "--json"],
    ],
    ids=["today", "week", "all", "json", "all-json"],
)
def test_ls_invalid_timezone_fails_loudly_for_every_combination(
    logged_in: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    argv: list[str],
) -> None:
    """A misconfigured zone is visible rather than silently shifting the day —
    so no flag combination may quietly skip resolving it."""
    transport, _ = ls_transport()
    monkeypatch.setenv("TUK_TIMEZONE", "Not/AZone")

    assert main(argv, transport=transport) == 1

    err = capsys.readouterr().err
    assert "Not/AZone" in err
    assert "TUK_TIMEZONE" in err


def test_ls_timezone_override_changes_local_day(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    transport, seen = ls_transport()
    monkeypatch.setenv("TUK_TIMEZONE", "Pacific/Kiritimati")

    assert main(["ls"], transport=transport) == 0

    expected = datetime.now(ZoneInfo("Pacific/Kiritimati")).date().isoformat()
    assert seen["param:today"] == expected


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

EMPTY_BODY = {"items": [], "total": 0, "limit": 50, "offset": 0}


def filter_transport(
    tasks_body: object = PAGE_BODY,
) -> tuple[httpx.MockTransport, dict[str, object]]:
    seen: dict[str, object] = {"paths": []}

    def handler(request: httpx.Request) -> httpx.Response:
        paths = seen["paths"]
        assert isinstance(paths, list)
        paths.append(request.url.path)
        if request.url.path == "/api/v1/lists":
            return httpx.Response(200, json=LISTS_BODY)
        if request.url.path == "/api/v1/tags":
            return httpx.Response(200, json=TAGS_BODY)
        if request.url.path == "/api/v1/tasks":
            for key, value in request.url.params.items():
                seen[f"param:{key}"] = value
            return httpx.Response(200, json=tasks_body)
        raise AssertionError(f"unexpected {request.method} {request.url.path}")

    return httpx.MockTransport(handler), seen


def tasks_hit(seen: dict[str, object]) -> bool:
    paths = seen["paths"]
    assert isinstance(paths, list)
    return "/api/v1/tasks" in paths


def test_ls_list_name_maps_to_list_id(logged_in: Path) -> None:
    transport, seen = filter_transport()

    assert main(["ls", "--list", "Groceries"], transport=transport) == 0

    assert seen["param:list_id"] == "2"
    assert seen["param:view"] == "today"
    assert "param:today" in seen


def test_ls_list_name_matches_case_insensitively(logged_in: Path) -> None:
    transport, seen = filter_transport()

    assert main(["ls", "--list", "groceries"], transport=transport) == 0

    assert seen["param:list_id"] == "2"


def test_ls_unknown_list_names_the_available_ones(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = filter_transport()

    assert main(["ls", "--list", "Nope"], transport=transport) == 1

    assert not tasks_hit(seen)
    err = capsys.readouterr().err
    assert "Groceries" in err
    assert "Inbox" in err


def test_ls_tag_name_maps_to_tag_id(logged_in: Path) -> None:
    transport, seen = filter_transport()

    assert main(["ls", "--tag", "home"], transport=transport) == 0

    assert seen["param:tag_id"] == "5"
    assert seen["param:view"] == "today"


def test_ls_unknown_tag_names_the_available_ones(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = filter_transport()

    assert main(["ls", "--tag", "Nope"], transport=transport) == 1

    assert not tasks_hit(seen)
    err = capsys.readouterr().err
    assert "home" in err
    assert "Urgent" in err


def test_ls_priority_forwards_untouched(logged_in: Path) -> None:
    transport, seen = filter_transport()

    assert main(["ls", "--priority", "high"], transport=transport) == 0

    assert seen["param:priority"] == "high"
    assert seen["param:view"] == "today"


def test_ls_list_tag_priority_combine(logged_in: Path) -> None:
    transport, seen = filter_transport()

    assert (
        main(
            ["ls", "--list", "Groceries", "--tag", "home", "--priority", "high"],
            transport=transport,
        )
        == 0
    )

    assert seen["param:list_id"] == "2"
    assert seen["param:tag_id"] == "5"
    assert seen["param:priority"] == "high"
    assert seen["param:view"] == "today"


def test_ls_completed_drops_the_default_view(logged_in: Path) -> None:
    transport, seen = filter_transport()

    assert main(["ls", "--completed"], transport=transport) == 0

    assert seen["param:completed"] == "true"
    assert "param:view" not in seen
    assert "param:today" not in seen


def test_ls_unscheduled_lists_tasks_with_no_date(logged_in: Path) -> None:
    transport, seen = filter_transport()

    assert main(["ls", "--unscheduled"], transport=transport) == 0

    assert seen["param:scheduled"] == "false"
    assert "param:view" not in seen
    assert "param:today" not in seen


def test_ls_search_passes_the_query_through(logged_in: Path) -> None:
    transport, seen = filter_transport()

    assert main(["ls", "--search", "passport"], transport=transport) == 0

    assert seen["param:search"] == "passport"
    assert "param:view" not in seen


def test_ls_empty_search_still_sends_the_query(logged_in: Path) -> None:
    transport, seen = filter_transport(EMPTY_BODY)

    assert main(["ls", "--search", ""], transport=transport) == 0

    assert seen["param:search"] == ""
    assert tasks_hit(seen)


@pytest.mark.parametrize("view", ["--week", "--all"])
def test_ls_rejects_view_with_completed(
    logged_in: Path, capsys: pytest.CaptureFixture[str], view: str
) -> None:
    """A Smart List view overrides the completion filter server-side
    (`if view is not None: completed = False`), so forwarding the pair would
    answer with *open* tasks under a flag that asked for completed ones. A
    wrong answer is worse than a refusal, so the pair is named locally."""
    transport, seen = filter_transport()

    assert main(["ls", view, "--completed"], transport=transport) == 1

    assert not tasks_hit(seen)
    err = capsys.readouterr().err
    assert view in err
    assert "--completed" in err


def test_ls_completed_combines_with_search(logged_in: Path) -> None:
    transport, seen = filter_transport()

    assert main(["ls", "--completed", "--search", "report"], transport=transport) == 0

    assert seen["param:completed"] == "true"
    assert seen["param:search"] == "report"


def test_ls_completed_combines_with_unscheduled(logged_in: Path) -> None:
    transport, seen = filter_transport()

    assert main(["ls", "--completed", "--unscheduled"], transport=transport) == 0

    assert seen["param:completed"] == "true"
    assert seen["param:scheduled"] == "false"


def test_ls_explicit_view_combines_with_narrowing_filters(logged_in: Path) -> None:
    transport, seen = filter_transport()

    assert (
        main(["ls", "--all", "--list", "Groceries", "--priority", "high"], transport=transport) == 0
    )

    assert seen["param:view"] == "all"
    assert "param:today" not in seen
    assert seen["param:list_id"] == "2"
    assert seen["param:priority"] == "high"


def test_ls_week_combines_with_narrowing_filters(logged_in: Path) -> None:
    transport, seen = filter_transport()

    assert main(["ls", "--week", "--tag", "home"], transport=transport) == 0

    assert seen["param:view"] == "next7"
    assert "param:today" in seen
    assert seen["param:tag_id"] == "5"


def test_ls_filters_work_with_paging_and_json(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, seen = filter_transport()

    assert (
        main(
            ["ls", "--list", "Groceries", "--limit", "10", "--offset", "20", "--json"],
            transport=transport,
        )
        == 0
    )

    assert seen["param:list_id"] == "2"
    assert seen["param:limit"] == "10"
    assert seen["param:offset"] == "20"
    assert json.loads(capsys.readouterr().out) == PAGE_BODY


@pytest.mark.parametrize(
    ("argv", "first", "second"),
    [
        (["ls", "--week", "--unscheduled"], "--week", "--unscheduled"),
        (["ls", "--all", "--unscheduled"], "--all", "--unscheduled"),
        (["ls", "--week", "--search", "x"], "--week", "--search"),
        (["ls", "--all", "--search", "x"], "--all", "--search"),
        (["ls", "--unscheduled", "--search", "x"], "--unscheduled", "--search"),
    ],
    ids=[
        "week-unscheduled",
        "all-unscheduled",
        "week-search",
        "all-search",
        "unscheduled-search",
    ],
)
def test_ls_rejects_conflicting_filters_locally(
    logged_in: Path,
    capsys: pytest.CaptureFixture[str],
    argv: list[str],
    first: str,
    second: str,
) -> None:
    transport, seen = filter_transport()

    assert main(argv, transport=transport) == 1

    assert not tasks_hit(seen)
    err = capsys.readouterr().err
    assert first in err
    assert second in err


def test_ls_completed_still_resolves_the_zone(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = filter_transport()
    monkeypatch.setenv("TUK_TIMEZONE", "Not/AZone")

    assert main(["ls", "--completed"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "Not/AZone" in err
    assert "TUK_TIMEZONE" in err
