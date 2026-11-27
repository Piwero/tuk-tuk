"""now_selection_occurrence

Issue #549: save the selected occurrence's schedule (start and due) with
the Now selection, so a recurring Task advanced in place (ADR 0003) by any
path no longer reads as Now. Existing selections get NULLs, which match a
Task with no dates; a dated Task selected before this migration is pruned
once and can simply be chosen again.

No downgrade, like 0035-0044 before it: restore the pre-upgrade backup.

Revision ID: 0045
Revises: 0044
Create Date: 2026-11-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0045"
down_revision: str | None = "0044"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "now_selections", sa.Column("task_start_date", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "now_selections", sa.Column("task_due_date", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    raise NotImplementedError(
        "0045 has no downgrade: restore the database backup taken before upgrading."
    )
