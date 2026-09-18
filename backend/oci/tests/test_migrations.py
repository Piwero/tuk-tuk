"""Runs the real Alembic chain against an empty database, independent of the
session-scoped template cache in conftest.py — so a broken migration is still
caught even though other tests start from a pre-migrated file copy (#113).
"""

import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from app.db import BACKEND_DIR, run_migrations


def test_run_migrations_applies_full_chain_from_empty_database(tmp_path: Path) -> None:
    db_path = tmp_path / "fresh.db"

    run_migrations(f"sqlite:///{db_path}")

    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    head = ScriptDirectory.from_config(config).get_current_head()

    with sqlite3.connect(db_path) as conn:
        (current,) = conn.execute("SELECT version_num FROM alembic_version").fetchone()

    assert current == head


def test_0026_goals_migration_upgrade_preserves_existing_rows_and_fks(tmp_path: Path) -> None:
    """Upgrades a database seeded at 0025 (pre-Goals) with real Task/List
    rows to head, and asserts the rows survive and foreign keys stay
    intact — the migration adds a new table only, it never touches an
    existing one (issue #232)."""
    db_path = tmp_path / "pre_goals.db"
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")

    command.upgrade(config, "0025")

    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute(
            "INSERT INTO lists (id, name, is_inbox, is_archived, sort_order, view_mode, owner, "
            "created_at) VALUES (1, 'Inbox', 1, 0, 0, 'list', 'local', '2026-01-01T00:00:00+00:00')"
        )
        conn.execute(
            "INSERT INTO tasks (id, title, completed, description, priority, is_all_day, "
            "reminders, list_id, sort_order, owner, created_at) VALUES "
            "(1, 'Write code', 0, '', 'none', 0, '[]', 1, 0, 'local', "
            "'2026-01-01T00:00:00+00:00')"
        )
        conn.commit()

    command.upgrade(config, "head")

    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        (title,) = conn.execute("SELECT title FROM tasks WHERE id = 1").fetchone()
        assert title == "Write code"
        (list_id,) = conn.execute("SELECT list_id FROM tasks WHERE id = 1").fetchone()
        assert list_id == 1
        fk_violations = conn.execute("PRAGMA foreign_key_check").fetchall()
        assert fk_violations == []
        tables = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        assert "goals" in tables


def test_0028_task_key_result_migration_preserves_existing_task_rows(tmp_path: Path) -> None:
    """Upgrades a database seeded at 0027 (pre-Task-FK) with a real Task row
    to head, and asserts it survives with the new key_result_id column
    nullable and unset (issue #236)."""
    db_path = tmp_path / "pre_task_key_result.db"
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")

    command.upgrade(config, "0027")

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO lists (id, name, is_inbox, is_archived, sort_order, view_mode, owner, "
            "created_at) VALUES (1, 'Inbox', 1, 0, 0, 'list', 'local', '2026-01-01T00:00:00+00:00')"
        )
        conn.execute(
            "INSERT INTO tasks (id, title, completed, description, priority, is_all_day, "
            "reminders, list_id, sort_order, owner, created_at) VALUES "
            "(1, 'Write code', 0, '', 'none', 0, '[]', 1, 0, 'local', "
            "'2026-01-01T00:00:00+00:00')"
        )
        conn.commit()

    command.upgrade(config, "head")

    with sqlite3.connect(db_path) as conn:
        title, key_result_id = conn.execute(
            "SELECT title, key_result_id FROM tasks WHERE id = 1"
        ).fetchone()
        assert title == "Write code"
        assert key_result_id is None
        fk_violations = conn.execute("PRAGMA foreign_key_check").fetchall()
        assert fk_violations == []


def test_seed_migration_carries_sprint_goal_text_and_preserves_standup_snapshots(
    tmp_path: Path,
) -> None:
    """Upgrades a database seeded at 0029 (pre-seed-migration) with a real
    Sprint Goal and Stand-up Entries to 0030 (pre-drop, issue #238's
    contract), and asserts: the Sprint Goal text becomes a focused,
    windowless Goal with no Key Results; existing Stand-up Entries keep
    their original sprint_goal_snapshot untouched (not backfilled); and the
    sprint_goals table/row survive at this revision (issue #239 drops it,
    tested separately below)."""
    db_path = tmp_path / "pre_seed.db"
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")

    command.upgrade(config, "0029")

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO sprint_goals (id, text, owner, created_at, updated_at) VALUES "
            "(1, 'Ship v2', 'local', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')"
        )
        conn.execute(
            "INSERT INTO standup_entries (id, date, sprint_goal_snapshot, owner, created_at) "
            "VALUES (1, '2026-01-05', 'An old snapshot', 'local', '2026-01-05T00:00:00+00:00')"
        )
        conn.commit()

    command.upgrade(config, "0030")

    with sqlite3.connect(db_path) as conn:
        goal_rows = conn.execute(
            "SELECT title, is_focused, start_date, end_date FROM goals"
        ).fetchall()
        assert goal_rows == [("Ship v2", 1, None, None)]
        (kr_count,) = conn.execute(
            "SELECT COUNT(*) FROM key_results WHERE goal_id = "
            "(SELECT id FROM goals WHERE title = 'Ship v2')"
        ).fetchone()
        assert kr_count == 0
        # The pre-existing Entry keeps exactly the snapshot it was created
        # with — never backfilled from the newly-seeded Goal.
        (snapshot,) = conn.execute(
            "SELECT sprint_goal_snapshot FROM standup_entries WHERE id = 1"
        ).fetchone()
        assert snapshot == "An old snapshot"
        (text,) = conn.execute("SELECT text FROM sprint_goals WHERE id = 1").fetchone()
        assert text == "Ship v2"


def test_drop_sprint_goal_migration_preserves_standup_snapshots(tmp_path: Path) -> None:
    """Issue #239: upgrading to head against a database containing a real
    Sprint Goal row and real Stand-up Entries drops the sprint_goals table
    while leaving standup_entries and its sprint_goal_snapshot column (the
    frozen history) fully intact. The down migration restores the table."""
    db_path = tmp_path / "drop_sprint_goal.db"
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")

    command.upgrade(config, "0030")

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO sprint_goals (id, text, owner, created_at, updated_at) VALUES "
            "(1, 'Ship v2', 'local', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')"
        )
        conn.execute(
            "INSERT INTO standup_entries (id, date, sprint_goal_snapshot, owner, created_at) "
            "VALUES (1, '2026-01-05', 'An old snapshot', 'local', '2026-01-05T00:00:00+00:00')"
        )
        conn.commit()

    command.upgrade(config, "head")

    with sqlite3.connect(db_path) as conn:
        tables = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert "sprint_goals" not in tables
        (snapshot,) = conn.execute(
            "SELECT sprint_goal_snapshot FROM standup_entries WHERE id = 1"
        ).fetchone()
        assert snapshot == "An old snapshot"

    command.downgrade(config, "0030")

    with sqlite3.connect(db_path) as conn:
        tables = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert "sprint_goals" in tables
        (snapshot,) = conn.execute(
            "SELECT sprint_goal_snapshot FROM standup_entries WHERE id = 1"
        ).fetchone()
        assert snapshot == "An old snapshot"


def test_seed_migration_seeds_nothing_when_no_sprint_goal_exists(tmp_path: Path) -> None:
    db_path = tmp_path / "no_sprint_goal.db"
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    command.upgrade(config, "0029")

    command.upgrade(config, "head")

    with sqlite3.connect(db_path) as conn:
        (count,) = conn.execute("SELECT COUNT(*) FROM goals").fetchone()
        assert count == 0
