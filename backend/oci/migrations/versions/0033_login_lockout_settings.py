"""login lockout settings

Revision ID: 0033
Revises: 0032
Create Date: 2026-10-18

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0033"
down_revision: str | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Persisted so the lockout survives a pod restart (issue #333, #339) —
    # Flux image automation restarts the pod on every release, and an
    # in-memory counter would hand an attacker a free reset each time.
    # Persistence makes this correct across restarts, NOT across replicas:
    # two pods would still race on read-then-write with no advisory lock.
    # `replicas: 1` stays load-bearing for this reason (see the Deployment's
    # comment) — these columns are one more reason not to raise it.
    op.add_column(
        "settings",
        sa.Column(
            "login_failed_attempts", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
    )
    op.add_column(
        "settings",
        sa.Column("login_locked_until", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("settings", "login_locked_until")
    op.drop_column("settings", "login_failed_attempts")
