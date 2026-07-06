"""habits and check-ins

Revision ID: 0011
Revises: 0010
Create Date: 2026-07-04

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "habits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=7), nullable=False),
        sa.Column("goal", sa.Float(), nullable=False),
        sa.Column("step", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(length=32), nullable=True),
        sa.Column("icon", sa.String(length=16), nullable=True),
        sa.Column("color", sa.String(length=32), nullable=True),
        sa.Column("encouragement", sa.String(length=255), nullable=False),
        sa.Column("frequency", sa.String(length=255), nullable=False),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "check_ins",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("habit_id", sa.Integer(), sa.ForeignKey("habits.id"), nullable=False, index=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.UniqueConstraint("habit_id", "date"),
    )


def downgrade() -> None:
    op.drop_table("check_ins")
    op.drop_table("habits")
