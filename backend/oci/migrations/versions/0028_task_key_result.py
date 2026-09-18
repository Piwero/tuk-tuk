"""task key result link

Adds the nullable `tasks.key_result_id` FK (ADR 0012, issue #236): a Task
serves at most one Key Result, so this is a plain FK, not a join table.
SET NULL on Key Result deletion — deleting a Key Result never costs the
user the Task.

Revision ID: 0028
Revises: 0027
Create Date: 2026-09-18

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("tasks") as batch:
        batch.add_column(sa.Column("key_result_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_tasks_key_result_id",
            "key_results",
            ["key_result_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_tasks_key_result_id", "tasks", ["key_result_id"])


def downgrade() -> None:
    op.drop_index("ix_tasks_key_result_id", table_name="tasks")
    with op.batch_alter_table("tasks") as batch:
        batch.drop_constraint("fk_tasks_key_result_id", type_="foreignkey")
        batch.drop_column("key_result_id")
