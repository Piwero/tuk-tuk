"""drop settings.password_hash

Multi-user, isolation only (issue #405, ticket #410). Login now verifies
each user's own `users.password_hash`, so the install-wide copy on the
`settings` singleton is no longer read. No data step: migration 0035
already copied it onto user #1, and the app kept the two in step until
this ticket. `settings` now holds only the session-signing key.

No downgrade, like 0035 and 0036 before it: restore the pre-upgrade backup.

Revision ID: 0037
Revises: 0036
Create Date: 2026-11-19

"""

from collections.abc import Sequence

from alembic import op

revision: str = "0037"
down_revision: str | None = "0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("settings", "password_hash")


def downgrade() -> None:
    raise NotImplementedError(
        "0037 has no downgrade: restore the database backup taken before upgrading."
    )
