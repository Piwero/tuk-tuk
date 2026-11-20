"""user_settings

Multi-user, isolation only (issue #405, ticket #409). Every setting the
`settings` singleton held, apart from the session-signing key, moves onto a
`user_settings` row, one per user: the Google OAuth client, Assist, the
Assistant, the Voice Assistant's LiveKit credentials, the section toggles
and Active hours. Each user brings their own integrations (ADR 0018).

An existing install's values become user #1's. A database where user #1
exists without a `settings` row gives user #1 the defaults. A fresh,
empty database has no users, so it gets no row here.

`settings.password_hash` stays for now: login still verifies against it
until per-user login (issue #410) moves verification onto `users`.

No downgrade, like 0035 before it: restore the pre-upgrade backup.

Revision ID: 0036
Revises: 0035
Create Date: 2026-11-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0036"
down_revision: str | None = "0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEED_USER_ID = 1

# Every column that moves, as (name, type) or (name, type, server default),
# copied from `settings` by name.
NULLABLE_COLUMNS: tuple[tuple[str, sa.types.TypeEngine[object]], ...] = (
    ("google_client_id", sa.String(255)),
    ("encrypted_google_client_secret", sa.Text()),
    ("assist_ollama_base_url", sa.String(255)),
    ("assist_model", sa.String(255)),
    ("assistant_base_url", sa.String(255)),
    ("assistant_model", sa.String(255)),
    ("encrypted_assistant_api_key", sa.Text()),
    ("assistant_planning_preferences", sa.Text()),
    ("voice_livekit_url", sa.String(255)),
    ("voice_livekit_api_key", sa.String(255)),
    ("encrypted_voice_livekit_api_secret", sa.Text()),
)

DEFAULTED_COLUMNS: tuple[tuple[str, sa.types.TypeEngine[object], str], ...] = (
    ("standup_enabled", sa.Boolean(), "true"),
    ("calendar_enabled", sa.Boolean(), "true"),
    ("goals_enabled", sa.Boolean(), "true"),
    ("habits_enabled", sa.Boolean(), "true"),
    ("focus_enabled", sa.Boolean(), "true"),
    ("assistant_enabled", sa.Boolean(), "true"),
    ("active_hours_enabled", sa.Boolean(), "false"),
    ("active_hours_start", sa.String(5), "'09:00'"),
    ("active_hours_end", sa.String(5), "'17:00'"),
)


def upgrade() -> None:
    op.create_table(
        "user_settings",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), primary_key=True),
        *(sa.Column(name, type_, nullable=True) for name, type_ in NULLABLE_COLUMNS),
        *(
            sa.Column(name, type_, nullable=False, server_default=sa.text(default))
            for name, type_, default in DEFAULTED_COLUMNS
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )

    # A LEFT JOIN, so user #1 gets a row (with the defaults) even when owned
    # rows were migrated without a settings row. Only user #1 can exist yet.
    names = [name for name, _ in NULLABLE_COLUMNS] + [name for name, _, _ in DEFAULTED_COLUMNS]
    selected = [f"s.{name}" for name, _ in NULLABLE_COLUMNS] + [
        f"COALESCE(s.{name}, {default})" for name, _, default in DEFAULTED_COLUMNS
    ]
    op.execute(
        sa.text(
            f"INSERT INTO user_settings (user_id, {', '.join(names)}) "  # noqa: S608
            f"SELECT u.id, {', '.join(selected)} "
            "FROM users u LEFT JOIN settings s ON s.id = 1 "
            "WHERE u.id = :id"
        ).bindparams(id=SEED_USER_ID)
    )

    for name in names:
        op.drop_column("settings", name)


def downgrade() -> None:
    raise NotImplementedError(
        "0036 has no downgrade: restore the database backup taken before upgrading."
    )
