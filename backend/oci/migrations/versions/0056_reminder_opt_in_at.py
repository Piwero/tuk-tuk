"""reminder_notifications_enabled_at

Review fix for issue #565: the missed list is bounded by the moment the User
last turned Reminder notifications on, so stored Reminder offsets never
surface as missed after an upgrade or an opt-in (#535). A User who already
has them on is bounded from the upgrade itself: nothing before it was
missed in the new sense.

No downgrade, like 0035-0055 before it: restore the pre-upgrade backup.

Revision ID: 0056_reminder_opt_in_at
Revises: 0055_planning_window
Create Date: 2026-11-26

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0056_reminder_opt_in_at"
down_revision: str | None = "0055_planning_window"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column("reminder_notifications_enabled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        "UPDATE user_settings SET reminder_notifications_enabled_at = now()"
        " WHERE reminder_notifications_enabled"
    )


def downgrade() -> None:
    raise NotImplementedError(
        "0056_reminder_opt_in_at has no downgrade: restore the database backup"
        " taken before upgrading."
    )
