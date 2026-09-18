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
