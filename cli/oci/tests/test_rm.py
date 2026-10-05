import io
import json
from pathlib import Path

import httpx
import pytest

from tuk.cli import main

TASK_BODY = {"id": 7, "title": "Water plants", "completed": False}


@pytest.fixture
def logged_in(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    target = tmp_path / "config"
    monkeypatch.setenv("TUK_CONFIG_DIR", str(target))
    target.mkdir(parents=True, exist_ok=True)
    (target / "tuk").mkdir(exist_ok=True)
    (target / "tuk" / "config.json").write_text(json.dumps({"base_url": "http://x"}))
    (target / "tuk" / "session.json").write_text(json.dumps({"session_cookie": "sess"}))
    return target


def rm_transport(
    task: object = TASK_BODY,
    task_status: int = 200,
) -> tuple[httpx.MockTransport, dict[str, object]]:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["cookie"] = request.headers.get("cookie", "")
        seen["path"] = request.url.path
        if request.method == "GET" and request.url.path.startswith("/api/v1/tasks/"):
            seen["fetched"] = True
            return httpx.Response(task_status, json=task)
        if request.method == "DELETE" and request.url.path.startswith("/api/v1/tasks/"):
            seen["deleted"] = True
            return httpx.Response(204)
        raise AssertionError(f"unexpected {request.method} {request.url.path}")

    return httpx.MockTransport(handler), seen


def _fake_stdin(monkeypatch: pytest.MonkeyPatch, text: str, tty: bool) -> None:
    stdin = io.StringIO(text)
    monkeypatch.setattr(stdin, "isatty", lambda: tty)
    monkeypatch.setattr("sys.stdin", stdin)


def tty(monkeypatch: pytest.MonkeyPatch, text: str) -> None:
    _fake_stdin(monkeypatch, text, True)


def no_tty(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_stdin(monkeypatch, "", False)


def test_rm_confirmed_deletes(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    tty(monkeypatch, "y\n")
    transport, seen = rm_transport()

    assert main(["rm", "7"], transport=transport) == 0

    assert seen.get("deleted") is True
    out = capsys.readouterr().out
    assert "Water plants" in out
    assert "7" in out
    assert "sess" in str(seen["cookie"])
    assert seen["path"] == "/api/v1/tasks/7"


def test_rm_declined_deletes_nothing(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    tty(monkeypatch, "n\n")
    transport, seen = rm_transport()

    assert main(["rm", "7"], transport=transport) == 1

    assert "deleted" not in seen


def test_rm_yes_skips_prompt(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    no_tty(monkeypatch)
    transport, seen = rm_transport()

    assert main(["rm", "--yes", "7"], transport=transport) == 0

    assert seen.get("deleted") is True


def test_rm_non_terminal_fails_without_yes(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    no_tty(monkeypatch)
    transport, seen = rm_transport()

    assert main(["rm", "7"], transport=transport) == 1

    assert "deleted" not in seen
    assert "fetched" not in seen
    assert "--yes" in capsys.readouterr().err


def test_rm_unknown_id_reports_not_found(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    tty(monkeypatch, "y\n")
    body = {"error": {"code": "not_found", "message": "Task 9 not found"}}
    transport, seen = rm_transport(body, 404)

    assert main(["rm", "9"], transport=transport) == 1

    assert "deleted" not in seen
    assert "not found" in capsys.readouterr().err.lower()


def test_rm_eof_cancels_without_traceback(
    logged_in: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _fake_stdin(monkeypatch, "", True)
    monkeypatch.setattr("builtins.input", _raise_eof)
    transport, seen = rm_transport()

    assert main(["rm", "7"], transport=transport) == 1

    assert "deleted" not in seen
    assert "cancelled" in capsys.readouterr().err.lower()


def _raise_eof(_prompt: str = "") -> str:
    raise EOFError
