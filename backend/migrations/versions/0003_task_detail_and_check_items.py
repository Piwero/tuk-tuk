"""task detail: description, priority, check items

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "check_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks.id"), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("done", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_check_items_task_id", "check_items", ["task_id"])
    with op.batch_alter_table("tasks") as batch:
        batch.add_column(sa.Column("description", sa.Text(), nullable=False, server_default=""))
        batch.add_column(
            sa.Column("priority", sa.String(length=6), nullable=False, server_default="none")
        )


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch:
        batch.drop_column("priority")
        batch.drop_column("description")
    op.drop_index("ix_check_items_task_id", table_name="check_items")
    op.drop_table("check_items")
