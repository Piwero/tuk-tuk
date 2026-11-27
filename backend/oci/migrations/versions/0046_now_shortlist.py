"""now_shortlist

Issue #551: the Now shortlist, an ordered list of alternative Tasks per
User beside the Now selection, in its own table so writing it never
touches another preference. Each entry saves its occurrence's schedule
like the Now selection (0045).

No downgrade, like 0035-0045 before it: restore the pre-upgrade backup.

Revision ID: 0046
Revises: 0045
Create Date: 2026-11-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0046"
down_revision: str | None = "0045"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "now_shortlist_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "task_id",
            sa.Integer(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("task_start_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("task_due_date", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("owner_id", "task_id"),
    )
    op.create_index("ix_now_shortlist_items_owner_id", "now_shortlist_items", ["owner_id"])


def downgrade() -> None:
    raise NotImplementedError(
        "0046 has no downgrade: restore the database backup taken before upgrading."
    )
