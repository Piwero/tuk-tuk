"""settings

Revision ID: 0018
Revises: 0017
Create Date: 2026-08-06

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("session_key", sa.Text(), nullable=False),
        sa.Column("google_client_id", sa.String(length=255), nullable=True),
        sa.Column("encrypted_google_client_secret", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="settings_singleton"),
    )


def downgrade() -> None:
    op.drop_table("settings")
