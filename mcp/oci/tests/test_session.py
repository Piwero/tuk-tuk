"""TokenSession through the Toolbox, with a mock backend: every request
carries the API token as a Bearer credential, nothing logs in, a rejected
token is reported once without retrying, and nothing touches disk."""

import json
from pathlib import Path

import httpx
import pytest
from tuk_core.client import Client

from tuk_mcp.session import FileSession, TokenSession
from tuk_mcp.tools import Toolbox

API_TOKEN = "tuk_pat_7_" + "ab" * 32


class Backend:
    """Accepts only the API token; `revoked` makes it reject that too."""

    def __init__(self) -> None:
        self.revoked = False
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == "/api/v1/auth/login":
            raise AssertionError("an API token never logs in")
        if self.revoked or request.headers.get("authorization") != f"Bearer {API_TOKEN}":
            return httpx.Response(401, json={"error": {"code": "unauthorized", "message": "no"}})
        return httpx.Response(200, json={"items": [], "total": 0, "limit": 20, "offset": 0})


@pytest.fixture
def setup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("TUK_CONFIG_DIR", str(tmp_path))
    backend = Backend()
    client = Client("http://x", transport=httpx.MockTransport(backend))
    box = Toolbox(client, TokenSession(API_TOKEN))
    return backend, box, tmp_path


def search(box: Toolbox) -> dict:
    return box.call("search_tasks", {"query": "x"})


def test_every_request_carries_the_token_and_no_cookie(setup) -> None:
    backend, box, _ = setup
    assert "isError" not in search(box)
    assert "isError" not in search(box)
    assert backend.requests
    for request in backend.requests:
        assert request.headers["authorization"] == f"Bearer {API_TOKEN}"
        assert "cookie" not in request.headers


def test_a_rejected_token_is_reported_once_without_retrying(setup) -> None:
    backend, box, _ = setup
    backend.revoked = True
    result = search(box)
    assert result["isError"]
    assert "TUK_API_TOKEN" in result["content"][0]["text"]
    assert len(backend.requests) == 1


def test_never_reads_or_writes_a_session_file(setup) -> None:
    backend, box, config = setup
    (config / "tuk").mkdir()
    (config / "tuk" / "session.json").write_text(json.dumps({"session_cookie": "ondisk"}))
    before = (config / "tuk" / "session.json").read_text()
    search(box)
    box.keep("reissued")
    search(box)
    assert (config / "tuk" / "session.json").read_text() == before
    assert all("ondisk" not in r.headers.get("cookie", "") for r in backend.requests)
    assert all(r.headers["authorization"] == f"Bearer {API_TOKEN}" for r in backend.requests)
    assert sorted(p.name for p in (config / "tuk").iterdir()) == ["session.json"]


def test_file_session_never_retries() -> None:
    assert FileSession().renew() is None
