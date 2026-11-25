"""quiet hours

Issue #567: a per-User band of the day during which Reminder notifications
are held back, separate from Active hours. Off for every existing User, so
delivery is unchanged after upgrade.

No downgrade, like 0035-0053 before it: restore the pre-upgrade backup.

Revision ID: 0054_quiet_hours
Revises: 0053_reminder_snoozes
Create Date: 2026-11-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0054_quiet_hours"
down_revision: str | None = "0053_reminder_snoozes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column("quiet_hours_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "user_settings",
        sa.Column("quiet_hours_start", sa.String(5), nullable=False, server_default="22:00"),
    )
    op.add_column(
        "user_settings",
        sa.Column("quiet_hours_end", sa.String(5), nullable=False, server_default="07:00"),
    )
