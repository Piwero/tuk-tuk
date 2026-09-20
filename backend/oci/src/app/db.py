"""Database base class, session dependency, and migration runner."""

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated
from urllib.parse import urlsplit

from alembic import command
from alembic.config import Config
from fastapi import Depends, Request
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.orm import DeclarativeBase

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Base(DeclarativeBase):
    pass


def create_engine(database_url: str) -> AsyncEngine:
    """Builds the app's engine. Connection pool health-checking and
    recycling (ADR 0013) only make sense for a network database — SQLite
    is a local file with no connection to go stale, so it's left at
    SQLAlchemy's defaults.
    """
    if database_url.startswith("sqlite"):
        return create_async_engine(database_url)
    return create_async_engine(database_url, pool_pre_ping=True, pool_recycle=1800)


async def check_database_reachable(engine: AsyncEngine, database_url: str) -> None:
    """Fails fast with the unreachable host named, rather than the raw
    traceback an unhandled connection error would otherwise surface — same
    posture as the `APP_MASTER_KEY` guard in app.main.
    """
    try:
        async with engine.connect():
            pass
    except OperationalError as exc:
        parsed = urlsplit(database_url.replace("+psycopg", "").replace("+aiosqlite", ""))
        host = f"{parsed.hostname}:{parsed.port}" if parsed.hostname else database_url
        raise RuntimeError(
            f"Could not reach the database at {host}. Check DATABASE_URL and that "
            "the server is running and accepting connections."
        ) from exc


def sync_migration_url(database_url: str) -> str:
    """Alembic runs on a sync driver. SQLite's async URL needs its
    `+aiosqlite` suffix stripped to fall back to the stdlib `sqlite3`
    driver; psycopg3 (ADR 0013) drives both sync and async from the same
    `postgresql+psycopg://` URL, so it passes through unchanged.
    """
    if database_url.startswith("sqlite+aiosqlite"):
        return database_url.replace("+aiosqlite", "")
    return database_url


def run_migrations(database_url: str) -> None:
    """Upgrade the database to head. Alembic runs on a sync driver."""
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.set_main_option("sqlalchemy.url", sync_migration_url(database_url))
    command.upgrade(config, "head")


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    session_factory = request.app.state.session_factory
    async with session_factory() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]
