"""Database base class, session dependency, and migration runner."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path
from typing import Annotated
from urllib.parse import SplitResult, urlsplit

from alembic import command
from alembic.config import Config
from fastapi import Depends, Request
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.orm import DeclarativeBase

BACKEND_DIR = Path(__file__).resolve().parents[2]

# The only PostgreSQL spellings tuk-tuk accepts: psycopg3 (ADR 0013) drives
# both sync and async, so one URL serves Alembic and the application alike.
_POSTGRES_SCHEMES = frozenset({"postgresql", "postgresql+psycopg"})


@dataclass(frozen=True)
class DatabaseUrl:
    """A `DATABASE_URL`, parsed once. Every question the codebase asks of a
    connection string — which engine, which driver spelling Alembic or
    psycopg needs, which host to name in an error — is answered here, so no
    call site re-tests a scheme prefix or re-writes a driver suffix by hand.
    """

    raw: str

    @cached_property
    def _parts(self) -> SplitResult:
        return urlsplit(self.raw)

    @property
    def is_sqlite(self) -> bool:
        return self._parts.scheme.startswith("sqlite")

    @property
    def is_postgres(self) -> bool:
        return self._parts.scheme.startswith("postgresql")

    @property
    def is_supported_postgres(self) -> bool:
        """Scheme/host check only — no network I/O. Guards the connection
        probe so a malformed URL never reaches psycopg."""
        return self._parts.scheme in _POSTGRES_SCHEMES and bool(self._parts.hostname)

    @property
    def sync_url(self) -> str:
        """Alembic runs on a sync driver. SQLite's async URL needs its
        `+aiosqlite` suffix stripped to fall back to the stdlib `sqlite3`
        driver; psycopg3 (ADR 0013) drives both sync and async from the same
        `postgresql+psycopg://` URL, so it passes through unchanged.
        """
        if self.is_sqlite:
            return self.raw.replace("+aiosqlite", "")
        return self.raw

    @property
    def psycopg_url(self) -> str:
        """psycopg doesn't understand SQLAlchemy's `+psycopg` driver suffix."""
        return self.raw.replace("postgresql+psycopg://", "postgresql://", 1)

    @property
    def hostname(self) -> str | None:
        return self._parts.hostname

    @property
    def database(self) -> str | None:
        return self._parts.path.lstrip("/") or None

    @property
    def display_host(self) -> str:
        """Host and port for an error message. Never includes credentials."""
        host = self._parts.hostname
        if host is None:
            return self.raw
        return f"{host}:{self._parts.port}" if self._parts.port else host


class Base(DeclarativeBase):
    pass


def create_engine(database_url: str) -> AsyncEngine:
    """Builds the app's engine. Connection pool health-checking and
    recycling (ADR 0013) only make sense for a network database — SQLite
    is a local file with no connection to go stale, so it's left at
    SQLAlchemy's defaults.
    """
    if DatabaseUrl(database_url).is_sqlite:
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
        raise RuntimeError(
            f"Could not reach the database at {DatabaseUrl(database_url).display_host}. "
            "Check DATABASE_URL and that the server is running and accepting connections."
        ) from exc


def run_migrations(database_url: str) -> None:
    """Upgrade the database to head. Alembic runs on a sync driver."""
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.set_main_option("sqlalchemy.url", DatabaseUrl(database_url).sync_url)
    command.upgrade(config, "head")


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    session_factory = request.app.state.session_factory
    async with session_factory() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]
