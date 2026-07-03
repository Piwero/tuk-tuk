"""first-class tags: tags table and task_tags association

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tags",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False, unique=True),
        sa.Column("color", sa.String(length=32), nullable=True),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "task_tags",
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks.id"), primary_key=True),
        sa.Column("tag_id", sa.Integer(), sa.ForeignKey("tags.id"), primary_key=True),
    )
    op.create_index("ix_task_tags_tag_id", "task_tags", ["tag_id"])


def downgrade() -> None:
    op.drop_index("ix_task_tags_tag_id", table_name="task_tags")
    op.drop_table("task_tags")
    op.drop_table("tags")
