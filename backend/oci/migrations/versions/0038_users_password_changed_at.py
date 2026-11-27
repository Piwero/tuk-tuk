"""add users.password_changed_at

Multi-user, frontend spec #468 (ticket #475): when each User's password
was last set, shown to them in Settings › My account. Set from then on by
the app whenever a password is set (creation, an Admin's temporary
password, the User's own change or forced step).

Existing Users never had the time recorded, so they are backfilled with
their `created_at`: the closest known bound, and never blank.

No downgrade, like 0035-0037 before it: restore the pre-upgrade backup.

Revision ID: 0038
Revises: 0037
Create Date: 2026-11-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0038"
down_revision: str | None = "0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.execute("UPDATE users SET password_changed_at = created_at")
    op.alter_column("users", "password_changed_at", nullable=False, server_default=sa.func.now())


def downgrade() -> None:
    raise NotImplementedError(
        "0038 has no downgrade: restore the database backup taken before upgrading."
    )
