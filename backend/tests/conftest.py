"""Shared fixtures: each test boots the real app against a throwaway SQLite file."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


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
