"""gentle return setting

Issue #548: a per-User flag that collapses earlier overdue Tasks in Today.
Off for every existing User, so Today is unchanged after upgrade.

Revision ID: 0042
Revises: 0041
Create Date: 2026-11-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0042"
down_revision: str | None = "0041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column("gentle_return_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("user_settings", "gentle_return_enabled")
