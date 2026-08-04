"""Runs the real Alembic chain against an empty database, independent of the
session-scoped template cache in conftest.py — so a broken migration is still
caught even though other tests start from a pre-migrated file copy (#113).
"""

import sqlite3
from pathlib import Path

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
