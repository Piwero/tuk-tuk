"""seed focused goal from sprint goal

Data migration (ADR 0012, issue #238): the existing Sprint Goal text is
carried over as a focused Goal with no Key Results and no window, so it
isn't lost when Stand-up stops reading SprintGoal. Only runs if a
SprintGoal row exists with non-blank text — an empty/never-written Sprint
Goal seeds nothing. The `sprint_goals` table and its rows are left in
place; this ticket only stops Stand-up reading them (issue #239 drops the
table).

Revision ID: 0030
Revises: 0029
Create Date: 2026-09-18

"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0030"
down_revision: str | None = "0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

sprint_goals = sa.table(
    "sprint_goals", sa.column("text", sa.Text()), sa.column("owner", sa.String())
)
goals = sa.table(
    "goals",
    sa.column("title", sa.String()),
    sa.column("description", sa.String()),
    sa.column("status", sa.String()),
    sa.column("is_focused", sa.Boolean()),
    sa.column("owner", sa.String()),
    sa.column("created_at", sa.DateTime()),
)


def upgrade() -> None:
    bind = op.get_bind()
    row = bind.execute(sa.select(sprint_goals.c.text, sprint_goals.c.owner)).first()
    if row is None or not row.text.strip():
        return
    bind.execute(
        goals.insert().values(
            title=row.text,
            description="",
            status="active",
            is_focused=True,
            owner=row.owner,
            created_at=datetime.now(UTC),
        )
    )


def downgrade() -> None:
    # Irreversible by design: which seeded Goal (if any user Goals now
    # exist) came from this migration can't be told apart after the fact.
    pass
