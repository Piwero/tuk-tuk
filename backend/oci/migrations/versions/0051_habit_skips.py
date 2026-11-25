"""habit_skips

Issue #564: a Habit skip, one scheduled date a User explicitly marks as not
practised — neither done nor missed. Its own owned table under `habits`,
one row per (habit, date) like a Check-in, so existing Habit, Check-in and
pause rows are untouched and old readers keep working.

No downgrade, like 0035-0050 before it: restore the pre-upgrade backup.

Revision ID: 0051_habit_skips
Revises: 0050_task_planned_work
Create Date: 2026-11-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0051_habit_skips"
down_revision: str | None = "0050_task_planned_work"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "habit_skips",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "habit_id",
            sa.Integer(),
            sa.ForeignKey("habits.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("date", sa.Date(), nullable=False),
        sa.UniqueConstraint("habit_id", "date", name="uq_habit_skips_habit_id_date"),
    )
    op.create_index("ix_habit_skips_owner_id", "habit_skips", ["owner_id"])
    op.create_index("ix_habit_skips_habit_id", "habit_skips", ["habit_id"])


def downgrade() -> None:
    raise NotImplementedError(
        "0051_habit_skips has no downgrade: restore the database backup taken before upgrading."
    )
