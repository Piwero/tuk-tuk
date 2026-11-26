"""reminder_snoozes

Issue #566: snoozing a delivered Reminder. A nullable `snoozed_until` on the
delivery ledger row (ADR 0019) is the occurrence-specific override: while
set, it is that Reminder's effective fire time. Task dates and Reminder
offsets are never touched. Existing rows read null: not snoozed.

The revision id carries the change's name, so tickets of the same phase can
be re-chained without a clash.

No downgrade, like 0035-0052 before it: restore the pre-upgrade backup.

Revision ID: 0053_reminder_snoozes
Revises: 0052_habit_skips
Create Date: 2026-11-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0053_reminder_snoozes"
down_revision: str | None = "0052_habit_skips"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "reminder_deliveries",
        sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    raise NotImplementedError(
        "0053_reminder_snoozes has no downgrade: restore the database backup taken before "
        "upgrading."
    )
