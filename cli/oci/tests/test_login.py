"""Unit tests drive the real entrypoint with a mock transport.

The only seam is the HTTP transport, taken at client construction and
passed through `main`. Tests never mock file I/O: TUK_CONFIG_DIR
redirects the config directory at a temporary path and real files are
exercised, permission bits included.
"""

import json
import os
import stat
from pathlib import Path

import httpx
import pytest

from tuk.cli import main


@pytest.fixture
def config_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    target = tmp_path / "config"
    monkeypatch.setenv("TUK_CONFIG_DIR", str(target))
    return target


def login_transport(cookie: str = "signed-session-token") -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/auth/login"
        assert json.loads(request.content) == {"password": "s3cret"}
        headers = {"set-cookie": f"tuktuk_session={cookie}; Path=/; HttpOnly"}
        return httpx.Response(204, headers=headers)

    return httpx.MockTransport(handler)


def read_session_file(config_dir: Path) -> str:
    return (config_dir / "tuk" / "session.json").read_text()


def run_login(monkeypatch: pytest.MonkeyPatch, transport: httpx.BaseTransport) -> int:
    monkeypatch.setattr("getpass.getpass", lambda _prompt: "s3cret")
    return main(["login", "--base-url", "http://x"], transport=transport)


def test_login_caches_session_cookie(
    config_dir: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run_login(monkeypatch, login_transport()) == 0

    assert json.loads(read_session_file(config_dir)) == {"session_cookie": "signed-session-token"}
    assert capsys.readouterr().out == "Logged in.\n"


def test_login_session_file_is_owner_only(
    config_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert run_login(monkeypatch, login_transport()) == 0

    mode = stat.S_IMODE(os.stat(config_dir / "tuk" / "session.json").st_mode)
    assert mode == 0o600


def test_login_never_persists_password(config_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    assert run_login(monkeypatch, login_transport()) == 0

    assert "s3cret" not in (config_dir / "tuk" / "session.json").read_text()
    assert "s3cret" not in (config_dir / "tuk" / "config.json").read_text()
    assert json.loads((config_dir / "tuk" / "config.json").read_text()) == {"base_url": "http://x"}


@pytest.mark.parametrize(
    ("status", "code"),
    [
        # What the login endpoint actually emits today: it is a public path,
        # so it answers for itself rather than reaching the middleware.
        (404, "not_found"),
        # The canonical first-run code every gated route emits. Accepted here
        # too, so aligning the login endpoint on it is not a client break.
        (401, "setup_required"),
    ],
)
def test_login_setup_required_points_at_web_app(
    config_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    status: int,
    code: str,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status, json={"error": {"code": code, "message": "Setup has not been completed"}}
        )

    assert run_login(monkeypatch, httpx.MockTransport(handler)) == 1

    err = capsys.readouterr().err
    assert "web app" in err


def test_login_wrong_password_does_not_point_at_setup(
    config_dir: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A set-up instance with a bad password must not be mistaken for an
    instance that has never had one — the two send the owner to different
    places, which is the whole reason the codes are distinguished."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            json={"error": {"code": "invalid_credentials", "message": "Incorrect password"}},
        )

    assert run_login(monkeypatch, httpx.MockTransport(handler)) == 1

    err = capsys.readouterr().err
    assert "Incorrect password" in err
    assert "web app" not in err


def test_config_lives_under_xdg_config_home(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    xdg = tmp_path / "xdg"
    monkeypatch.setenv("XDG_CONFIG_HOME", str(xdg))
    monkeypatch.delenv("TUK_CONFIG_DIR", raising=False)

    assert run_login(monkeypatch, login_transport()) == 0

    assert (xdg / "tuk" / "session.json").exists()
