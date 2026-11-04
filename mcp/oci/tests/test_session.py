"""PasswordSession through the Toolbox, with a mock backend: lazy login, one
re-login and retry on `unauthorized`, no loop, and nothing on disk."""

import json
from pathlib import Path

import httpx
import pytest
from tuk_core.client import Client

from tuk_mcp.session import FileSession, PasswordSession
from tuk_mcp.tools import Toolbox


class Backend:
    """Accepts only the cookie of the latest login; `stale` makes it reject everything."""

    def __init__(self) -> None:
        self.logins = 0
        self.valid = ""
        self.stale = False
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == "/api/v1/auth/login":
            assert json.loads(request.content) == {"password": "hunter2"}
            self.logins += 1
            self.valid = f"cookie{self.logins}"
            return httpx.Response(204, headers={"set-cookie": f"tuktuk_session={self.valid}"})
        if self.stale or f"tuktuk_session={self.valid}" not in request.headers.get("cookie", ""):
            return httpx.Response(401, json={"error": {"code": "unauthorized", "message": "no"}})
        return httpx.Response(200, json={"items": [], "total": 0, "limit": 20, "offset": 0})


@pytest.fixture
def setup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("TUK_CONFIG_DIR", str(tmp_path))
    backend = Backend()
    client = Client("http://x", transport=httpx.MockTransport(backend))
    box = Toolbox(client, PasswordSession(client, "hunter2"))
    return backend, box, tmp_path


def search(box: Toolbox) -> dict:
    return box.call("search_tasks", {"query": "x"})


def test_logs_in_lazily_once_and_reuses_the_cookie(setup) -> None:
    backend, box, _ = setup
    assert backend.logins == 0
    assert "isError" not in search(box)
    assert "isError" not in search(box)
    assert backend.logins == 1


def test_expired_session_logs_in_once_and_retries_once(setup) -> None:
    backend, box, _ = setup
    search(box)
    backend.valid = "revoked"
    assert "isError" not in search(box)
    assert backend.logins == 2
    assert "isError" not in search(box)
    assert backend.logins == 2


def test_second_unauthorized_surfaces_without_looping(setup) -> None:
    backend, box, _ = setup
    search(box)
    backend.stale = True
    result = search(box)
    assert result["isError"]
    assert "TUK_PASSWORD" in result["content"][0]["text"]
    assert backend.logins == 2  # initial + exactly one re-login
    assert len([r for r in backend.requests if r.url.path != "/api/v1/auth/login"]) == 3


def test_fresh_login_that_is_rejected_does_not_login_again(setup) -> None:
    backend, box, _ = setup
    backend.stale = True
    assert search(box)["isError"]
    assert backend.logins == 1


def test_refreshed_cookie_is_kept_in_memory(setup) -> None:
    backend, box, _ = setup
    session = box.session
    session.cookie()
    session.keep("reissued")
    assert session.cookie() == "reissued"


def test_never_reads_or_writes_a_session_file(setup) -> None:
    backend, box, config = setup
    (config / "tuk").mkdir()
    (config / "tuk" / "session.json").write_text(json.dumps({"session_cookie": "ondisk"}))
    before = (config / "tuk" / "session.json").read_text()
    search(box)
    box.session.keep("reissued")
    backend.valid = "revoked"
    search(box)
    assert (config / "tuk" / "session.json").read_text() == before
    assert all("ondisk" not in r.headers.get("cookie", "") for r in backend.requests)
    assert sorted(p.name for p in (config / "tuk").iterdir()) == ["session.json"]


def test_file_session_never_retries() -> None:
    assert FileSession().renew() is None
