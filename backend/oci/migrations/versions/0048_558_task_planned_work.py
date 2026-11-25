"""task_planned_work

Issue #558: an optional planned work block on a Task — reserved work time
held apart from the Task's start/due dates. Four nullable columns on
`tasks` (at most one block per Task): the start instant, a positive
duration in minutes, the IANA timezone the block was planned in, and an
optional buffer after. All null means "no plan"; older clients that never
send the field leave it untouched.

The revision id carries the ticket number so parallel phase-3 tickets that
also branch from 0047 don't collide on "0048".

No downgrade, like 0035-0047 before it: restore the pre-upgrade backup.

Revision ID: 0048_558
Revises: 0047
Create Date: 2026-11-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0048_558"
down_revision: str | None = "0047"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("planned_start", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("planned_duration_minutes", sa.Integer(), nullable=True))
    op.add_column("tasks", sa.Column("planned_time_zone", sa.String(64), nullable=True))
    op.add_column("tasks", sa.Column("planned_buffer_minutes", sa.Integer(), nullable=True))


def downgrade() -> None:
    raise NotImplementedError(
        "0048_558 has no downgrade: restore the database backup taken before upgrading."
    )
