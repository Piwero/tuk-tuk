"""Retain Task acceptance receipts after hard deletion.

Revision ID: 0059_task_creation_receipts
Revises: 0058_task_idempotency
"""

import sqlalchemy as sa
from alembic import op

revision = "0059_task_creation_receipts"
down_revision = "0058_task_idempotency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_creations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.UniqueConstraint("owner_id", "request_id"),
    )
    op.execute(
        "INSERT INTO task_creations (owner_id, request_id, task_id) "
        "SELECT owner_id, create_request_id, id FROM tasks WHERE create_request_id IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_table("task_creations")
