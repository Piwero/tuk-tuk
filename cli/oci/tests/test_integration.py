"""The integration tests: boot the real application in-process against a
throwaway database — as the backend suite's shared fixture does — and drive
the real entrypoint with a transport wrapping that application. The first:
login followed by an authenticated read, proving the real cookie is accepted
on a subsequent request; the session file is the only bridge between the two
entrypoint invocations. The second: two Users, each with their own CLI
config, see only their own data (ADR 0018).
"""

import json
import os
from collections.abc import Callable, Iterator
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
from app.models import User  # noqa: E402
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
                User(
                    username=TEST_USERNAME,
                    email="admin@example.com",
                    password_hash=password_hash,
                    is_admin=True,
                ),
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
    emits is served by the live app, cookies and all. Only the credential
    the CLI itself sends authenticates: the test client's own cookie jar is
    emptied first, so a session it picked up elsewhere never leaks in."""

    def handler(request: httpx.Request) -> httpx.Response:
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

    return httpx.MockTransport(handler)


def test_login_then_read_against_real_app(
    live_client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    task_id = live_client.post("/api/v1/tasks", json={"title": "Tracer bullet"}).json()["id"]

    config_dir = tmp_path / "config"
    monkeypatch.setenv("TUK_CONFIG_DIR", str(config_dir))
    monkeypatch.setattr("builtins.input", lambda _prompt: TEST_USERNAME)
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


@pytest.fixture
def two_users(postgres_url: str) -> Iterator[TestClient]:
    """The real application with two more Users, Alice and Bea, and nobody
    signed in."""
    app = create_app(Settings(database_url=postgres_url))
    password_hash = PasswordHasher(time_cost=1, memory_cost=64, parallelism=1, type=Type.ID).hash(
        TEST_PASSWORD
    )

    async def create_users() -> None:
        async with app.state.session_factory() as session:
            for username in ("alice", "bea"):
                await create_user(
                    session,
                    User(
                        username=username,
                        email=f"{username}@example.com",
                        password_hash=password_hash,
                    ),
                )
            await session.commit()

    with TestClient(app) as test_client:
        asyncio.run(create_users())
        yield test_client


def tuk_as(
    username: str,
    test_client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> Callable[..., tuple[int, str, str]]:
    """`tuk login` as one User into their own config directory; returns a
    function running further `tuk` commands as them: (exit code, stdout,
    stderr)."""
    monkeypatch.setenv("TUK_CONFIG_DIR", str(tmp_path / username))
    monkeypatch.setattr("builtins.input", lambda _prompt: username)
    monkeypatch.setattr("getpass.getpass", lambda _prompt: TEST_PASSWORD)
    assert main(["login"], transport=app_transport(test_client)) == 0
    capsys.readouterr()

    def tuk(*argv: str) -> tuple[int, str, str]:
        monkeypatch.setenv("TUK_CONFIG_DIR", str(tmp_path / username))
        code = main(list(argv), transport=app_transport(test_client))
        captured = capsys.readouterr()
        return code, captured.out, captured.err

    return tuk


def test_a_second_users_cli_sees_only_that_users_data(
    two_users: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    alice = tuk_as("alice", two_users, tmp_path, monkeypatch, capsys)
    code, out, _ = alice("add", "--json", "Alice plan")
    assert code == 0, out
    alices_task_id = json.loads(out)["id"]

    bea = tuk_as("bea", two_users, tmp_path, monkeypatch, capsys)
    code, out, _ = bea("add", "--json", "Bea plan")
    assert code == 0, out

    code, out, _ = bea("ls", "--json", "--search", "plan")
    assert code == 0, out
    assert [t["title"] for t in json.loads(out)["items"]] == ["Bea plan"]

    code, _, err = bea("show", str(alices_task_id))
    assert code == 1
    assert f"Task {alices_task_id} not found." in err

    # Alice's own CLI session still works and still sees only hers.
    code, out, _ = alice("ls", "--json", "--search", "plan")
    assert code == 0, out
    assert [t["title"] for t in json.loads(out)["items"]] == ["Alice plan"]
