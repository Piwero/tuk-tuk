"""Streamable HTTP seam (issue #525): one shared server over real sockets on
port 0, with MockTransport as the backend. The fake backend exchanges each
User's MCP token for an access credential and answers API calls as that
credential's User, so it can tell which User every call was made as."""

import http.client
import json
import threading
import urllib.error
import urllib.request
from collections.abc import Iterator
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
from tuk_core.client import Client

from tuk_mcp.auth import Exchanger
from tuk_mcp.clients import ClientStates
from tuk_mcp.http import make_server
from tuk_mcp.server import main

SERVICE_KEY = "k" * 48
ALICE = "tuk_mcp_1_" + "a1" * 32
BEA = "tuk_mcp_2_" + "b2" * 32
EXCHANGE = "/api/v1/auth/mcp/exchange"


@dataclass
class Backend:
    """MCP tokens -> (user id, token id); each User owns some Tasks."""

    tokens: dict[str, tuple[int, int]] = field(
        default_factory=lambda: {ALICE: (1, 11), BEA: (2, 22)}
    )
    tasks: dict[int, list[dict[str, object]]] = field(
        default_factory=lambda: {
            1: [{"id": 100, "title": "Alice plan", "due_date": None}],
            2: [{"id": 200, "title": "Bea plan", "due_date": None}],
        }
    )
    down: bool = False
    exchanges: int = 0
    issued: int = 0
    requests: list[httpx.Request] = field(default_factory=list)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.down:
            raise httpx.ConnectError("backend down")
        if request.url.path == EXCHANGE:
            return self.exchange(request)
        user = self.user_of(request)
        if user is None:
            return httpx.Response(401, json={"error": {"code": "unauthorized", "message": "no"}})
        if request.url.path == "/api/v1/tasks":
            rows = self.tasks[user]
            return httpx.Response(200, json={"items": rows, "total": len(rows)})
        if request.url.path.startswith("/api/v1/tasks/"):
            task_id = int(request.url.path.rsplit("/", 1)[1])
            for task in self.tasks[user]:
                if task["id"] == task_id:
                    if request.method == "PATCH":
                        task.update(json.loads(request.content))
                    return httpx.Response(200, json=task)
            return httpx.Response(404, json={"error": {"code": "not_found", "message": "no"}})
        return httpx.Response(404)

    def exchange(self, request: httpx.Request) -> httpx.Response:
        self.exchanges += 1
        if request.headers.get("authorization") != f"Bearer {SERVICE_KEY}":
            return httpx.Response(401, json={"error": {"code": "unauthorized", "message": "no"}})
        token = json.loads(request.content).get("token")
        if token not in self.tokens:
            return httpx.Response(
                401, json={"error": {"code": "invalid_mcp_token", "message": "no"}}
            )
        user_id, token_id = self.tokens[token]
        self.issued += 1
        return httpx.Response(
            200,
            json={
                "access_token": f"tuk_mcpa_{user_id}_{self.issued}",
                "expires_in": 120,
                "user_id": user_id,
                "token_id": token_id,
            },
        )

    def user_of(self, request: httpx.Request) -> int | None:
        credential = request.headers.get("authorization", "").removeprefix("Bearer ")
        if not credential.startswith("tuk_mcpa_"):
            return None
        user_id = int(credential.split("_")[2])
        return user_id if user_id in {u for u, _ in self.tokens.values()} else None


@pytest.fixture
def backend() -> Backend:
    return Backend()


@pytest.fixture
def url(backend: Backend) -> Iterator[str]:
    transport = httpx.MockTransport(backend)
    client = Client("http://backend", transport=transport)
    exchanger = Exchanger("http://backend", SERVICE_KEY, transport=transport)
    server = make_server(client, exchanger, "127.0.0.1", 0, frozenset({"https://ok.example"}))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()


