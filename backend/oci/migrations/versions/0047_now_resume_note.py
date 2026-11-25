"""now_resume_note

Issue #554: an optional resume note on the User's Now selection, a short
cue for picking the work back up. Lives on `now_selections`, so writing it
can never overwrite another preference.

No downgrade, like 0035-0046 before it: restore the pre-upgrade backup.

Revision ID: 0047
Revises: 0046
Create Date: 2026-11-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0047"
down_revision: str | None = "0045"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("now_selections", sa.Column("resume_note", sa.Text(), nullable=True))


def downgrade() -> None:
    raise NotImplementedError(
        "0047 has no downgrade: restore the database backup taken before upgrading."
    )
