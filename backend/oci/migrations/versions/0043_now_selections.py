"""now_selections

Issue #547: the one Task a User chose as Now in Today, and whether the
Now panel is shown. Its own owned table (one row per User, created on
first write), so saving the selection never overwrites another setting.
Now is off by default: no row, or a row with `enabled` false.

No downgrade, like 0035-0042 before it: restore the pre-upgrade backup.

Revision ID: 0043
Revises: 0042
Create Date: 2026-11-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0043"
down_revision: str | None = "0042"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "now_selections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "task_id",
            sa.Integer(),
            sa.ForeignKey("tasks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint("owner_id"),
    )
    op.create_index("ix_now_selections_owner_id", "now_selections", ["owner_id"])


def downgrade() -> None:
    raise NotImplementedError(
        "0043 has no downgrade: restore the database backup taken before upgrading."
    )
