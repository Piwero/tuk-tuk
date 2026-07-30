"""Shared fixtures: each test boots the real app against a throwaway SQLite file."""

import os

from argon2 import PasswordHasher
from argon2.low_level import Type

# Minimal Argon2 cost parameters so verification costs microseconds, not the
# ~200ms tuned for production (see app.auth). Set before the first import of
# app.config/app.main below, so the module-level `app` singleton and every
# ad-hoc `Settings(...)` construction across the suite pick it up too — the
# app fails closed without a password hash, and this is the one place that
# needs to know about test hashing cost.
TEST_PASSWORD = "test-password"

os.environ.setdefault(
    "AUTH_PASSWORD_HASH",
    PasswordHasher(time_cost=1, memory_cost=64, parallelism=1, type=Type.ID).hash(TEST_PASSWORD),
)
os.environ.setdefault("AUTH_COOKIE_SECURE", "false")
os.environ.setdefault("SECRET_KEY", "test-signing-key")
# The delay is exercised (LoginThrottle still runs) but costs no wall-clock
# time, so the escalation/reset tests don't sleep for real.
os.environ.setdefault("AUTH_LOGIN_DELAY_SECONDS", "0")

from collections.abc import Iterator  # noqa: E402
from datetime import UTC, datetime, timedelta  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402


class FakeClock:
    """A settable clock for driving session expiry and reissue in tests
    without sleeps or backdated tokens — see app.session.Clock.
    """

    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, delta: timedelta) -> None:
        self.now += delta


@pytest.fixture
def database_url(tmp_path: Path) -> str:
    return f"sqlite+aiosqlite:///{tmp_path / 'test.db'}"


@pytest.fixture
def fake_clock() -> FakeClock:
    return FakeClock(datetime.now(UTC))


@pytest.fixture
def unauthenticated_client(database_url: str, fake_clock: FakeClock) -> Iterator[TestClient]:
    app = create_app(Settings(database_url=database_url), clock=fake_clock)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def client(unauthenticated_client: TestClient) -> TestClient:
    """Logs in before yielding so every pre-existing test file exercises
    authenticated requests without edits — each becomes an incidental test
    that the session gate lets a real session through.
    """
    response = unauthenticated_client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})
    assert response.status_code == 204, response.text
    return unauthenticated_client


def make_task(client: TestClient, title: str, **fields: object) -> dict:
    """Create a task over the API and return its JSON body."""
    response = client.post("/api/v1/tasks", json={"title": title, **fields})
    assert response.status_code == 201, response.text
    return response.json()
