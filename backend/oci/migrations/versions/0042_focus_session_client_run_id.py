"""focus_sessions.client_run_id

Issue #546: finishing a Focus Session is retry-safe. The client generates
an identity for each run and sends it with the finish; a create repeated
for the same run (its response lost, the tab reloaded mid-save) returns
the session already recorded instead of recording a second one. Unique per
owner, so one User's id never collides with another's. Nullable: sessions
added retroactively, and every session recorded before this, carry none.

No downgrade, like 0035-0041 before it: restore the pre-upgrade backup.

Revision ID: 0042
Revises: 0041
Create Date: 2026-11-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0042"
down_revision: str | None = "0041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("focus_sessions", sa.Column("client_run_id", sa.String(64), nullable=True))
    op.create_unique_constraint(
        "uq_focus_sessions_owner_id_client_run_id",
        "focus_sessions",
        ["owner_id", "client_run_id"],
    )


def downgrade() -> None:
    raise NotImplementedError(
        "0042 has no downgrade: restore the database backup taken before upgrading."
    )
