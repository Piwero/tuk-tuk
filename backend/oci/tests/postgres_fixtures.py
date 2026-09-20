"""Opt-in PostgreSQL fixture (ADR 0013, issue #254). Skips locally when no
server is configured; CI's Postgres job sets `TEST_POSTGRES_URL` to a
throwaway database on its service container. The same test file runs both
places — skipping here, exercising there — never parametrised across
engines (per #254's acceptance criteria).
"""

import os
from collections.abc import Iterator

import psycopg
import pytest

from app.db import run_migrations

TEST_POSTGRES_URL_ENV = "TEST_POSTGRES_URL"


def _sync_url(url: str) -> str:
    return url.replace("+psycopg", "").replace("postgresql+asyncpg", "postgresql")


@pytest.fixture
def postgres_url() -> Iterator[str]:
    base_url = os.environ.get(TEST_POSTGRES_URL_ENV)
    if not base_url:
        pytest.skip(f"{TEST_POSTGRES_URL_ENV} not set; skipping PostgreSQL-only test")

    # Each test gets its own throwaway database on the shared server, so
    # tests can run with no cleanup ordering concerns between them.
    db_name = f"tuktuk_test_{os.getpid()}_{id(object())}"
    admin_url = _sync_url(base_url)
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{db_name}"')

    authority = admin_url.split("://", 1)[1].split("/", 1)[0]
    test_url = f"postgresql+psycopg://{authority}/{db_name}"
    try:
        run_migrations(test_url)
        yield test_url
    finally:
        with psycopg.connect(admin_url, autocommit=True) as conn:
            conn.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = %s AND pid <> pg_backend_pid()",
                (db_name,),
            )
            conn.execute(f'DROP DATABASE IF EXISTS "{db_name}"')
