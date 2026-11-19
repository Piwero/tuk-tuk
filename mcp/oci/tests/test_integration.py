"""Two Users, each with their own MCP server, against the real application.

Boots the backend in-process on a throwaway PostgreSQL (as the CLI's
integration test does) and builds what `tuk-mcp --http` builds for a pod: a
Toolbox holding one User's API token (ADR 0014's amendment). JSON-RPC
messages go through the real protocol handler, so this is the MCP seam a
remote client talks to. The admin deploys one such pod per User (ADR 0018);
the acceptance check is that the second User's pod sees only that User's
data.
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

import httpx  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import User  # noqa: E402
from app.users import create_user  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from testcontainers.postgres import PostgresContainer  # noqa: E402
from tuk_core.client import Client  # noqa: E402

from tuk_mcp.protocol import handle  # noqa: E402
from tuk_mcp.session import TokenSession  # noqa: E402
from tuk_mcp.tools import Toolbox  # noqa: E402

PASSWORD = "a-long-test-password"


@pytest.fixture(scope="module")
def postgres_url() -> Iterator[str]:
    container = PostgresContainer("postgres:16", driver=None).with_command("-c fsync=off")
    with container as server:
        host = server.get_container_host_ip()
        port = server.get_exposed_port(5432)
        yield (
            f"postgresql+psycopg://{server.username}:{server.password}"
            f"@{host}:{port}/{server.dbname}"
        )


@pytest.fixture
def live_app(postgres_url: str) -> Iterator[TestClient]:
    """The real application with two Users, Alice (the Admin) and Bea, and
    nobody signed in."""
    app = create_app(Settings(database_url=postgres_url))
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


def mint_api_token(test_client: TestClient, username: str) -> str:
    """What a User does in Settings before asking the admin for a pod: sign in
    with their password and create a token (a token cannot mint another)."""
    test_client.cookies.clear()
    login = test_client.post("/api/v1/auth/login", json={"login": username, "password": PASSWORD})
    assert login.status_code == 204, login.text
    created = test_client.post("/api/v1/auth/me/tokens", json={"name": "MCP pod"})
    assert created.status_code == 201, created.text
    test_client.cookies.clear()
    return str(created.json()["token"])


def pod(test_client: TestClient, api_token: str) -> Toolbox:
    """One User's MCP server: the shared client over a transport wrapping the
    live app, holding only that User's API token."""

    def handler(request: httpx.Request) -> httpx.Response:
        # Only the credential the MCP server sends may authenticate: never a
        # cookie the test client picked up elsewhere.
        test_client.cookies.clear()
        path = request.url.path
        if request.url.query:
            path += f"?{request.url.query.decode()}"
        response = test_client.request(
            request.method, path, content=request.content, headers=dict(request.headers)
        )
        return httpx.Response(
            response.status_code, headers=dict(response.headers), content=response.content
        )

    client = Client("http://testserver", transport=httpx.MockTransport(handler))
    return Toolbox(client, TokenSession(api_token))


def call(box: Toolbox, name: str, arguments: dict[str, Any]) -> tuple[bool, Any]:
    """A `tools/call` over JSON-RPC: (is_error, the tool's text payload)."""
    response = handle(
        box,
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        },
    )
    assert response is not None
    result = response["result"]
    text = result["content"][0]["text"]
    if result.get("isError"):
        return True, text
    return False, json.loads(text)


def test_a_second_users_mcp_server_sees_only_that_users_data(live_app: TestClient) -> None:
    alice = pod(live_app, mint_api_token(live_app, "alice"))
    bea = pod(live_app, mint_api_token(live_app, "bea"))

    failed, alices_task = call(alice, "create_task", {"title": "Alice plan"})
    assert not failed, alices_task
    failed, beas_task = call(bea, "create_task", {"title": "Bea plan"})
    assert not failed, beas_task

    failed, found = call(bea, "search_tasks", {"query": "plan"})
    assert not failed, found
    assert [t["title"] for t in found["tasks"]] == ["Bea plan"]

    failed, message = call(bea, "get_task", {"task_id": alices_task["id"]})
    assert failed
    assert "not found" in message
    assert "Alice" not in message

    # And the first User's pod still sees only theirs.
    failed, found = call(alice, "search_tasks", {"query": "plan"})
    assert not failed, found
    assert [t["title"] for t in found["tasks"]] == ["Alice plan"]
