"""Add per-User request key to Tasks for replay-safe accepted drafts.

Revision ID: 0058_task_idempotency
Revises: 0057_task_estimate
"""

import sqlalchemy as sa
from alembic import op

revision = "0058_task_idempotency"
down_revision = "0057_task_estimate"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("create_request_id", sa.String(length=36), nullable=True))
    op.create_index(
        "uq_tasks_owner_create_request_id",
        "tasks",
        ["owner_id", "create_request_id"],
        unique=True,
        postgresql_where=sa.text("create_request_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_tasks_owner_create_request_id", table_name="tasks")
    op.drop_column("tasks", "create_request_id")
