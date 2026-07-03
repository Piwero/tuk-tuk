"""per-list view mode

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("lists") as batch:
        batch.add_column(
            sa.Column("view_mode", sa.String(length=6), nullable=False, server_default="list")
        )


def downgrade() -> None:
    with op.batch_alter_table("lists") as batch:
        batch.drop_column("view_mode")
