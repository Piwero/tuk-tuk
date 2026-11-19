"""The one integration test: boots the real application in-process against
a throwaway database — as the backend suite's shared fixture does — and
drives the real entrypoint with a transport wrapping that application:
login followed by an authenticated read, proving the real cookie is
accepted on a subsequent request. The session file is the only bridge
between the two entrypoint invocations.
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from argon2 import PasswordHasher
from argon2.low_level import Type

TEST_USERNAME = "admin"
TEST_PASSWORD = "test-password"

os.environ.setdefault("AUTH_COOKIE_SECURE", "false")
os.environ.setdefault("APP_MASTER_KEY", "test-master-key")
os.environ.setdefault("AUTH_LOGIN_DELAY_SECONDS", "0")
# app.main builds a module-level app on import, which requires a PostgreSQL
# DATABASE_URL (backend #407). Building it never connects; the fixture's app
# gets the real one.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://unused:unused@localhost:5432/unused")

import asyncio  # noqa: E402

import httpx  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.users import create_user  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from testcontainers.postgres import PostgresContainer  # noqa: E402

from tuk.cli import main  # noqa: E402


@pytest.fixture(scope="module")
def postgres_url() -> Iterator[str]:
    """A throwaway PostgreSQL for this module, started through
    testcontainers like the backend suite's (needs Docker)."""
    container = PostgresContainer("postgres:16", driver=None).with_command("-c fsync=off")
    with container as server:
        host = server.get_container_host_ip()
        port = server.get_exposed_port(5432)
        yield (
            f"postgresql+psycopg://{server.username}:{server.password}"
            f"@{host}:{port}/{server.dbname}"
        )


@pytest.fixture
def live_client(postgres_url: str) -> Iterator[TestClient]:
    """The real application on a throwaway database, already logged in as
    its Admin — created straight in the database with a cheap hash, so the
    fixture's own setup calls are authenticated without each test driving
    first-run setup."""
    app = create_app(Settings(database_url=postgres_url))
    password_hash = PasswordHasher(time_cost=1, memory_cost=64, parallelism=1, type=Type.ID).hash(
        TEST_PASSWORD
    )

    async def create_admin() -> None:
        async with app.state.session_factory() as session:
            await create_user(
                session,
                username=TEST_USERNAME,
                email="admin@example.com",
                password_hash=password_hash,
                is_admin=True,
            )
            await session.commit()

    with TestClient(app) as test_client:
        asyncio.run(create_admin())
        login = test_client.post(
            "/api/v1/auth/login", json={"login": TEST_USERNAME, "password": TEST_PASSWORD}
        )
        assert login.status_code == 204, login.text
        yield test_client


def app_transport(test_client: TestClient) -> httpx.MockTransport:
    """A transport wrapping the real application: every request the client
    emits is served by the live app, cookies and all."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.url.query:
            path += f"?{request.url.query.decode()}"
        response = test_client.request(
            request.method, path, content=request.content, headers=dict(request.headers)
        )
        return httpx.Response(
            response.status_code, headers=dict(response.headers), content=response.content
        )

    return httpx.MockTransport(handler)


@pytest.mark.xfail(
    strict=True,
    reason="`tuk login` still sends a password only; the backend now needs a login too (#416)",
)
def test_login_then_read_against_real_app(
    live_client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    task_id = live_client.post("/api/v1/tasks", json={"title": "Tracer bullet"}).json()["id"]

    config_dir = tmp_path / "config"
    monkeypatch.setenv("TUK_CONFIG_DIR", str(config_dir))
    monkeypatch.setattr("getpass.getpass", lambda _prompt: TEST_PASSWORD)

    # Two separate entrypoint invocations, each with its own fresh transport
    # and its own cookie jar. The session file written by the first is the
    # only thing carrying the credential into the second — so the read
    # succeeding is the proof that the cookie the real application signed is
    # accepted on a later request from a client process that never saw the
    # password. This is the one thing no mock transport can establish.
    assert main(["login"], transport=app_transport(live_client)) == 0
    assert main(["show", str(task_id)], transport=app_transport(live_client)) == 0

    assert TEST_PASSWORD not in (config_dir / "tuk" / "session.json").read_text()
