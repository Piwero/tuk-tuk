"""goals

Adds the Goal entity (ADR 0012): title, description, obstacle/if_then_plan
(WOOP, both nullable), window, status, focused flag, final_score, retro.
Key Results are a later slice.

Revision ID: 0026
Revises: 0025
Create Date: 2026-09-18

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "goals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("obstacle", sa.Text(), nullable=True),
        sa.Column("if_then_plan", sa.Text(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=9), nullable=False),
        sa.Column("is_focused", sa.Boolean(), nullable=False),
        sa.Column("final_score", sa.Float(), nullable=True),
        sa.Column("retro", sa.Text(), nullable=True),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("goals")
