"""habit_pauses

Issue #559: a Habit pause, an explicit date interval (open-ended when
`end_date` is null) whose days are neither done nor missed. Its own owned
table under `habits`, so existing Habit and Check-in rows are untouched and
old readers keep working.

The revision id carries the table name, not a bare number, so tickets of
the same phase that also branch from 0047 can be re-chained without a
clash.

No downgrade, like 0035-0047 before it: restore the pre-upgrade backup.

Revision ID: 0048_habit_pauses
Revises: 0047
Create Date: 2026-11-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0048_habit_pauses"
down_revision: str | None = "0047"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "habit_pauses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "habit_id",
            sa.Integer(),
            sa.ForeignKey("habits.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
    )
    op.create_index("ix_habit_pauses_owner_id", "habit_pauses", ["owner_id"])
    op.create_index("ix_habit_pauses_habit_id", "habit_pauses", ["habit_id"])


def downgrade() -> None:
    raise NotImplementedError(
        "0048_habit_pauses has no downgrade: restore the database backup taken before upgrading."
    )
