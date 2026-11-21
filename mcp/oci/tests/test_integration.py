"""Two Users through one shared MCP server, against the real application
(issue #525).

Boots the backend in-process on a throwaway PostgreSQL (as the CLI's
integration test does) and serves what `tuk-mcp --http` serves: one HTTP
server on a real socket holding only the deployment's MCP service key. Each
User brings their own MCP token, which the server exchanges at the real
backend on every request. The acceptance check is that one deployment and
URL serves both Users, each seeing and writing only their own data.
"""

import os
from collections.abc import Iterator
from typing import Any

import pytest
from argon2 import PasswordHasher
from argon2.low_level import Type

os.environ.setdefault("AUTH_COOKIE_SECURE", "false")
os.environ.setdefault("APP_MASTER_KEY", "test-master-key")
os.environ.setdefault("AUTH_LOGIN_DELAY_SECONDS", "0")
# app.main builds a module-level app on import, which requires a PostgreSQL
# DATABASE_URL. Building it never connects; the fixture's app gets the real one.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://unused:unused@localhost:5432/unused")

import asyncio  # noqa: E402
import json  # noqa: E402
import threading  # noqa: E402

import httpx  # noqa: E402
import psycopg  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import User  # noqa: E402
from app.users import create_user  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from testcontainers.postgres import PostgresContainer  # noqa: E402
from tuk_core.client import Client  # noqa: E402

from tuk_mcp.auth import Exchanger  # noqa: E402
from tuk_mcp.http import make_server  # noqa: E402

PASSWORD = "a-long-test-password"
SERVICE_KEY = "k" * 48


@pytest.fixture(scope="module")
def postgres_server() -> Iterator[str]:
    """One throwaway server for the module, as `user:password@host:port`."""
    container = PostgresContainer("postgres:16", driver=None).with_command("-c fsync=off")
    with container as server:
        host = server.get_container_host_ip()
        port = server.get_exposed_port(5432)
        yield f"{server.username}:{server.password}@{host}:{port}/{server.dbname}"


@pytest.fixture
def postgres_url(postgres_server: str, request: pytest.FixtureRequest) -> str:
    """A fresh, empty database on that server for each test."""
    name = "t_" + request.node.name.lower()[:50]
    with psycopg.connect(f"postgresql://{postgres_server}", autocommit=True) as connection:
        connection.execute(f'DROP DATABASE IF EXISTS "{name}"')
        connection.execute(f'CREATE DATABASE "{name}"')
    server = postgres_server.rsplit("/", 1)[0]
    return f"postgresql+psycopg://{server}/{name}"


@pytest.fixture
def live_app(postgres_url: str) -> Iterator[TestClient]:
    """The real application with two Users, Alice (the Admin) and Bea, and
    nobody signed in."""
    app = create_app(Settings(database_url=postgres_url, mcp_service_key=SERVICE_KEY))
    password_hash = PasswordHasher(time_cost=1, memory_cost=64, parallelism=1, type=Type.ID).hash(
        PASSWORD
    )

    async def create_users() -> None:
        async with app.state.session_factory() as session:
            for username, is_admin in (("alice", True), ("bea", False)):
                await create_user(
                    session,
                    User(
                        username=username,
                        email=f"{username}@example.com",
                        password_hash=password_hash,
                        is_admin=is_admin,
                    ),
                )
            await session.commit()

    with TestClient(app) as test_client:
        asyncio.run(create_users())
        yield test_client


def sign_in(test_client: TestClient, username: str) -> None:
    test_client.cookies.clear()
    login = test_client.post("/api/v1/auth/login", json={"login": username, "password": PASSWORD})
    assert login.status_code == 204, login.text


def mint_mcp_token(test_client: TestClient, username: str) -> tuple[int, str]:
    """What a User does in Settings before registering the shared server:
    sign in with their password and create an MCP token."""
    sign_in(test_client, username)
    created = test_client.post("/api/v1/auth/me/tokens", json={"name": "Claude", "kind": "mcp"})
    assert created.status_code == 201, created.text
    test_client.cookies.clear()
    return int(created.json()["id"]), str(created.json()["token"])


