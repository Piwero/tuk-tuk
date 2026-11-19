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
    def scheme(self) -> str:
        return self._parts.scheme

    @property
    def is_supported_postgres(self) -> bool:
        """Scheme/host check only — no network I/O. Guards the connection
        probe so a malformed URL never reaches psycopg."""
        return self._parts.scheme in _POSTGRES_SCHEMES and bool(self._parts.hostname)

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


def require_database_url(database_url: str | None) -> str:
    """The app's own `DATABASE_URL`, checked before anything connects
    (issue #407). PostgreSQL through psycopg3 is the only engine: the same
    `postgresql+psycopg://` string drives the async app and sync Alembic
    (ADR 0013). Fails closed with the variable named — the APP_MASTER_KEY
    posture — rather than a driver traceback at the first query.
    """
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is not configured. The app refuses to start without it: set it "
            "to postgresql+psycopg://user:password@host:5432/dbname in your .env or "
            "1Password item."
        )
    scheme = DatabaseUrl(database_url).scheme
    if scheme.startswith("sqlite"):
        raise RuntimeError(
            "DATABASE_URL points at SQLite, and SQLite is no longer supported. Move the "
            "data to PostgreSQL first — see docs/self-hosting/upgrade.md — then set "
            "DATABASE_URL to its postgresql+psycopg:// URL."
        )
    if scheme != "postgresql+psycopg":
        raise RuntimeError(
            f"DATABASE_URL must be a postgresql+psycopg:// URL, not {scheme}://. The "
            "+psycopg driver suffix is required (ADR 0013)."
        )
    return database_url


def create_engine(database_url: str) -> AsyncEngine:
    """Builds the app's engine, health-checking and recycling pooled
    connections so a server restart or idle timeout never hands a request
    a dead one (ADR 0013)."""
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
    """Upgrade the database to head. Alembic runs sync, on the same
    psycopg3 URL the app uses async."""
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(config, "head")


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    session_factory = request.app.state.session_factory
    async with session_factory() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]
