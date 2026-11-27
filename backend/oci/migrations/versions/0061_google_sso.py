"""Invite-only Google sign-in (issue #586): invitations, a User's Google
login identity, and which OAuth client minted each Google Account's
refresh token.

Revision ID: 0061_google_sso
Revises: 0060_github
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0061_google_sso"
down_revision = "0060_github"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("google_subject", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("google_email", postgresql.CITEXT(), nullable=True))
    op.add_column("users", sa.Column("google_linked_at", sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint("users_google_subject_key", "users", ["google_subject"])

    # Every existing connection was made with its User's own client.
    op.add_column(
        "google_accounts",
        sa.Column("uses_shared_client", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.create_table(
        "invitations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("encrypted_token", sa.Text(), nullable=False),
        sa.Column("invited_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "accepted_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
            unique=True,
        ),
        sa.Column("delivery_state", sa.String(16), nullable=False),
        sa.Column("delivery_error", sa.String(255), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "invitations_open_email_key",
        "invitations",
        ["email"],
        unique=True,
        postgresql_where=sa.text("accepted_at IS NULL AND canceled_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_table("invitations")
    op.drop_column("google_accounts", "uses_shared_client")
    op.drop_constraint("users_google_subject_key", "users", type_="unique")
    op.drop_column("users", "google_linked_at")
    op.drop_column("users", "google_email")
    op.drop_column("users", "google_subject")