@pytest.fixture
def mcp_url(live_app: TestClient) -> Iterator[str]:
    """The one shared MCP server: a real socket, its backend calls going to
    the live app. It holds the service key and nothing of any User's."""
    lock = threading.Lock()

    def handler(request: httpx.Request) -> httpx.Response:
        # Only the credential the MCP server sends may authenticate: never a
        # cookie the test client picked up elsewhere.
        with lock:
            live_app.cookies.clear()
            path = request.url.path
            if request.url.query:
                path += f"?{request.url.query.decode()}"
            response = live_app.request(
                request.method, path, content=request.content, headers=dict(request.headers)
            )
        return httpx.Response(
            response.status_code, headers=dict(response.headers), content=response.content
        )

    transport = httpx.MockTransport(handler)
    server = make_server(
        Client("http://testserver", transport=transport),
        Exchanger("http://testserver", SERVICE_KEY, transport=transport),
        "127.0.0.1",
        0,
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/mcp"
    server.shutdown()
    server.server_close()


def call(url: str, token: str, name: str, arguments: dict[str, Any]) -> tuple[bool, Any]:
    """A `tools/call` as `token`'s User: (is_error, the tool's text payload)."""
    reply = httpx.post(
        url,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        },
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    assert reply.status_code == 200, reply.text
    result = reply.json()["result"]
    text = result["content"][0]["text"]
    if result.get("isError"):
        return True, text
    return False, json.loads(text)


def test_one_server_serves_two_users_each_their_own_data(
    live_app: TestClient, mcp_url: str
) -> None:
    _, alice = mint_mcp_token(live_app, "alice")
    _, bea = mint_mcp_token(live_app, "bea")

    failed, alices_task = call(mcp_url, alice, "create_task", {"title": "Alice plan"})
    assert not failed, alices_task
    failed, beas_task = call(mcp_url, bea, "create_task", {"title": "Bea plan"})
    assert not failed, beas_task

    failed, found = call(mcp_url, bea, "search_tasks", {"query": "plan"})
    assert not failed, found
    assert [t["title"] for t in found["tasks"]] == ["Bea plan"]

    failed, message = call(mcp_url, bea, "get_task", {"task_id": alices_task["id"]})
    assert failed
    assert "not found" in message
    assert "Alice" not in message

    failed, found = call(mcp_url, alice, "search_tasks", {"query": "plan"})
    assert not failed, found
    assert [t["title"] for t in found["tasks"]] == ["Alice plan"]

    # The agenda reads Tasks, Habits, Events, Lists and Tags in one go:
    # every route it calls must be open to the exchange's access credential.
    failed, agenda = call(mcp_url, bea, "get_agenda", {})
    assert not failed, agenda
    assert "Alice plan" not in json.dumps(agenda)


def test_read_before_write_holds_per_user(live_app: TestClient, mcp_url: str) -> None:
    _, alice = mint_mcp_token(live_app, "alice")
    _, bea = mint_mcp_token(live_app, "bea")
    failed, task = call(mcp_url, alice, "create_task", {"title": "Alice plan"})
    assert not failed, task

    failed, message = call(mcp_url, bea, "complete_task", {"task_id": task["id"]})
    assert failed
    assert "was not read" in message

    failed, done = call(mcp_url, alice, "complete_task", {"task_id": task["id"]})
    assert not failed, done
    assert done["completed"] is True


def test_revoking_or_disabling_cuts_off_the_next_request(
    live_app: TestClient, mcp_url: str
) -> None:
    alice_token_id, alice = mint_mcp_token(live_app, "alice")
    _, bea = mint_mcp_token(live_app, "bea")
    ping = {"jsonrpc": "2.0", "id": 1, "method": "ping"}
    for token in (alice, bea):
        assert (
            httpx.post(mcp_url, json=ping, headers={"Authorization": f"Bearer {token}"}).status_code
            == 200
        )

    sign_in(live_app, "alice")
    live_app.delete(f"/api/v1/auth/me/tokens/{alice_token_id}")
    bea_id = live_app.get("/api/v1/admin/users").json()["items"][1]["id"]
    live_app.patch(f"/api/v1/admin/users/{bea_id}", json={"is_active": False})
    live_app.cookies.clear()

    for token in (alice, bea):
        reply = httpx.post(mcp_url, json=ping, headers={"Authorization": f"Bearer {token}"})
        assert reply.status_code == 401
