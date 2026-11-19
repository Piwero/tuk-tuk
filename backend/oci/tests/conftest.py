"""Shared fixtures: each test boots the real app against its own throwaway
PostgreSQL database."""

import os

from argon2 import PasswordHasher
from argon2.low_level import Type

# Minimal Argon2 cost parameters so verification costs microseconds, not the
# ~200ms tuned for production (see app.auth). Set before the first import of
# app.config/app.main below, so the module-level `app` singleton and every
# ad-hoc `Settings(...)` construction across the suite pick it up too. This
# is imported into the DB-backed `settings` table on each app's first boot
# (ADR 0008's upgrade path — see app.app_settings), which is what gives
# every test's `client` fixture a password to log in with without each test
# having to drive `/setup` itself.
TEST_PASSWORD = "test-password"

os.environ.setdefault(
    "AUTH_PASSWORD_HASH",
    PasswordHasher(time_cost=1, memory_cost=64, parallelism=1, type=Type.ID).hash(TEST_PASSWORD),
)
os.environ.setdefault("AUTH_COOKIE_SECURE", "false")
os.environ.setdefault("APP_MASTER_KEY", "test-master-key")
# Importing app.main builds a module-level app, which now refuses to start
# without a PostgreSQL DATABASE_URL (issue #407). Building it never
# connects, so a placeholder satisfies it; every test's own app gets the
# real per-test URL from the `database_url` fixture instead.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://unused:unused@localhost:5432/unused")
# A small but non-zero base: the login path no longer sleeps (issue #339),
# so this costs no wall-clock time, but a zero base would mean the lockout
# itself never engages (LoginThrottle.lock_until(base_seconds=0) == now).
os.environ.setdefault("AUTH_LOGIN_DELAY_SECONDS", "0.001")

import asyncio  # noqa: E402
import itertools  # noqa: E402
from collections.abc import Iterator, Sequence  # noqa: E402
from datetime import UTC, datetime, timedelta  # noqa: E402
from typing import Any  # noqa: E402

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from testcontainers.postgres import PostgresContainer  # noqa: E402

from app.app_settings import get_app_settings  # noqa: E402
from app.calendar_source import (  # noqa: E402
    CalendarEventEntry,
    CalendarListEntry,
    CalendarSourceError,
    ExchangedCredential,
    RefreshedAccessToken,
)
from app.config import Settings  # noqa: E402
from app.db import DatabaseUrl, run_migrations  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import AppSettings  # noqa: E402


def app_settings_row(app: FastAPI) -> AppSettings:
    """Synchronously fetches the DB-backed `settings` singleton for a
    test's app. Tests that need the real session-signing key — forging a
    cookie, asserting rotation — can't read it off `Settings` anymore now
    that it lives in the database (ADR 0008), so they fetch the row
    directly instead.
    """
    session_factory = app.state.session_factory

    async def _fetch() -> AppSettings:
        async with session_factory() as session:
            row = await get_app_settings(session)
            assert row is not None
            return row

    return asyncio.run(_fetch())


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


TEMPLATE_DATABASE = "tuktuk_template"


@pytest.fixture(scope="session")
def postgres_server() -> Iterator[str]:
    """One throwaway PostgreSQL server per test session (issue #407),
    started through testcontainers, so `pytest` needs Docker and nothing
    else. Durability is switched off: the server is discarded when the
    session ends, and fsync is most of what makes creating a database slow.

    Yields a `postgresql+psycopg://user:password@host:port` authority with
    no database name; append `/<name>` to address one.
    """
    container = PostgresContainer("postgres:16", driver=None).with_command(
        "-c fsync=off -c synchronous_commit=off -c full_page_writes=off"
    )
    with container as server:
        host = server.get_container_host_ip()
        port = server.get_exposed_port(5432)
        yield f"postgresql+psycopg://{server.username}:{server.password}@{host}:{port}"


@pytest.fixture(scope="session")
def migrated_template_db(postgres_server: str) -> str:
    """Run the full Alembic chain once per session into a template database,
    so each test starts from a cheap clone of it rather than replaying every
    migration (see issue #113). The chain itself is still exercised
    end-to-end — see test_migrations.py, which runs it in isolation.
    """
    run_sql(f"{postgres_server}/postgres", f'CREATE DATABASE "{TEMPLATE_DATABASE}"')
    run_migrations(f"{postgres_server}/{TEMPLATE_DATABASE}")
    return TEMPLATE_DATABASE


_test_database_ids = itertools.count(1)


def fresh_database(postgres_server: str, *, template: str = "template0") -> str:
    """Creates a new, uniquely named database and returns its URL. Cloned
    from `template` — pass the migrated template for a ready schema, or
    keep the default for a truly empty database (migration tests).

    Never dropped: the whole server is discarded at session end, and
    dropping costs ~20x what cloning does (measured for #407).
    """
    name = f"test_{next(_test_database_ids)}"
    run_sql(f"{postgres_server}/postgres", f'CREATE DATABASE "{name}" TEMPLATE "{template}"')
    return f"{postgres_server}/{name}"


@pytest.fixture
def database_url(postgres_server: str, migrated_template_db: str) -> str:
    return fresh_database(postgres_server, template=migrated_template_db)