def rpc(method: str, **extra: object) -> dict[str, object]:
    return {"jsonrpc": "2.0", "id": 1, "method": method, **extra}


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def post(url: str, body: object, headers: dict[str, str] | None = None) -> httpx.Response:
    return httpx.post(f"{url}/mcp", content=json.dumps(body), headers=headers or auth(ALICE))


def tool(url: str, token: str, name: str, **arguments: object) -> tuple[bool, Any]:
    """A tools/call as `token`'s User: (is_error, the tool's payload)."""
    reply = post(url, rpc("tools/call", params={"name": name, "arguments": arguments}), auth(token))
    assert reply.status_code == 200, reply.text
    result = reply.json()["result"]
    text = result["content"][0]["text"]
    return bool(result.get("isError")), text if result.get("isError") else json.loads(text)


def titles(url: str, token: str) -> list[str]:
    failed, found = tool(url, token, "search_tasks", query="plan")
    assert not failed, found
    return [t["title"] for t in found["tasks"]]


class TestOneServerManyUsers:
    def test_each_user_sees_only_their_own_tasks(self, url: str) -> None:
        assert titles(url, ALICE) == ["Alice plan"]
        assert titles(url, BEA) == ["Bea plan"]
        assert titles(url, ALICE) == ["Alice plan"]

    def test_a_users_read_admits_their_own_later_write(self, url: str, backend: Backend) -> None:
        titles(url, ALICE)

        failed, done = tool(url, ALICE, "set_priority", task_id=100, priority="high")

        assert not failed, done
        assert backend.tasks[1][0]["priority"] == "high"

    def test_another_users_read_admits_nothing(self, url: str, backend: Backend) -> None:
        titles(url, ALICE)  # Alice's read of Task 100

        failed, message = tool(url, BEA, "set_priority", task_id=100, priority="high")

        assert failed
        assert "was not read" in message
        assert not [r for r in backend.requests if r.method == "PATCH"]

    def test_two_tokens_of_one_user_are_two_clients(self, url: str, backend: Backend) -> None:
        second = "tuk_mcp_1_" + "c3" * 32
        backend.tokens[second] = (1, 12)
        titles(url, ALICE)

        failed, message = tool(url, second, "set_priority", task_id=100, priority="high")

        assert failed
        assert "was not read" in message

    def test_alternating_concurrent_users_never_cross(self, url: str) -> None:
        seen: list[tuple[str, list[str]]] = []

        def run(token: str) -> None:
            for _ in range(5):
                seen.append((token, titles(url, token)))

        threads = [threading.Thread(target=run, args=(t,)) for t in (ALICE, BEA) * 4]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(seen) == 40
        expected = {ALICE: ["Alice plan"], BEA: ["Bea plan"]}
        assert all(found == expected[token] for token, found in seen)


