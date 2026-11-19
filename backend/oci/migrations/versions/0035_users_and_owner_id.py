"""users and owner_id

Multi-user, isolation only (issue #405, ticket #408). Adds the `users`
table, gives every owned table an `owner_id` foreign key to it (children
included, so isolation never depends on a join), and drops the old
`owner = 'local'` string columns. The login lockout moves off the
`settings` singleton onto each user.

An existing install's data all becomes user #1's: user #1 is seeded as the
admin, with the password hash and lockout state carried over from
`settings`, and every row is backfilled to it. A fresh, empty database gets
no user here. There is nothing to own yet, and the app creates the first
user on boot.

No downgrade: going back to a single `owner` string would have to either
drop every user but #1 or merge their data, and both lose information. To
undo this migration, restore the pre-upgrade backup.

Revision ID: 0035
Revises: 0034
Create Date: 2026-11-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0035"
down_revision: str | None = "0034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEED_USER_ID = 1

# Every table whose rows belong to a user, children included.
OWNED_TABLES = (
    "folders",
    "lists",
    "tags",
    "sections",
    "tasks",
    "check_items",
    "completed_occurrences",
    "habits",
    "check_ins",
    "goals",
    "key_results",
    "focus_sessions",
    "google_accounts",
    "google_calendars",
    "standup_entries",
    "standup_bullets",
    "timers",
)

# The subset that carried the single-user `owner` string column.
TABLES_WITH_OWNER_STRING = (
    "folders",
    "lists",
    "tags",
    "sections",
    "tasks",
    "habits",
    "goals",
    "focus_sessions",
    "standup_entries",
    "timers",
)


def _holds_data(bind: sa.Connection) -> bool:
    tables = ("settings", *OWNED_TABLES)
    query = " UNION ALL ".join(f"SELECT 1 FROM {table}" for table in tables)  # noqa: S608
    return bind.execute(sa.text(f"SELECT EXISTS ({query})")).scalar_one()


def upgrade() -> None:
    # citext is a trusted extension (PostgreSQL 13+), so the app's own
    # database owner can create it without superuser rights.
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", postgresql.CITEXT(), nullable=False, unique=True),
        # Nullable only until the profile is completed: the seeded user #1
        # has no email yet. Every other user is created with one.
        sa.Column("email", postgresql.CITEXT(), nullable=True, unique=True),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("session_epoch", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("must_complete_profile", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "login_failed_attempts", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("login_locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "email IS NOT NULL OR must_complete_profile", name="users_email_until_profile_complete"
        ),
    )

    bind = op.get_bind()
    if _holds_data(bind):
        # LEFT JOIN on a one-row VALUES list, so user #1 is seeded even when
        # owned rows exist without a settings row.
        op.execute(
            sa.text(
                "INSERT INTO users (id, username, password_hash, is_admin, "
                "must_complete_profile, login_failed_attempts, login_locked_until) "
                "SELECT :id, 'admin', s.password_hash, true, true, "
                "COALESCE(s.login_failed_attempts, 0), s.login_locked_until "
                "FROM (VALUES (1)) AS one (id) LEFT JOIN settings s ON s.id = one.id"
            ).bindparams(id=SEED_USER_ID)
        )
        # User #1 got an explicit id, so the sequence must move past it.
        op.execute("SELECT setval(pg_get_serial_sequence('users', 'id'), max(id)) FROM users")

    for table in OWNED_TABLES:
        op.add_column(table, sa.Column("owner_id", sa.Integer(), nullable=True))
        op.execute(sa.text(f"UPDATE {table} SET owner_id = :id").bindparams(id=SEED_USER_ID))  # noqa: S608
        op.alter_column(table, "owner_id", nullable=False)
        op.create_foreign_key(f"{table}_owner_id_fkey", table, "users", ["owner_id"], ["id"])
        op.create_index(f"ix_{table}_owner_id", table, ["owner_id"])

    op.drop_constraint("standup_entries_date_owner_key", "standup_entries", type_="unique")
    for table in TABLES_WITH_OWNER_STRING:
        op.drop_column(table, "owner")

    # Uniqueness that used to be global is now per user.
    op.drop_constraint("tags_name_key", "tags", type_="unique")
    op.create_index(
        "uq_tags_owner_id_lower_name",
        "tags",
        ["owner_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_unique_constraint(
        "standup_entries_date_owner_id_key", "standup_entries", ["date", "owner_id"]
    )
    op.drop_constraint("google_accounts_google_account_id_key", "google_accounts", type_="unique")
    op.create_unique_constraint(
        "google_accounts_owner_id_google_account_id_key",
        "google_accounts",
        ["owner_id", "google_account_id"],
    )
    op.create_index(
        "uq_lists_owner_id_inbox",
        "lists",
        ["owner_id"],
        unique=True,
        postgresql_where=sa.text("is_inbox"),
    )

    op.drop_column("settings", "login_locked_until")
    op.drop_column("settings", "login_failed_attempts")


def downgrade() -> None:
    raise NotImplementedError(
        "0035 has no downgrade: restore the database backup taken before upgrading."
    )
