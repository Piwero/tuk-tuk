"""The opt-in PostgreSQL job (ADR 0013, issue #254): migrations to head,
the List-delete paths foreign key enforcement affects, a core API slice,
and sequence correctness after an id-preserving insert. Skips locally
(see tests/postgres_fixtures.py); CI's postgres job exercises it.
"""

import asyncio
from datetime import UTC, datetime

from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.db import BACKEND_DIR
from app.main import create_app
from tests.conftest import TEST_PASSWORD, FakeClock

pytest_plugins = ["tests.postgres_fixtures"]


def _login(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})
    assert response.status_code == 204, response.text


def test_migrations_reach_head(postgres_url: str) -> None:
    async def _current_revision() -> str:
        engine = create_async_engine(postgres_url)
        async with engine.connect() as conn:
            result = await conn.execute(text("SELECT version_num FROM alembic_version"))
            row = result.one()
        await engine.dispose()
        return str(row[0])

    current = asyncio.run(_current_revision())
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    head = ScriptDirectory.from_config(config).get_current_head()
    assert current == head


def test_list_delete_with_sections_focus_sessions_and_timers(postgres_url: str) -> None:
    """The three scenarios that fail without #252's fix and are invisible
    to a SQLite suite (SQLite never enforces foreign keys)."""
    fake_clock = FakeClock(datetime.now(UTC))
    app = create_app(Settings(database_url=postgres_url), clock=fake_clock)
    with TestClient(app) as client:
        _login(client)
        task_list = client.post("/api/v1/lists", json={"name": "Temp"}).json()
        client.post("/api/v1/sections", json={"list_id": task_list["id"], "name": "Section A"})
        task = client.post(
            "/api/v1/tasks", json={"title": "Task", "list_id": task_list["id"]}
        ).json()
        client.post(
            "/api/v1/focus-sessions",
            json={
                "mode": "stopwatch",
                "task_id": task["id"],
                "started_at": "2024-01-01T00:00:00Z",
                "ended_at": "2024-01-01T00:30:00Z",
            },
        )
        client.post(
            "/api/v1/timers",
            json={"name": "Preset", "mode": "stopwatch", "task_id": task["id"]},
        )

        response = client.delete(f"/api/v1/lists/{task_list['id']}")
        assert response.status_code == 204, response.text


def test_core_api_slice_create_read_and_search(postgres_url: str) -> None:
    app = create_app(Settings(database_url=postgres_url), clock=FakeClock(datetime.now(UTC)))
    with TestClient(app) as client:
        _login(client)
        task_list = client.post("/api/v1/lists", json={"name": "Groceries"}).json()
        tag = client.post("/api/v1/tags", json={"name": "urgent"}).json()
        task = client.post(
            "/api/v1/tasks",
            json={"title": "Buy milk", "list_id": task_list["id"], "tag_ids": [tag["id"]]},
        ).json()
        assert task["title"] == "Buy milk"
        assert task["tags"][0]["name"] == "urgent"

        listed = client.get("/api/v1/tasks", params={"list_id": task_list["id"]})
        assert listed.status_code == 200
        assert any(t["id"] == task["id"] for t in listed.json()["items"])

        search = client.get("/api/v1/tasks", params={"search": "milk"})
        assert search.status_code == 200
        assert any(t["id"] == task["id"] for t in search.json()["items"])


def test_sequence_correct_after_explicit_id_insert(postgres_url: str) -> None:
    """Validates the engine setup, not the copy tool (#254's job) — the
    copy tool itself is what calls `setval` after a real data load (#255).
    """

    async def _insert_explicit_id() -> None:
        engine = create_async_engine(postgres_url)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as session:
            await session.execute(
                text(
                    "INSERT INTO lists (id, name, is_inbox, sort_order, owner, created_at) "
                    "VALUES (9999, 'Manual', false, 0, 'local', now())"
                )
            )
            await session.commit()
        await engine.dispose()

    asyncio.run(_insert_explicit_id())

    app = create_app(Settings(database_url=postgres_url), clock=FakeClock(datetime.now(UTC)))
    with TestClient(app) as client:
        _login(client)
        response = client.post("/api/v1/lists", json={"name": "New"})
        assert response.status_code == 201, response.text