class TestAuthentication:
    @pytest.mark.parametrize(
        "header",
        [
            None,
            "Bearer " + "x" * 32,
            "Bearer tuk_pat_1_" + "a1" * 32,
            "Bearer tuk_mcpa_1_1",
            ALICE,
            "Basic " + ALICE,
        ],
    )
    def test_a_missing_or_malformed_credential_gets_401_without_asking_the_backend(
        self, url: str, backend: Backend, header: str | None
    ) -> None:
        headers = {} if header is None else {"Authorization": header}

        reply = httpx.post(f"{url}/mcp", content="not json", headers=headers)

        assert reply.status_code == 401
        assert reply.headers["www-authenticate"] == "Bearer"
        assert backend.requests == []

    @pytest.mark.parametrize(
        "body",
        [
            rpc("initialize", params={"protocolVersion": "2025-06-18"}),
            rpc("ping"),
            rpc("tools/list"),
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
        ],
    )
    def test_every_request_is_authenticated(
        self, url: str, backend: Backend, body: dict[str, object]
    ) -> None:
        unknown = "tuk_mcp_9_" + "99" * 32

        assert post(url, body, auth(unknown)).status_code == 401
        assert post(url, body).status_code in (200, 202)
        assert backend.exchanges == 2

    def test_a_revoked_token_is_refused_on_the_next_request(
        self, url: str, backend: Backend
    ) -> None:
        assert post(url, rpc("ping"), auth(BEA)).status_code == 200
        del backend.tokens[BEA]

        reply = post(url, rpc("ping"), auth(BEA))

        assert reply.status_code == 401
        assert reply.content == b""

    def test_an_unreachable_backend_fails_closed(self, url: str, backend: Backend) -> None:
        backend.down = True

        reply = post(url, rpc("tools/list"))

        assert reply.status_code == 503
        assert reply.content == b""

    def test_a_refused_service_key_is_the_servers_fault_not_the_clients(
        self, backend: Backend
    ) -> None:
        transport = httpx.MockTransport(backend)
        exchanger = Exchanger("http://backend", "w" * 48, transport=transport)
        server = make_server(
            Client("http://backend", transport=transport), exchanger, "127.0.0.1", 0
        )
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            reply = post(f"http://127.0.0.1:{server.server_port}", rpc("ping"))
        finally:
            server.shutdown()
            server.server_close()

        assert reply.status_code == 503

    def test_redirects_are_never_followed(self) -> None:
        followed: list[httpx.Request] = []

        def redirecting(request: httpx.Request) -> httpx.Response:
            if request.url.host != "backend":
                followed.append(request)
                return httpx.Response(200, json={})
            return httpx.Response(307, headers={"Location": "http://elsewhere/steal"})

        transport = httpx.MockTransport(redirecting)
        exchanger = Exchanger("http://backend", SERVICE_KEY, transport=transport)
        server = make_server(
            Client("http://backend", transport=transport), exchanger, "127.0.0.1", 0
        )
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            reply = post(f"http://127.0.0.1:{server.server_port}", rpc("ping"))
        finally:
            server.shutdown()
            server.server_close()

        assert reply.status_code == 503
        assert followed == []


class TestClientStateIsBounded:
    def test_past_the_limit_the_least_recent_client_reads_again(self, backend: Backend) -> None:
        transport = httpx.MockTransport(backend)
        exchanger = Exchanger("http://backend", SERVICE_KEY, transport=transport)
        states = ClientStates(max_clients=1)
        server = make_server(
            Client("http://backend", transport=transport), exchanger, "127.0.0.1", 0, states=states
        )
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            titles(base, ALICE)
            titles(base, BEA)
            failed, message = tool(base, ALICE, "set_priority", task_id=100, priority="high")
        finally:
            server.shutdown()
            server.server_close()

        assert failed
        assert "was not read" in message
        assert len(states) == 1

    def test_an_idle_client_is_forgotten(self, backend: Backend) -> None:
        now = [0.0]
        transport = httpx.MockTransport(backend)
        exchanger = Exchanger("http://backend", SERVICE_KEY, transport=transport)
        states = ClientStates(idle_seconds=60, clock=lambda: now[0])
        server = make_server(
            Client("http://backend", transport=transport), exchanger, "127.0.0.1", 0, states=states
        )
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            titles(base, ALICE)
            now[0] = 61.0
            failed, message = tool(base, ALICE, "set_priority", task_id=100, priority="high")
        finally:
            server.shutdown()
            server.server_close()

        assert failed
        assert "was not read" in message


