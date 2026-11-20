"""delete rules

Issue #508, the follow-up ADR 0013 deferred until PostgreSQL was the only
engine (ADR 0017). Fourteen foreign keys were created without an
`ON DELETE` rule, because SQLite never enforced one and the routers swept
related rows by hand before each delete. PostgreSQL enforces them, so the
rule now lives in the schema:

- a dependent that means nothing without its parent goes with it
  (CASCADE): a List's Sections and Tasks, a Task's Check Items and tag
  links, a Tag's links, a Habit's Check-ins, a Goal's Key Results, a
  Stand-up Entry's Bullets;
- a row that stands on its own keeps existing with the link cleared
  (SET NULL): a List leaving a deleted Folder, a Task leaving a deleted
  Section, Focus Sessions and Timer presets outliving their Task or Habit.

The constraints' names are not uniform (the early batch migrations named
theirs `fk_<table>_<column>_<referred>`, the rest took PostgreSQL's
`<table>_<column>_fkey`), so each one is found by its column and recreated
under the name it already had.

The foreign keys to `users` are left as they are: no User is ever deleted,
and deleting one who still owns rows should be refused, not cascade away
their account.

No downgrade, like 0035-0040 before it: restore the pre-upgrade backup.

Revision ID: 0041
Revises: 0040
Create Date: 2026-11-20

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0041"
down_revision: str | None = "0040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (table, column, referred table, ON DELETE)
RULES = (
    ("lists", "folder_id", "folders", "SET NULL"),
    ("sections", "list_id", "lists", "CASCADE"),
    ("tasks", "list_id", "lists", "CASCADE"),
    ("tasks", "section_id", "sections", "SET NULL"),
    ("task_tags", "task_id", "tasks", "CASCADE"),
    ("task_tags", "tag_id", "tags", "CASCADE"),
    ("check_items", "task_id", "tasks", "CASCADE"),
    ("check_ins", "habit_id", "habits", "CASCADE"),
    ("key_results", "goal_id", "goals", "CASCADE"),
    ("focus_sessions", "task_id", "tasks", "SET NULL"),
    ("focus_sessions", "habit_id", "habits", "SET NULL"),
    ("timers", "task_id", "tasks", "SET NULL"),
    ("timers", "habit_id", "habits", "SET NULL"),
    ("standup_bullets", "entry_id", "standup_entries", "CASCADE"),
)


def constraint_name(inspector: sa.Inspector, table: str, column: str) -> str:
    for foreign_key in inspector.get_foreign_keys(table):
        if foreign_key["constrained_columns"] == [column] and foreign_key["name"]:
            return foreign_key["name"]
    raise RuntimeError(f"{table}.{column} has no foreign key to replace")


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table, column, referred, ondelete in RULES:
        name = constraint_name(inspector, table, column)
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(name, table, referred, [column], ["id"], ondelete=ondelete)


def downgrade() -> None:
    raise NotImplementedError(
        "0041 has no downgrade: restore the database backup taken before upgrading."
    )
