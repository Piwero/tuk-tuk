"""task_planned_work

Issue #558: an optional planned work block on a Task — reserved work time
held apart from the Task's start/due dates. Four nullable columns on
`tasks` (at most one block per Task): the start instant, a positive
duration in minutes, the IANA timezone the block was planned in, and an
optional buffer after. All null means "no plan"; older clients that never
send the field leave it untouched.

The revision id carries the table name, not a bare number, so parallel
phase-3 tickets don't collide; it follows 0049_habit_pauses.

No downgrade, like 0035-0049 before it: restore the pre-upgrade backup.

Revision ID: 0050_task_planned_work
Revises: 0049_habit_pauses
Create Date: 2026-11-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0050_task_planned_work"
down_revision: str | None = "0049_habit_pauses"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("planned_start", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("planned_duration_minutes", sa.Integer(), nullable=True))
    op.add_column("tasks", sa.Column("planned_time_zone", sa.String(64), nullable=True))
    op.add_column("tasks", sa.Column("planned_buffer_minutes", sa.Integer(), nullable=True))


def downgrade() -> None:
    raise NotImplementedError(
        "0050_task_planned_work has no downgrade: restore the database backup taken before upgrading."
    )
