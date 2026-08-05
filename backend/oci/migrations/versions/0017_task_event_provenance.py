"""task event provenance: source calendar and event identifiers

Revision ID: 0017
Revises: 0016
Create Date: 2026-08-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("tasks") as batch:
        batch.add_column(sa.Column("source_google_calendar_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("source_google_event_id", sa.String(length=255), nullable=True))
        batch.create_foreign_key(
            "fk_tasks_source_google_calendar_id_google_calendars",
            "google_calendars",
            ["source_google_calendar_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch:
        batch.drop_constraint(
            "fk_tasks_source_google_calendar_id_google_calendars", type_="foreignkey"
        )
        batch.drop_column("source_google_event_id")
        batch.drop_column("source_google_calendar_id")
