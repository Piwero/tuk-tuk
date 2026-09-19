"""section enabled settings

Revision ID: 0032
Revises: 0031
Create Date: 2026-09-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = [
    "calendar_enabled",
    "goals_enabled",
    "habits_enabled",
    "focus_enabled",
    "assistant_enabled",
]


def upgrade() -> None:
    for column in COLUMNS:
        op.add_column(
            "settings",
            sa.Column(column, sa.Boolean(), nullable=False, server_default=sa.true()),
        )


def downgrade() -> None:
    for column in COLUMNS:
        op.drop_column("settings", column)
