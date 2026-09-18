"""key results

Adds the Key Result entity (ADR 0012): belongs to a Goal, carries name,
source (manual/habit_checkins/task_count), start/target/current values, an
optional source Habit link (SET NULL on Habit deletion), and sort_order.

Revision ID: 0027
Revises: 0026
Create Date: 2026-09-18

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "key_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("goal_id", sa.Integer(), sa.ForeignKey("goals.id"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("start_value", sa.Float(), nullable=False),
        sa.Column("target_value", sa.Float(), nullable=False),
        sa.Column("current_value", sa.Float(), nullable=False),
        sa.Column(
            "source_habit_id",
            sa.Integer(),
            sa.ForeignKey("habits.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("sort_order", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_key_results_goal_id", "key_results", ["goal_id"])
    op.create_index("ix_key_results_source_habit_id", "key_results", ["source_habit_id"])


def downgrade() -> None:
    op.drop_index("ix_key_results_source_habit_id", table_name="key_results")
    op.drop_index("ix_key_results_goal_id", table_name="key_results")
    op.drop_table("key_results")
