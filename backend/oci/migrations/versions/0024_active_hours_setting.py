"""active hours setting

Revision ID: 0024
Revises: 0023
Create Date: 2026-09-01

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "settings",
        sa.Column(
            "active_hours_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "settings",
        sa.Column(
            "active_hours_start",
            sa.String(5),
            nullable=False,
            server_default="09:00",
        ),
    )
    op.add_column(
        "settings",
        sa.Column(
            "active_hours_end",
            sa.String(5),
            nullable=False,
            server_default="17:00",
        ),
    )


def downgrade() -> None:
    op.drop_column("settings", "active_hours_end")
    op.drop_column("settings", "active_hours_start")
    op.drop_column("settings", "active_hours_enabled")
