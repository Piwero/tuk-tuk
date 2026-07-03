"""sections and task manual ordering

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("list_id", sa.Integer(), sa.ForeignKey("lists.id"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("sort_order", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_sections_list_id", "sections", ["list_id"])
    with op.batch_alter_table("tasks") as batch:
        batch.add_column(sa.Column("section_id", sa.Integer(), nullable=True))
        batch.add_column(
            sa.Column("sort_order", sa.BigInteger(), nullable=False, server_default="0")
        )
        batch.create_foreign_key("fk_tasks_section_id_sections", "sections", ["section_id"], ["id"])
    op.create_index("ix_tasks_section_id", "tasks", ["section_id"])
    # Preserve the pre-ordering task order (by id) with sparse gaps for future drags.
    op.execute("UPDATE tasks SET sort_order = id * 1024")


def downgrade() -> None:
    op.drop_index("ix_tasks_section_id", table_name="tasks")
    with op.batch_alter_table("tasks") as batch:
        batch.drop_constraint("fk_tasks_section_id_sections", type_="foreignkey")
        batch.drop_column("sort_order")
        batch.drop_column("section_id")
    op.drop_index("ix_sections_list_id", table_name="sections")
    op.drop_table("sections")
