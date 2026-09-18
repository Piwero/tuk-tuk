"""goal window nullable

Loosens goals.start_date/end_date to nullable (ADR 0012): the Sprint Goal
seed migration that follows creates a focused Goal with no window.

Revision ID: 0029
Revises: 0028
Create Date: 2026-09-18

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: str | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("goals") as batch:
        batch.alter_column("start_date", existing_type=sa.Date(), nullable=True)
        batch.alter_column("end_date", existing_type=sa.Date(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("goals") as batch:
        batch.alter_column("start_date", existing_type=sa.Date(), nullable=False)
        batch.alter_column("end_date", existing_type=sa.Date(), nullable=False)
