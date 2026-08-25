"""assistant settings

Revision ID: 0023
Revises: 0022
Create Date: 2026-08-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("settings", sa.Column("assistant_base_url", sa.String(255), nullable=True))
    op.add_column("settings", sa.Column("assistant_model", sa.String(255), nullable=True))
    op.add_column("settings", sa.Column("encrypted_assistant_api_key", sa.Text(), nullable=True))
    op.add_column("settings", sa.Column("assistant_planning_preferences", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("settings", "assistant_planning_preferences")
    op.drop_column("settings", "encrypted_assistant_api_key")
    op.drop_column("settings", "assistant_model")
    op.drop_column("settings", "assistant_base_url")
