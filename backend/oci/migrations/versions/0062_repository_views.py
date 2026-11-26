"""Repository Views (issue #580, spec #576).

Revision ID: 0062_repository_views
Revises: 0061_watched_repositories
"""

import sqlalchemy as sa
from alembic import op

revision = "0062_repository_views"
down_revision = "0061_watched_repositories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "repository_views",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("sort_order", sa.BigInteger(), nullable=False),
        sa.Column("author", sa.String(255), nullable=True),
        sa.Column("label", sa.String(255), nullable=True),
        sa.Column("assignee", sa.String(255), nullable=True),
        sa.Column("hide_drafts", sa.Boolean(), nullable=False),
        sa.Column("hide_bots", sa.Boolean(), nullable=False),
        sa.Column("active_tab", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_repository_views_owner_id", "repository_views", ["owner_id"])
    op.create_table(
        "repository_view_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "repository_view_id",
            sa.Integer(),
            sa.ForeignKey("repository_views.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "watched_repository_id",
            sa.Integer(),
            sa.ForeignKey("watched_repositories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.UniqueConstraint("repository_view_id", "watched_repository_id"),
    )
    op.create_index("ix_repository_view_members_owner_id", "repository_view_members", ["owner_id"])
    op.create_index(
        "ix_repository_view_members_repository_view_id",
        "repository_view_members",
        ["repository_view_id"],
    )
    op.create_index(
        "ix_repository_view_members_watched_repository_id",
        "repository_view_members",
        ["watched_repository_id"],
    )


def downgrade() -> None:
    op.drop_table("repository_view_members")
    op.drop_table("repository_views")
