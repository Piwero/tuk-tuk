"""Replay-safe ordinary Check Item creation.

Revision ID: 0058
Revises: 0057
"""

import sqlalchemy as sa
from alembic import op

revision = "0058_check_item_receipts"
down_revision = "0057_task_estimate"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "check_item_creations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("request_id", sa.String(128), nullable=False),
        sa.Column(
            "task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(500), nullable=False),
        sa.UniqueConstraint("owner_id", "request_id"),
    )


def downgrade() -> None:
    op.drop_table("check_item_creations")
