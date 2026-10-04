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

TEST_PASSWORD = "test-password"

os.environ.setdefault(
    "AUTH_PASSWORD_HASH",
    PasswordHasher(time_cost=1, memory_cost=64, parallelism=1, type=Type.ID).hash(TEST_PASSWORD),
)
os.environ.setdefault("AUTH_COOKIE_SECURE", "false")
os.environ.setdefault("APP_MASTER_KEY", "test-master-key")
os.environ.setdefault("AUTH_LOGIN_DELAY_SECONDS", "0")

import httpx  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from tuk.cli import main  # noqa: E402


@pytest.fixture
def live_client(tmp_path: Path) -> Iterator[TestClient]:
    db_path = tmp_path / "test.db"
    app = create_app(Settings(database_url=f"sqlite+aiosqlite:///{db_path}"))
    with TestClient(app) as test_client:
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


def test_login_then_show_against_real_app(
    live_client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    login = live_client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})
    assert login.status_code == 204, login.text
    task_id = live_client.post("/api/v1/tasks", json={"title": "Tracer bullet"}).json()["id"]

    config_dir = tmp_path / "config"
    monkeypatch.setenv("TUK_CONFIG_DIR", str(config_dir))
    monkeypatch.setattr("getpass.getpass", lambda _prompt: TEST_PASSWORD)

    assert main(["login"], transport=app_transport(live_client)) == 0
    assert main(["show", str(task_id)], transport=app_transport(live_client)) == 0

    assert TEST_PASSWORD not in (config_dir / "tuk" / "session.json").read_text()
