"""GitHub: GitHub Tokens (issue #578), Watched Repositories (issue #581)
and Repository Views (issue #580) — spec #576, ADR 0020.

Revision ID: 0060_github
Revises: 0059_task_creation_receipts
"""

import sqlalchemy as sa
from alembic import op

revision = "0060_github"
down_revision = "0059_task_creation_receipts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "github_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("owner_login", sa.String(255), nullable=False),
        sa.Column("owner_kind", sa.String(16), nullable=False),
        sa.Column("encrypted_token", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("connection_state", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_id", "owner_login"),
    )
    op.create_index("ix_github_tokens_owner_id", "github_tokens", ["owner_id"])

    op.create_table(
        "watched_repositories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "github_token_id",
            sa.Integer(),
            sa.ForeignKey("github_tokens.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("github_repo_id", sa.BigInteger(), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("private", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_id", "github_repo_id"),
    )
    op.create_index("ix_watched_repositories_owner_id", "watched_repositories", ["owner_id"])
    op.create_index(
        "ix_watched_repositories_github_token_id", "watched_repositories", ["github_token_id"]
    )

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
    op.drop_table("watched_repositories")
    op.drop_table("github_tokens")
