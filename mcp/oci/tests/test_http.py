"""Streamable HTTP seam: real sockets on port 0, MockTransport as the backend."""

import json
import threading
import urllib.error
import urllib.request
from collections.abc import Iterator
from contextlib import suppress

import httpx
import pytest
from tuk_core.client import Client

from tuk_mcp.http import make_server
from tuk_mcp.server import main
from tuk_mcp.session import TokenSession
from tuk_mcp.tools import Toolbox

TOKEN = "t" * 32
AUTH = {"Authorization": f"Bearer {TOKEN}"}
API_TOKEN = "tuk_pat_7_" + "cd" * 32


def backend(request: httpx.Request) -> httpx.Response:
    if request.headers.get("authorization") != f"Bearer {API_TOKEN}":
        return httpx.Response(401, json={"error": {"code": "unauthorized", "message": "no"}})
    return httpx.Response(200, json={"items": [], "total": 0, "limit": 20, "offset": 0})


@pytest.fixture
def url() -> Iterator[str]:
    client = Client("http://x", transport=httpx.MockTransport(backend))
    box = Toolbox(client, TokenSession(API_TOKEN))
    server = make_server(box, TOKEN, "127.0.0.1", 0, frozenset({"https://ok.example"}))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()


def rpc(method: str, **extra: object) -> dict[str, object]:
    return {"jsonrpc": "2.0", "id": 1, "method": method, **extra}


def post(url: str, body: object, headers: dict[str, str] | None = None) -> httpx.Response:
    return httpx.post(f"{url}/mcp", content=json.dumps(body), headers=headers or AUTH)


def test_missing_and_wrong_token_get_401_before_parsing(url: str) -> None:
    for headers in ({}, {"Authorization": "Bearer " + "x" * 32}, {"Authorization": TOKEN}):
        reply = httpx.post(f"{url}/mcp", content="not json", headers=headers)
        assert reply.status_code == 401
        assert reply.headers["www-authenticate"] == "Bearer"


def test_unknown_origin_is_403_known_or_absent_allowed(url: str) -> None:
    assert post(url, rpc("ping"), {**AUTH, "Origin": "https://evil.example"}).status_code == 403
    assert post(url, rpc("ping"), {**AUTH, "Origin": "https://ok.example"}).status_code == 200
    assert post(url, rpc("ping")).status_code == 200


def test_ping_matches_stdio_response(url: str) -> None:
    reply = post(url, rpc("ping"))
    assert reply.headers["content-type"] == "application/json"
    assert reply.json() == {"jsonrpc": "2.0", "id": 1, "result": {}}


def test_initialize_and_tools_list(url: str) -> None:
    init = post(url, rpc("initialize", params={"protocolVersion": "2025-06-18"})).json()
    assert init["result"]["serverInfo"]["name"] == "tuk-mcp"
    tools = post(url, rpc("tools/list")).json()["result"]["tools"]
    assert "get_agenda" in {t["name"] for t in tools}


def test_tools_call_authenticates_with_the_api_token(url: str) -> None:
    reply = post(
        url, rpc("tools/call", params={"name": "search_tasks", "arguments": {"query": "x"}})
    )
    result = reply.json()["result"]
    assert "isError" not in result
    assert json.loads(result["content"][0]["text"]) == {"tasks": [], "total": 0}


def test_notification_is_202_with_empty_body(url: str) -> None:
    reply = post(url, {"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert reply.status_code == 202
    assert reply.content == b""


def test_malformed_body_is_parse_error(url: str) -> None:
    reply = httpx.post(f"{url}/mcp", content="{nope", headers=AUTH)
    assert reply.json()["error"]["code"] == -32700


def test_get_mcp_is_405(url: str) -> None:
    assert httpx.get(f"{url}/mcp", headers=AUTH).status_code == 405


def test_health_needs_no_auth(url: str) -> None:
    assert httpx.get(f"{url}/health").status_code == 200


def test_concurrent_calls_are_serialised(url: str) -> None:
    replies: list[int] = []
    body = rpc("tools/call", params={"name": "search_tasks", "arguments": {"query": "x"}})
    threads = [
        threading.Thread(target=lambda: replies.append(post(url, body).status_code))
        for _ in range(8)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert replies == [200] * 8


@pytest.mark.parametrize("token", ["", "short", "x" * 31])
def test_refuses_to_start_without_strong_token(
    token: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("MCP_BEARER_TOKEN", token)
    monkeypatch.setenv("TUK_API_TOKEN", API_TOKEN)
    assert main(argv=["--http", "--port", "0"]) == 1
    assert "MCP_BEARER_TOKEN" in capsys.readouterr().err


def test_refuses_to_start_without_api_token(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("MCP_BEARER_TOKEN", TOKEN)
    monkeypatch.delenv("TUK_API_TOKEN", raising=False)
    monkeypatch.setenv("TUK_PASSWORD", "a-password-is-no-longer-enough")
    assert main(argv=["--http", "--port", "0"]) == 1
    assert "TUK_API_TOKEN is required" in capsys.readouterr().err


def test_secrets_never_reach_stderr_or_logs(
    capfd: pytest.CaptureFixture[str], caplog: pytest.LogCaptureFixture
) -> None:
    api_token, cookie = "tuk_pat_7_" + "ef" * 32, "cookie-value-xyz"

    def token_backend(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == f"Bearer {api_token}"
        return httpx.Response(200, json={"items": [], "total": 0, "limit": 20, "offset": 0})

    client = Client("http://x", transport=httpx.MockTransport(token_backend))
    box = Toolbox(client, TokenSession(api_token))
    server = make_server(box, TOKEN, "127.0.0.1", 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    call = rpc("tools/call", params={"name": "search_tasks", "arguments": {"query": "x"}})
    try:
        with caplog.at_level("DEBUG"):
            post(base, call)
            post(base, call, {"Authorization": "Bearer wrong", "Cookie": f"s={cookie}"})
            for path in (
                f"/mcp?token={TOKEN}&api_token={api_token}",
                f"/{TOKEN}/{api_token}/{cookie}",
            ):
                with suppress(urllib.error.HTTPError):  # urllib: httpx would log the URL itself
                    urllib.request.urlopen(base + path, timeout=5)  # noqa: S310
    finally:
        server.shutdown()
        server.server_close()
    seen = capfd.readouterr()
    output = seen.out + seen.err + caplog.text
    for secret in (TOKEN, api_token, cookie):
        assert secret not in output
