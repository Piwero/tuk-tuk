import json
from pathlib import Path

import httpx
import pytest

from tuk.cli import main

TASK_BODY = {
    "id": 7,
    "title": "Water plants",
    "completed": False,
    "check_items": [{"id": 1, "title": "Pot", "done": False, "sort_order": 0}],
    "tags": [{"id": 2, "name": "home", "color": None}],
}


@pytest.fixture
def logged_in(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    target = tmp_path / "config"
    monkeypatch.setenv("TUK_CONFIG_DIR", str(target))
    target.mkdir(parents=True, exist_ok=True)
    (target / "tuk").mkdir(exist_ok=True)
    (target / "tuk" / "config.json").write_text(json.dumps({"base_url": "http://x"}))
    (target / "tuk" / "session.json").write_text(json.dumps({"session_cookie": "sess"}))
    return target


def show_transport(
    body: object = TASK_BODY, status: int = 200, refreshed_cookie: str | None = None
) -> tuple[httpx.MockTransport, dict[str, str]]:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["cookie"] = request.headers.get("cookie", "")
        seen["path"] = request.url.path
        headers = (
            {"set-cookie": f"tuktuk_session={refreshed_cookie}; Path=/; HttpOnly"}
            if refreshed_cookie
            else {}
        )
        return httpx.Response(status, headers=headers, json=body)

    return httpx.MockTransport(handler), seen


def test_show_prints_task_including_id(logged_in: Path, capsys: pytest.CaptureFixture[str]) -> None:
    transport, seen = show_transport()

    assert main(["show", "7"], transport=transport) == 0

    out = capsys.readouterr().out
    assert "7" in out
    assert "Water plants" in out
    assert "home" in out
    assert "sess" in seen["cookie"]
    assert seen["path"] == "/api/v1/tasks/7"


def test_show_json_emits_body_unmodified(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = show_transport()
    assert main(["show", "--json", "7"], transport=transport) == 0

    assert json.loads(capsys.readouterr().out) == TASK_BODY


def test_show_expired_session_points_at_login(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    body = {"error": {"code": "unauthorized", "message": "A valid session is required"}}
    transport, _ = show_transport(body, 401)

    assert main(["show", "7"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "tuk login" in err
    assert "401" not in err


def test_show_without_login_points_at_login(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("TUK_CONFIG_DIR", str(tmp_path / "empty"))
    transport, _ = show_transport()

    assert main(["show", "7"], transport=transport) == 1

    assert "tuk login" in capsys.readouterr().err


def test_show_missing_task_says_not_found(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """`not_found` on a gated read means the Task is gone, and must not be
    reinterpreted as first-run setup — the login path accepts that code for
    setup only because it is a public path answering for itself."""
    body = {"error": {"code": "not_found", "message": "Task 9 not found"}}
    transport, _ = show_transport(body, 404)

    assert main(["show", "9"], transport=transport) == 1

    err = capsys.readouterr().err
    assert "not found" in err.lower()
    assert "web app" not in err


def test_show_caches_reissued_session_cookie(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    transport, _ = show_transport(refreshed_cookie="fresh")

    assert main(["show", "7"], transport=transport) == 0

    assert json.loads((logged_in / "tuk" / "session.json").read_text()) == {
        "session_cookie": "fresh"
    }


def test_show_setup_required_points_at_web_app(
    logged_in: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    body = {"error": {"code": "setup_required", "message": "Initial setup is required"}}
    transport, _ = show_transport(body, 401)

    assert main(["show", "7"], transport=transport) == 1

    assert "web app" in capsys.readouterr().err
