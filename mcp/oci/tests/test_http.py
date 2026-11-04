"""Streamable HTTP seam: real sockets on port 0, MockTransport as the backend."""

import json
import threading
from collections.abc import Iterator

import httpx
import pytest
from tuk_core.client import Client

from tuk_mcp.http import make_server
from tuk_mcp.server import main
from tuk_mcp.session import PasswordSession
from tuk_mcp.tools import Toolbox

TOKEN = "t" * 32
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def backend(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/api/v1/auth/login":
        return httpx.Response(204, headers={"set-cookie": "tuktuk_session=c1"})
    return httpx.Response(200, json={"items": [], "total": 0, "limit": 20, "offset": 0})


@pytest.fixture
def url() -> Iterator[str]:
    client = Client("http://x", transport=httpx.MockTransport(backend))
    box = Toolbox(client, PasswordSession(client, "pw"))
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


def test_tools_call_logs_in_with_password(url: str) -> None:
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
    monkeypatch.setenv("TUK_PASSWORD", "pw")
    assert main(argv=["--http", "--port", "0"]) == 1
    assert "MCP_BEARER_TOKEN" in capsys.readouterr().err


def test_refuses_to_start_without_password(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("MCP_BEARER_TOKEN", TOKEN)
    monkeypatch.delenv("TUK_PASSWORD", raising=False)
    assert main(argv=["--http", "--port", "0"]) == 1
    assert "TUK_PASSWORD" in capsys.readouterr().err
