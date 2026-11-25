"""reminder_deliveries

Issue #561: the per-User Reminder delivery ledger (ADR 0019). One row per
Reminder of one Task occurrence an open tab claimed; the unique key on
(task_id, offset, occurrence_due) is what deduplicates delivery across
tabs. A new owned table under `tasks`, so existing rows are untouched.

The revision id carries the table name, so tickets of the same phase can be
re-chained without a clash.

No downgrade, like 0035-0050 before it: restore the pre-upgrade backup.

Revision ID: 0051_reminder_deliveries
Revises: 0050_task_planned_work
Create Date: 2026-11-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0051_reminder_deliveries"
down_revision: str | None = "0050_task_planned_work"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reminder_deliveries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "task_id",
            sa.Integer(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("offset", sa.String(32), nullable=False),
        sa.Column("occurrence_due", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fire_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("lease_token", sa.String(64), nullable=False),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reported_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("task_id", "offset", "occurrence_due"),
    )
    op.create_index("ix_reminder_deliveries_owner_id", "reminder_deliveries", ["owner_id"])
    op.create_index("ix_reminder_deliveries_task_id", "reminder_deliveries", ["task_id"])


def downgrade() -> None:
    raise NotImplementedError(
        "0051_reminder_deliveries has no downgrade: restore the database backup taken "
        "before upgrading."
    )
