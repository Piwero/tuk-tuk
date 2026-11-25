"""reminder notifications setting

Issue #557: a per-User flag opting in to Reminder delivery. Off for every
existing User, so stored Reminder offsets never start notifying after upgrade.

No downgrade, like 0035-0047 before it: restore the pre-upgrade backup.

Revision ID: 0048
Revises: 0047
Create Date: 2026-11-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0048"
down_revision: str | None = "0047"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column(
            "reminder_notifications_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
