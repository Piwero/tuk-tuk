"""Watched Repositories (issue #581, spec #576).

Revision ID: 0061_watched_repositories
Revises: 0060_github_tokens
"""

import sqlalchemy as sa
from alembic import op

revision = "0061_watched_repositories"
down_revision = "0060_github_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
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


def downgrade() -> None:
    op.drop_table("watched_repositories")
