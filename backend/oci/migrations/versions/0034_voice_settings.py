"""voice assistant settings

Revision ID: 0034
Revises: 0033
Create Date: 2026-11-04

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0034"
down_revision: str | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Voice Assistant LiveKit connection (ADR 0015; issue #366). The URL and
    # API key are identifiers, stored plain; the API secret is a credential
    # and holds ciphertext only, like `encrypted_assistant_api_key`.
    op.add_column("settings", sa.Column("voice_livekit_url", sa.String(255), nullable=True))
    op.add_column("settings", sa.Column("voice_livekit_api_key", sa.String(255), nullable=True))
    op.add_column(
        "settings", sa.Column("encrypted_voice_livekit_api_secret", sa.Text(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("settings", "encrypted_voice_livekit_api_secret")
    op.drop_column("settings", "voice_livekit_api_key")
    op.drop_column("settings", "voice_livekit_url")