def run_sql(database_url: str, query: str, params: Sequence[object] = ()) -> list[tuple[Any, ...]]:
    """Runs one statement straight against a test database, outside the
    app — for asserting what is actually stored (an encrypted column, a
    cascade's leftovers) or arranging state no endpoint can write.
    Autocommits; returns the result rows, or `[]` for a statement without
    any.
    """
    with psycopg.connect(DatabaseUrl(database_url).psycopg_url, autocommit=True) as connection:
        cursor = connection.execute(query, params)
        return cursor.fetchall() if cursor.description else []


@pytest.fixture
def fake_clock() -> FakeClock:
    return FakeClock(datetime.now(UTC))


class FakeCalendarSource:
    """A fake CalendarSource (issue #105), injected through the application
    factory alongside the settable clock — the same pattern used to drive
    session expiry without sleeping. Tests register what an authorization
    code exchanges to; nothing above this seam ever speaks Google's
    vocabulary or touches the network.
    """

    def __init__(self) -> None:
        # Set by `configure` (issue #117) — recorded so a test can assert
        # Settings' credentials save actually reached the calendar source,
        # not just the DB row.
        self.client_id = ""
        self.client_secret = ""
        self._codes: dict[str, ExchangedCredential] = {}
        self._calendars: dict[str, list[CalendarListEntry]] = {}
        self._events: dict[tuple[str, str], list[CalendarEventEntry]] = {}
        self._refresh_errors: dict[str, Exception] = {}
        self._list_events_errors: dict[tuple[str, str], Exception] = {}
        # Every refresh_token a `refresh` call was actually made for — lets a
        # test assert a credential refresh was (or wasn't) re-issued, e.g. to
        # prove a fully-cached account's Events read skips it (issue #109).
        self.refresh_calls: list[str] = []
        self.list_events_calls: list[tuple[str, str, str]] = []

    def configure(self, client_id: str, client_secret: str) -> None:
        self.client_id = client_id
        self.client_secret = client_secret

    def register_code(
        self, code: str, *, google_account_id: str, email: str, refresh_token: str
    ) -> None:
        self._codes[code] = ExchangedCredential(
            google_account_id=google_account_id, email=email, refresh_token=refresh_token
        )

    async def exchange_code(self, code: str, redirect_uri: str) -> ExchangedCredential:
        try:
            return self._codes[code]
        except KeyError:
            raise CalendarSourceError(f"Unrecognized authorization code: {code}") from None

    def register_refresh_error(self, refresh_token: str, error: Exception) -> None:
        """The next (and every subsequent) `refresh` for this token raises
        `error` instead of minting an access token — simulates a revoked
        grant (TerminalCalendarSourceError) or a transient failure
        (TransientCalendarSourceError), issue #109."""
        self._refresh_errors[refresh_token] = error

    def clear_refresh_error(self, refresh_token: str) -> None:
        """Undoes `register_refresh_error` — simulates the underlying
        problem (e.g. a disabled API, since re-enabled) going away without
        the user having gone through a fresh OAuth consent."""
        self._refresh_errors.pop(refresh_token, None)

    async def refresh(self, refresh_token: str) -> RefreshedAccessToken:
        self.refresh_calls.append(refresh_token)
        error = self._refresh_errors.get(refresh_token)
        if error is not None:
            raise error
        return RefreshedAccessToken(access_token=f"access-for-{refresh_token}")

    def register_calendars(self, refresh_token: str, entries: list[CalendarListEntry]) -> None:
        """The calendars `list_calendars` returns for the access token that
        `refresh_token` resolves to (see `refresh` above)."""
        self._calendars[f"access-for-{refresh_token}"] = entries

    async def list_calendars(self, access_token: str) -> list[CalendarListEntry]:
        return self._calendars.get(access_token, [])

    def register_events(
        self, refresh_token: str, google_calendar_id: str, entries: list[CalendarEventEntry]
    ) -> None:
        """The Events `list_events` returns for the access token that
        `refresh_token` resolves to, on the named calendar."""
        self._events[(f"access-for-{refresh_token}", google_calendar_id)] = entries

    def register_list_events_error(
        self, refresh_token: str, google_calendar_id: str, error: Exception
    ) -> None:
        """The next `list_events` call on this calendar, for the access
        token that `refresh_token` resolves to, raises `error` instead of
        answering a list (issue #109)."""
        self._list_events_errors[(f"access-for-{refresh_token}", google_calendar_id)] = error

    async def list_events(
        self, access_token: str, google_calendar_id: str, time_min: str, time_max: str
    ) -> list[CalendarEventEntry]:
        # Every window a caller actually requested — lets a test assert the
        # exact timeMin/timeMax sent to Google, e.g. that a caller's local
        # timezone was converted to the right UTC instant range, without
        # depending on this fake filtering by it (it doesn't; Google does).
        self.list_events_calls.append((google_calendar_id, time_min, time_max))
        error = self._list_events_errors.get((access_token, google_calendar_id))
        if error is not None:
            raise error
        return self._events.get((access_token, google_calendar_id), [])


@pytest.fixture
def fake_calendar_source() -> FakeCalendarSource:
    return FakeCalendarSource()


@pytest.fixture
def unauthenticated_client(
    database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
) -> Iterator[TestClient]:
    app = create_app(
        Settings(database_url=database_url), clock=fake_clock, calendar_source=fake_calendar_source
    )
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