class TestTransport:
    def test_unknown_origin_is_403_known_or_absent_allowed(self, url: str) -> None:
        assert (
            post(url, rpc("ping"), {**auth(ALICE), "Origin": "https://evil.example"}).status_code
            == 403
        )
        assert (
            post(url, rpc("ping"), {**auth(ALICE), "Origin": "https://ok.example"}).status_code
            == 200
        )
        assert post(url, rpc("ping")).status_code == 200

    def test_ping_matches_stdio_response(self, url: str) -> None:
        reply = post(url, rpc("ping"))
        assert reply.headers["content-type"] == "application/json"
        assert reply.json() == {"jsonrpc": "2.0", "id": 1, "result": {}}

    def test_initialize_and_tools_list(self, url: str) -> None:
        init = post(url, rpc("initialize", params={"protocolVersion": "2025-06-18"})).json()
        assert init["result"]["serverInfo"]["name"] == "tuk-mcp"
        tools = post(url, rpc("tools/list")).json()["result"]["tools"]
        assert "get_agenda" in {t["name"] for t in tools}

    def test_notification_is_202_with_empty_body(self, url: str) -> None:
        reply = post(url, {"jsonrpc": "2.0", "method": "notifications/initialized"})
        assert reply.status_code == 202
        assert reply.content == b""

    def test_malformed_body_is_parse_error(self, url: str) -> None:
        reply = httpx.post(f"{url}/mcp", content="{nope", headers=auth(ALICE))
        assert reply.json()["error"]["code"] == -32700

    def test_an_oversized_body_is_413_before_it_is_read(self, url: str, backend: Backend) -> None:
        # http.client, because httpx refuses to declare more than it sends.
        connection = http.client.HTTPConnection(url.removeprefix("http://"), timeout=5)
        connection.putrequest("POST", "/mcp")
        connection.putheader("Authorization", f"Bearer {ALICE}")
        connection.putheader("Content-Length", str(1_048_577))
        connection.endheaders()
        status = connection.getresponse().status
        connection.close()

        assert status == 413
        assert backend.requests == []

    def test_get_mcp_is_405(self, url: str) -> None:
        assert httpx.get(f"{url}/mcp", headers=auth(ALICE)).status_code == 405

    def test_health_needs_no_auth_and_asks_nothing(self, url: str, backend: Backend) -> None:
        assert httpx.get(f"{url}/health").status_code == 200
        assert backend.requests == []


class TestStarting:
    @pytest.mark.parametrize("key", ["", "short", "x" * 31])
    def test_refuses_to_start_without_a_strong_service_key(
        self, key: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        monkeypatch.setenv("MCP_SERVICE_KEY", key)
        assert main(argv=["--http", "--port", "0"]) == 1
        assert "MCP_SERVICE_KEY" in capsys.readouterr().err

    def test_needs_no_user_credential(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """No pod-held User token and no shared bearer: a server starts
        with the service key alone (it is stopped straight away)."""
        monkeypatch.setenv("MCP_SERVICE_KEY", SERVICE_KEY)
        monkeypatch.delenv("TUK_API_TOKEN", raising=False)
        monkeypatch.delenv("MCP_BEARER_TOKEN", raising=False)
        started: list[object] = []

        def stop_at_once(self: object) -> None:
            started.append(self)
            raise KeyboardInterrupt

        monkeypatch.setattr("http.server.HTTPServer.serve_forever", stop_at_once)

        assert main(argv=["--http", "--host", "127.0.0.1", "--port", "0"]) == 0
        assert started


def test_secrets_never_reach_stderr_or_logs(
    url: str, backend: Backend, capfd: pytest.CaptureFixture[str], caplog: pytest.LogCaptureFixture
) -> None:
    cookie = "cookie-value-xyz"
    call = rpc("tools/call", params={"name": "search_tasks", "arguments": {"query": "x"}})
    with caplog.at_level("DEBUG"):
        post(url, call)
        post(url, call, {"Authorization": f"Bearer {BEA}x", "Cookie": f"s={cookie}"})
        backend.down = True
        post(url, call, auth(BEA))
        for path in (f"/mcp?token={ALICE}", f"/{ALICE}/{SERVICE_KEY}/{cookie}"):
            with suppress(urllib.error.HTTPError):  # urllib: httpx would log the URL itself
                urllib.request.urlopen(url + path, timeout=5)  # noqa: S310
    seen = capfd.readouterr()
    output = seen.out + seen.err + caplog.text
    for secret in (ALICE, BEA, SERVICE_KEY, cookie, "tuk_mcpa_"):
        assert secret not in output
