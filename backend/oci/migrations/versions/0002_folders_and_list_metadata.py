"""folders and list metadata: color, emoji, archive, ordering

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "folders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("sort_order", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    with op.batch_alter_table("lists") as batch:
        batch.add_column(sa.Column("color", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("emoji", sa.String(length=16), nullable=True))
        batch.add_column(
            sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch.add_column(
            sa.Column("sort_order", sa.BigInteger(), nullable=False, server_default="0")
        )
        batch.add_column(sa.Column("folder_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_lists_folder_id_folders", "folders", ["folder_id"], ["id"])
    op.create_index("ix_lists_folder_id", "lists", ["folder_id"])
    # Preserve the pre-ordering sidebar order (by id) with sparse gaps for future drags.
    op.execute("UPDATE lists SET sort_order = id * 1024")


def downgrade() -> None:
    op.drop_index("ix_lists_folder_id", table_name="lists")
    with op.batch_alter_table("lists") as batch:
        batch.drop_column("folder_id")
        batch.drop_column("sort_order")
        batch.drop_column("is_archived")
        batch.drop_column("emoji")
        batch.drop_column("color")
    op.drop_table("folders")
