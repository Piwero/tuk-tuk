"""stand-up entries and bullets

Revision ID: 0019
Revises: 0018
Create Date: 2026-08-11

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "standup_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("date", sa.Date(), nullable=False, index=True),
        sa.Column("sprint_goal_snapshot", sa.Text(), nullable=False),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("date", "owner"),
    )
    op.create_table(
        "standup_bullets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "entry_id",
            sa.Integer(),
            sa.ForeignKey("standup_entries.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("section", sa.String(length=9), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("standup_bullets")
    op.drop_table("standup_entries")
