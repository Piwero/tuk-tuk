"""add users.last_active_at

Multi-user, frontend spec #468 (ticket #478): when each User was last
active, shown to Admins in Settings › Users so they can spot accounts
nobody uses. Set by the app when it serves an authenticated request, at
most once every few minutes per User (app.middleware).

Null until the first authenticated request after this upgrade: no request
was ever recorded before, and "Never" is the honest reading.

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
    op.add_column("users", sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    raise NotImplementedError(
        "0039 has no downgrade: restore the database backup taken before upgrading."
    )
