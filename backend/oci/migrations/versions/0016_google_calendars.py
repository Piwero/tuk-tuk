"""google calendars

Revision ID: 0016
Revises: 0015
Create Date: 2026-08-04

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "google_calendars",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "google_account_id",
            sa.Integer(),
            sa.ForeignKey("google_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("google_calendar_id", sa.String(length=255), nullable=False),
        sa.Column("summary", sa.String(length=255), nullable=False),
        sa.Column("color", sa.String(length=32), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("google_account_id", "google_calendar_id"),
    )
    op.create_index(
        "ix_google_calendars_google_account_id",
        "google_calendars",
        ["google_account_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_google_calendars_google_account_id", table_name="google_calendars")
    op.drop_table("google_calendars")
