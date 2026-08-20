"""assist settings

Revision ID: 0022
Revises: 0021
Create Date: 2026-08-20

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("settings", sa.Column("assist_ollama_base_url", sa.String(255), nullable=True))
    op.add_column("settings", sa.Column("assist_model", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("settings", "assist_model")
    op.drop_column("settings", "assist_ollama_base_url")
