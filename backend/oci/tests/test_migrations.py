"""Runs the real Alembic chain against an empty database, independent of the
session-scoped template cache in conftest.py — so a broken migration is still
caught even though other tests start from a pre-migrated clone (#113).

Foreign keys need no separate check after an upgrade: PostgreSQL enforces
them on every write, so a migration that broke one fails the upgrade itself.
"""

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from app.db import BACKEND_DIR, run_migrations
from tests.conftest import fresh_database, run_sql

SEED_LIST = (
    "INSERT INTO lists (id, name, is_inbox, is_archived, sort_order, view_mode, owner, "
    "created_at) VALUES (1, 'Inbox', true, false, 0, 'list', 'local', '2026-01-01T00:00:00+00:00')"
)
SEED_TASK = (
    "INSERT INTO tasks (id, title, completed, description, priority, is_all_day, "
    "reminders, list_id, sort_order, owner, created_at) VALUES "
    "(1, 'Write code', false, '', 'none', false, '[]', 1, 0, 'local', "
    "'2026-01-01T00:00:00+00:00')"
)
SEED_SPRINT_GOAL = (
    "INSERT INTO sprint_goals (id, text, owner, created_at, updated_at) VALUES "
    "(1, 'Ship v2', 'local', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')"
)
SEED_STANDUP_ENTRY = (
    "INSERT INTO standup_entries (id, date, sprint_goal_snapshot, owner, created_at) "
    "VALUES (1, '2026-01-05', 'An old snapshot', 'local', '2026-01-05T00:00:00+00:00')"
)


@pytest.fixture
def empty_database_url(postgres_server: str) -> str:
    return fresh_database(postgres_server)


def alembic_config(database_url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def table_names(database_url: str) -> set[str]:
    rows = run_sql(
        database_url,
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    )
    return {name for (name,) in rows}


def test_run_migrations_applies_full_chain_from_empty_database(empty_database_url: str) -> None:
    run_migrations(empty_database_url)

    head = ScriptDirectory.from_config(alembic_config(empty_database_url)).get_current_head()
    assert run_sql(empty_database_url, "SELECT version_num FROM alembic_version") == [(head,)]


def test_0026_goals_migration_upgrade_preserves_existing_rows_and_fks(
    empty_database_url: str,
) -> None:
    """Upgrades a database seeded at 0025 (pre-Goals) with real Task/List
    rows to head, and asserts the rows survive with their foreign key —
    the migration adds a new table only, it never touches an existing one
    (issue #232)."""
    config = alembic_config(empty_database_url)
    command.upgrade(config, "0025")
    run_sql(empty_database_url, SEED_LIST)
    run_sql(empty_database_url, SEED_TASK)

    command.upgrade(config, "head")

    assert run_sql(empty_database_url, "SELECT title, list_id FROM tasks WHERE id = 1") == [
        ("Write code", 1)
    ]
    assert "goals" in table_names(empty_database_url)


def test_0028_task_key_result_migration_preserves_existing_task_rows(
    empty_database_url: str,
) -> None:
    """Upgrades a database seeded at 0027 (pre-Task-FK) with a real Task row
    to head, and asserts it survives with the new key_result_id column
    nullable and unset (issue #236)."""
    config = alembic_config(empty_database_url)
    command.upgrade(config, "0027")
    run_sql(empty_database_url, SEED_LIST)
    run_sql(empty_database_url, SEED_TASK)

    command.upgrade(config, "head")

    assert run_sql(empty_database_url, "SELECT title, key_result_id FROM tasks WHERE id = 1") == [
        ("Write code", None)
    ]


def test_seed_migration_carries_sprint_goal_text_and_preserves_standup_snapshots(
    empty_database_url: str,
) -> None:
    """Upgrades a database seeded at 0029 (pre-seed-migration) with a real
    Sprint Goal and Stand-up Entries to 0030 (pre-drop, issue #238's
    contract), and asserts: the Sprint Goal text becomes a focused,
    windowless Goal with no Key Results; existing Stand-up Entries keep
    their original sprint_goal_snapshot untouched (not backfilled); and the
    sprint_goals table/row survive at this revision (issue #239 drops it,
    tested separately below)."""
    config = alembic_config(empty_database_url)
    command.upgrade(config, "0029")
    run_sql(empty_database_url, SEED_SPRINT_GOAL)
    run_sql(empty_database_url, SEED_STANDUP_ENTRY)

    command.upgrade(config, "0030")

    assert run_sql(
        empty_database_url, "SELECT title, is_focused, start_date, end_date FROM goals"
    ) == [("Ship v2", True, None, None)]
    assert run_sql(
        empty_database_url,
        "SELECT COUNT(*) FROM key_results WHERE goal_id = "
        "(SELECT id FROM goals WHERE title = 'Ship v2')",
    ) == [(0,)]
    # The pre-existing Entry keeps exactly the snapshot it was created
    # with — never backfilled from the newly-seeded Goal.
    assert run_sql(
        empty_database_url, "SELECT sprint_goal_snapshot FROM standup_entries WHERE id = 1"
    ) == [("An old snapshot",)]
    assert run_sql(empty_database_url, "SELECT text FROM sprint_goals WHERE id = 1") == [
        ("Ship v2",)
    ]


def test_drop_sprint_goal_migration_preserves_standup_snapshots(empty_database_url: str) -> None:
    """Issue #239: upgrading to head against a database containing a real
    Sprint Goal row and real Stand-up Entries drops the sprint_goals table
    while leaving standup_entries and its sprint_goal_snapshot column (the
    frozen history) fully intact. The down migration restores the table."""
    config = alembic_config(empty_database_url)
    command.upgrade(config, "0030")
    run_sql(empty_database_url, SEED_SPRINT_GOAL)
    run_sql(empty_database_url, SEED_STANDUP_ENTRY)
    snapshot_query = "SELECT sprint_goal_snapshot FROM standup_entries WHERE id = 1"

    command.upgrade(config, "head")

    assert "sprint_goals" not in table_names(empty_database_url)
    assert run_sql(empty_database_url, snapshot_query) == [("An old snapshot",)]

    command.downgrade(config, "0030")

    assert "sprint_goals" in table_names(empty_database_url)
    assert run_sql(empty_database_url, snapshot_query) == [("An old snapshot",)]


def test_seed_migration_seeds_nothing_when_no_sprint_goal_exists(empty_database_url: str) -> None:
    config = alembic_config(empty_database_url)
    command.upgrade(config, "0029")

    command.upgrade(config, "head")

    assert run_sql(empty_database_url, "SELECT COUNT(*) FROM goals") == [(0,)]
