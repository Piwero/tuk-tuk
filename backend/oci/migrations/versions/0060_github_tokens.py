"""GitHub Tokens (issue #578, spec #576).

Revision ID: 0060_github_tokens
Revises: 0059_task_creation_receipts
"""

import sqlalchemy as sa
from alembic import op

revision = "0060_github_tokens"
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


def downgrade() -> None:
    op.drop_table("github_tokens")
