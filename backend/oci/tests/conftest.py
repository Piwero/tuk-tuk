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
os.environ.setdefault(
    "AUTH_PASSWORD_HASH",
    PasswordHasher(time_cost=1, memory_cost=64, parallelism=1, type=Type.ID).hash("test-password"),
)
os.environ.setdefault("AUTH_COOKIE_SECURE", "false")

from collections.abc import Iterator  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture
def database_url(tmp_path: Path) -> str:
    return f"sqlite+aiosqlite:///{tmp_path / 'test.db'}"


@pytest.fixture
def client(database_url: str) -> Iterator[TestClient]:
    app = create_app(Settings(database_url=database_url))
    with TestClient(app) as test_client:
        yield test_client


def make_task(client: TestClient, title: str, **fields: object) -> dict:
    """Create a task over the API and return its JSON body."""
    response = client.post("/api/v1/tasks", json={"title": title, **fields})
    assert response.status_code == 201, response.text
    return response.json()
