"""The suite's database seam (issue #407): every test gets its own
PostgreSQL database, cloned from a template migrated once per session.
These tests pin the properties the rest of the suite silently relies on.
"""

import pytest

from tests.conftest import run_sql


def test_each_test_database_is_postgres_at_the_migration_head(database_url: str) -> None:
    assert database_url.startswith("postgresql+psycopg://")
    assert run_sql(database_url, "SELECT version_num FROM alembic_version") != []


@pytest.mark.parametrize("attempt", [1, 2])
def test_writes_never_leak_between_tests(database_url: str, attempt: int) -> None:
    """Run twice: if the two runs shared a database, the second would see
    the first's user."""
    query = "SELECT id FROM users WHERE username = %s"
    assert run_sql(database_url, query, ("leak-check",)) == []

    run_sql(
        database_url,
        "INSERT INTO users (username, email) VALUES (%s, %s)",
        ("leak-check", "leak-check@example.com"),
    )

    assert len(run_sql(database_url, query, ("leak-check",))) == 1
