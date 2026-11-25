"""planning_window

Issue #563: a per-User planning window, the band of each day the capacity
summary measures available time against. Three columns on `user_settings`,
kept apart from Active hours. Off for every existing User, prefilled
09:00-17:00.

The revision id carries the setting name, not a bare number, so parallel
phase-3 tickets don't collide.

No downgrade, like 0035-0052 before it: restore the pre-upgrade backup.

Revision ID: 0053_planning_window
Revises: 0052_habit_skips
Create Date: 2026-11-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0053_planning_window"
down_revision: str | None = "0052_habit_skips"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column(
            "planning_window_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "user_settings",
        sa.Column("planning_window_start", sa.String(5), nullable=False, server_default="09:00"),
    )
    op.add_column(
        "user_settings",
        sa.Column("planning_window_end", sa.String(5), nullable=False, server_default="17:00"),
    )


def downgrade() -> None:
    raise NotImplementedError(
        "0053_planning_window has no downgrade: restore the database backup taken before upgrading."
    )
