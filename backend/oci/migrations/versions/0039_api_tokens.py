"""api_tokens

Multi-user, isolation only (issue #405, ticket #413). A User's API tokens:
named, personal credentials for clients that cannot log in with a password
(the MCP server's HTTP mode). Owned rows like any other (`owner_id`), so
the central owner filter (ADR 0018) keeps each User's tokens their own.
Only a SHA-256 hash of each token is stored, unique, so a presented token
is found by its hash.

No downgrade, like 0035-0038 before it: restore the pre-upgrade backup.

Revision ID: 0039
Revises: 0038
Create Date: 2026-11-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0039"
down_revision: str | None = "0038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "api_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("prefix", sa.String(32), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_api_tokens_owner_id", "api_tokens", ["owner_id"])


def downgrade() -> None:
    raise NotImplementedError(
        "0039 has no downgrade: restore the database backup taken before upgrading."
    )
