"""drop sprint goal

Contract step (ADR 0012, issue #239): the Sprint Goal is superseded by the
focused Goal (issue #238) and its text has already been carried over
(migration 0030). Nothing reads this table anymore, so it's dropped. The
`sprint_goal_snapshot` column on `standup_entries` is untouched — it is
frozen history and stays regardless.

Revision ID: 0031
Revises: 0030
Create Date: 2026-09-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("sprint_goals")


def downgrade() -> None:
    op.create_table(
        "sprint_goals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner"),
    )
