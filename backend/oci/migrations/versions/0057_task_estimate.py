"""task_estimate

Review fix for issue #563: an optional duration estimate on a Task, in
minutes, used only for work planning (#535). Nullable and empty for every
existing Task: nothing is inferred.

No downgrade, like 0035-0056 before it: restore the pre-upgrade backup.

Revision ID: 0057_task_estimate
Revises: 0056_reminder_opt_in_at
Create Date: 2026-11-26

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0057_task_estimate"
down_revision: str | None = "0056_reminder_opt_in_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("estimate_minutes", sa.Integer(), nullable=True))


def downgrade() -> None:
    raise NotImplementedError(
        "0057_task_estimate has no downgrade: restore the database backup taken before upgrading."
    )
