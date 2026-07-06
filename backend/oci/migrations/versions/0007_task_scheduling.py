"""task scheduling: start/due dates, all-day flag, timezone

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("tasks") as batch:
        batch.add_column(sa.Column("start_date", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("due_date", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(
            sa.Column("is_all_day", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch.add_column(sa.Column("time_zone", sa.String(length=64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch:
        batch.drop_column("time_zone")
        batch.drop_column("is_all_day")
        batch.drop_column("due_date")
        batch.drop_column("start_date")
