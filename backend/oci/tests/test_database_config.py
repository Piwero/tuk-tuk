"""`DATABASE_URL` is required and must name PostgreSQL (issue #407): the
app refuses to start otherwise, naming the variable — the same fail-closed
posture as APP_MASTER_KEY, rather than a driver traceback at first query.
"""

import pytest

from app.config import Settings
from app.main import create_app


def test_app_refuses_to_start_without_a_database_url() -> None:
    with pytest.raises(RuntimeError, match="DATABASE_URL is not configured"):
        create_app(Settings(database_url=None))


@pytest.mark.parametrize("url", ["sqlite+aiosqlite:///./tuk_tuk.db", "sqlite:////data/tuk_tuk.db"])
def test_app_refuses_a_leftover_sqlite_database_url(url: str) -> None:
    """An install upgraded from SQLite still carrying its old URL gets told
    what changed, not a missing-driver error."""
    with pytest.raises(RuntimeError, match="SQLite is no longer supported"):
        create_app(Settings(database_url=url))


def test_app_refuses_a_database_url_for_another_engine() -> None:
    with pytest.raises(RuntimeError, match="postgresql\\+psycopg://"):
        create_app(Settings(database_url="mysql://user:pw@db/tuktuk"))


def test_app_starts_with_a_postgres_database_url() -> None:
    create_app(Settings(database_url="postgresql+psycopg://user:pw@db:5432/tuktuk"))
