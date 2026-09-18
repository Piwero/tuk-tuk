"""rename habits.goal to habits.target

Frees the name "Goal" for the Goal entity (ADR 0012). A Habit's numeric
Target is a different concept: the amount one day's Check-ins count toward.

Revision ID: 0025
Revises: 0024
Create Date: 2026-09-18

"""

from collections.abc import Sequence

from alembic import op

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("habits") as batch:
        batch.alter_column("goal", new_column_name="target")


def downgrade() -> None:
    with op.batch_alter_table("habits") as batch:
        batch.alter_column("target", new_column_name="goal")
