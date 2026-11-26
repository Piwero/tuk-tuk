"""Runs the real Alembic chain against an empty database, independent of the
session-scoped template cache in conftest.py — so a broken migration is still
caught even though other tests start from a pre-migrated clone (#113).

Foreign keys need no separate check after an upgrade: PostgreSQL enforces
them on every write, so a migration that broke one fails the upgrade itself.
"""

from collections.abc import Iterator

import psycopg
import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from app.db import BACKEND_DIR, run_migrations
from app.models import Base
from tests.conftest import drop_database, fresh_database, run_sql

SEED_LIST = (
    "INSERT INTO lists (id, name, is_inbox, is_archived, sort_order, view_mode, owner, "
    "created_at) VALUES (1, 'Inbox', true, false, 0, 'list', 'local', '2026-01-01T00:00:00+00:00')"
)
SEED_TASK = (
    "INSERT INTO tasks (id, title, completed, description, priority, is_all_day, "
    "reminders, list_id, sort_order, owner, created_at) VALUES "
    "(1, 'Write code', false, '', 'none', false, '[]', 1, 0, 'local', "
    "'2026-01-01T00:00:00+00:00')"
)
SEED_SPRINT_GOAL = (
    "INSERT INTO sprint_goals (id, text, owner, created_at, updated_at) VALUES "
    "(1, 'Ship v2', 'local', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')"
)
SEED_STANDUP_ENTRY = (
    "INSERT INTO standup_entries (id, date, sprint_goal_snapshot, owner, created_at) "
    "VALUES (1, '2026-01-05', 'An old snapshot', 'local', '2026-01-05T00:00:00+00:00')"
)


@pytest.fixture
def empty_database_url(postgres_server: str) -> Iterator[str]:
    url = fresh_database(postgres_server)
    yield url
    drop_database(url)


def alembic_config(database_url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def table_names(database_url: str) -> set[str]:
    rows = run_sql(
        database_url,
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    )
    return {name for (name,) in rows}


def test_run_migrations_applies_full_chain_from_empty_database(empty_database_url: str) -> None:
    run_migrations(empty_database_url)

    head = ScriptDirectory.from_config(alembic_config(empty_database_url)).get_current_head()
    assert run_sql(empty_database_url, "SELECT version_num FROM alembic_version") == [(head,)]


def test_0026_goals_migration_upgrade_preserves_existing_rows_and_fks(
    empty_database_url: str,
) -> None:
    """Upgrades a database seeded at 0025 (pre-Goals) with real Task/List
    rows to head, and asserts the rows survive with their foreign key —
    the migration adds a new table only, it never touches an existing one
    (issue #232)."""
    config = alembic_config(empty_database_url)
    command.upgrade(config, "0025")
    run_sql(empty_database_url, SEED_LIST)
    run_sql(empty_database_url, SEED_TASK)

    command.upgrade(config, "head")

    assert run_sql(empty_database_url, "SELECT title, list_id FROM tasks WHERE id = 1") == [
        ("Write code", 1)
    ]
    assert "goals" in table_names(empty_database_url)


def test_0028_task_key_result_migration_preserves_existing_task_rows(
    empty_database_url: str,
) -> None:
    """Upgrades a database seeded at 0027 (pre-Task-FK) with a real Task row
    to head, and asserts it survives with the new key_result_id column
    nullable and unset (issue #236)."""
    config = alembic_config(empty_database_url)
    command.upgrade(config, "0027")
    run_sql(empty_database_url, SEED_LIST)
    run_sql(empty_database_url, SEED_TASK)

    command.upgrade(config, "head")

    assert run_sql(empty_database_url, "SELECT title, key_result_id FROM tasks WHERE id = 1") == [
        ("Write code", None)
    ]


def test_0048_planned_work_migration_leaves_existing_tasks_unplanned(
    empty_database_url: str,
) -> None:
    """Issue #558: an existing Task survives the upgrade to head with every
    planned work column null — no plan, and its dates untouched."""
    config = alembic_config(empty_database_url)
    command.upgrade(config, "0027")
    run_sql(empty_database_url, SEED_LIST)
    run_sql(empty_database_url, SEED_TASK)

    command.upgrade(config, "head")

    assert run_sql(
        empty_database_url,
        "SELECT title, due_date, planned_start, planned_duration_minutes, "
        "planned_time_zone, planned_buffer_minutes FROM tasks WHERE id = 1",
    ) == [("Write code", None, None, None, None, None)]


def test_seed_migration_carries_sprint_goal_text_and_preserves_standup_snapshots(
    empty_database_url: str,
) -> None:
    """Upgrades a database seeded at 0029 (pre-seed-migration) with a real
    Sprint Goal and Stand-up Entries to 0030 (pre-drop, issue #238's
    contract), and asserts: the Sprint Goal text becomes a focused,
    windowless Goal with no Key Results; existing Stand-up Entries keep
    their original sprint_goal_snapshot untouched (not backfilled); and the
    sprint_goals table/row survive at this revision (issue #239 drops it,
    tested separately below)."""
    config = alembic_config(empty_database_url)
    command.upgrade(config, "0029")
    run_sql(empty_database_url, SEED_SPRINT_GOAL)
    run_sql(empty_database_url, SEED_STANDUP_ENTRY)

    command.upgrade(config, "0030")

    assert run_sql(
        empty_database_url, "SELECT title, is_focused, start_date, end_date FROM goals"
    ) == [("Ship v2", True, None, None)]
    assert run_sql(
        empty_database_url,
        "SELECT COUNT(*) FROM key_results WHERE goal_id = "
        "(SELECT id FROM goals WHERE title = 'Ship v2')",
    ) == [(0,)]
    # The pre-existing Entry keeps exactly the snapshot it was created
    # with — never backfilled from the newly-seeded Goal.
    assert run_sql(
        empty_database_url, "SELECT sprint_goal_snapshot FROM standup_entries WHERE id = 1"
    ) == [("An old snapshot",)]
    assert run_sql(empty_database_url, "SELECT text FROM sprint_goals WHERE id = 1") == [
        ("Ship v2",)
    ]


def test_drop_sprint_goal_migration_preserves_standup_snapshots(empty_database_url: str) -> None:
    """Issue #239: upgrading to head against a database containing a real
    Sprint Goal row and real Stand-up Entries drops the sprint_goals table
    while leaving standup_entries and its sprint_goal_snapshot column (the
    frozen history) fully intact. The down migration restores the table."""
    config = alembic_config(empty_database_url)
    command.upgrade(config, "0030")
    run_sql(empty_database_url, SEED_SPRINT_GOAL)
    run_sql(empty_database_url, SEED_STANDUP_ENTRY)
    snapshot_query = "SELECT sprint_goal_snapshot FROM standup_entries WHERE id = 1"

    # Not head: 0035 (issue #408) has no downgrade.
    command.upgrade(config, "0031")

    assert "sprint_goals" not in table_names(empty_database_url)
    assert run_sql(empty_database_url, snapshot_query) == [("An old snapshot",)]

    command.downgrade(config, "0030")

    assert "sprint_goals" in table_names(empty_database_url)
    assert run_sql(empty_database_url, snapshot_query) == [("An old snapshot",)]


def test_seed_migration_seeds_nothing_when_no_sprint_goal_exists(empty_database_url: str) -> None:
    config = alembic_config(empty_database_url)
    command.upgrade(config, "0029")

    command.upgrade(config, "head")

    assert run_sql(empty_database_url, "SELECT COUNT(*) FROM goals") == [(0,)]


# One row in every owned table, as a pre-multi-user (0034) install holds
# them: root rows carry the old `owner = 'local'` string, children have no
# owner column at all (issue #408).
PRE_MULTI_USER_ROWS = (
    "INSERT INTO settings (id, session_key, password_hash, login_failed_attempts, "
    "login_locked_until, created_at, updated_at) VALUES (1, 'a-session-key', "
    "'an-existing-hash', 3, '2026-01-01T00:05:00+00:00', now(), now())",
    "INSERT INTO folders (id, name, sort_order, owner, created_at) "
    "VALUES (1, 'Work', 0, 'local', now())",
    "INSERT INTO lists (id, name, is_inbox, is_archived, sort_order, view_mode, folder_id, "
    "owner, created_at) VALUES (1, 'Inbox', true, false, 0, 'list', 1, 'local', now())",
    "INSERT INTO tags (id, name, owner, created_at) VALUES (1, 'Errand', 'local', now())",
    "INSERT INTO sections (id, list_id, name, sort_order, owner, created_at) "
    "VALUES (1, 1, 'Later', 0, 'local', now())",
    "INSERT INTO habits (id, name, type, target, step, encouragement, frequency, is_archived, "
    "owner, created_at) VALUES (1, 'Read', 'boolean', 1, 1, '', 'FREQ=DAILY', false, 'local', "
    "now())",
    "INSERT INTO check_ins (id, habit_id, date, value) VALUES (1, 1, '2026-01-05', 1)",
    "INSERT INTO goals (id, title, description, status, is_focused, owner, created_at) "
    "VALUES (1, 'Ship', '', 'active', false, 'local', now())",
    "INSERT INTO key_results (id, goal_id, name, source, start_value, target_value, "
    "current_value, sort_order, created_at) VALUES (1, 1, 'Releases', 'manual', 0, 3, 1, 0, "
    "now())",
    "INSERT INTO google_accounts (id, google_account_id, email, encrypted_refresh_token, "
    "connection_state, created_at, updated_at) VALUES (1, 'g-1', 'me@example.com', 'cipher', "
    "'connected', now(), now())",
    "INSERT INTO google_calendars (id, google_account_id, google_calendar_id, summary, color, "
    "enabled, created_at) VALUES (1, 1, 'primary', 'Me', 'blue', true, now())",
    "INSERT INTO tasks (id, title, completed, description, priority, is_all_day, reminders, "
    "list_id, section_id, sort_order, owner, created_at, key_result_id) VALUES "
    "(1, 'Write code', false, '', 'none', false, '[]', 1, 1, 0, 'local', now(), 1)",
    "INSERT INTO task_tags (task_id, tag_id) VALUES (1, 1)",
    "INSERT INTO check_items (id, task_id, title, done, sort_order, created_at) "
    "VALUES (1, 1, 'Tests', false, 0, now())",
    "INSERT INTO completed_occurrences (id, task_id, completed_at, due_date, is_all_day) "
    "VALUES (1, 1, now(), now(), false)",
    "INSERT INTO focus_sessions (id, mode, task_id, started_at, ended_at, pause_seconds, note, "
    "owner, created_at) VALUES (1, 'pomo', 1, now(), now(), 0, '', 'local', now())",
    "INSERT INTO timers (id, name, mode, duration_seconds, owner, created_at) "
    "VALUES (1, 'Reading', 'pomo', 1500, 'local', now())",
    "INSERT INTO standup_entries (id, date, sprint_goal_snapshot, owner, created_at) "
    "VALUES (1, '2026-01-05', '', 'local', now())",
    "INSERT INTO standup_bullets (id, entry_id, section, text, sort_order, created_at) "
    "VALUES (1, 1, 'today', 'Pair', 0, now())",
)

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


def columns_of(database_url: str, table: str) -> set[str]:
    rows = run_sql(
        database_url,
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = %s",
        (table,),
    )
    return {name for (name,) in rows}


def upgrade_a_pre_multi_user_install(database_url: str) -> None:
    config = alembic_config(database_url)
    command.upgrade(config, "0034")
    for statement in PRE_MULTI_USER_ROWS:
        run_sql(database_url, statement)

    command.upgrade(config, "head")


class TestUsersMigration:
    """Issue #408: an existing single-user install's data becomes user #1's."""

    def test_upgrading_keeps_every_row_and_assigns_it_to_user_1(
        self, empty_database_url: str
    ) -> None:
        upgrade_a_pre_multi_user_install(empty_database_url)

        for table in OWNED_TABLES:
            rows = run_sql(empty_database_url, f"SELECT id, owner_id FROM {table}")  # noqa: S608
            assert rows == [(1, 1)], table
            assert "owner" not in columns_of(empty_database_url, table), table
        assert run_sql(empty_database_url, "SELECT task_id, tag_id FROM task_tags") == [(1, 1)]

    def test_user_1_is_the_admin_seeded_from_the_existing_password_and_lockout(
        self, empty_database_url: str
    ) -> None:
        upgrade_a_pre_multi_user_install(empty_database_url)

        users = run_sql(
            empty_database_url,
            "SELECT id, username, email, password_hash, is_admin, is_active, session_epoch, "
            "must_change_password, must_complete_profile, login_failed_attempts, "
            "login_locked_until::text FROM users",
        )
        assert users == [
            (
                1,
                "admin",
                None,
                "an-existing-hash",
                True,
                True,
                0,
                False,
                True,
                3,
                "2026-01-01 00:05:00+00",
            )
        ]
        assert not {"login_failed_attempts", "login_locked_until"} & columns_of(
            empty_database_url, "settings"
        )

    def test_the_next_user_created_gets_id_2(self, empty_database_url: str) -> None:
        """User #1 is inserted with an explicit id, so the sequence must be
        moved past it."""
        upgrade_a_pre_multi_user_install(empty_database_url)

        assert run_sql(
            empty_database_url,
            "INSERT INTO users (username, email, is_admin) "
            "VALUES ('second', 'second@example.com', false) RETURNING id",
        ) == [(2,)]

    def test_a_fresh_database_has_no_users(self, empty_database_url: str) -> None:
        """Nothing to own yet, so nothing is seeded: the app creates the
        first user on boot instead."""
        run_migrations(empty_database_url)

        assert run_sql(empty_database_url, "SELECT COUNT(*) FROM users") == [(0,)]


class TestUniquenessPreCheck:
    """Issue #408 adds per-user uniqueness that a single-user install never
    enforced: tag names ignoring case, and one Inbox. 0035 refuses to start
    on data that breaks either, naming the rows and how to fix them, rather
    than failing on an index error or quietly rewriting anything."""

    def upgrade_with(self, database_url: str, *statements: str) -> pytest.ExceptionInfo[Exception]:
        config = alembic_config(database_url)
        command.upgrade(config, "0034")
        for statement in statements:
            run_sql(database_url, statement)
        with pytest.raises(RuntimeError) as refused:
            command.upgrade(config, "head")
        return refused

    def test_tags_differing_only_in_case_stop_the_upgrade(self, empty_database_url: str) -> None:
        refused = self.upgrade_with(
            empty_database_url,
            "INSERT INTO tags (id, name, owner, created_at) VALUES "
            "(7, 'Work', 'local', now()), (9, 'work', 'local', now()), "
            "(11, 'Home', 'local', now())",
        )

        message = str(refused.value)
        assert "'Work' (id 7)" in message
        assert "'work' (id 9)" in message
        assert "Home" not in message
        assert "upgrade.md" in message
        assert run_sql(empty_database_url, "SELECT version_num FROM alembic_version") == [("0034",)]
        assert run_sql(empty_database_url, "SELECT id, name FROM tags ORDER BY id") == [
            (7, "Work"),
            (9, "work"),
            (11, "Home"),
        ]

    def test_more_than_one_inbox_stops_the_upgrade(self, empty_database_url: str) -> None:
        refused = self.upgrade_with(
            empty_database_url,
            "INSERT INTO lists (id, name, is_inbox, is_archived, sort_order, view_mode, owner, "
            "created_at) VALUES (3, 'Inbox', true, false, 0, 'list', 'local', now()), "
            "(5, 'Old inbox', true, false, 1, 'list', 'local', now()), "
            "(6, 'Errands', false, false, 2, 'list', 'local', now())",
        )

        message = str(refused.value)
        assert "'Inbox' (id 3)" in message
        assert "'Old inbox' (id 5)" in message
        assert "Errands" not in message
        assert run_sql(empty_database_url, "SELECT version_num FROM alembic_version") == [("0034",)]


class TestPerUserUniqueness:
    """Issue #408: what used to be unique across the install is unique per
    user. Two users can hold the same name; one user still cannot."""

    @pytest.fixture
    def two_users(self, empty_database_url: str) -> str:
        run_migrations(empty_database_url)
        ids = run_sql(
            empty_database_url,
            "INSERT INTO users (username, email) VALUES "
            "('ana', 'ana@example.com'), ('ben', 'ben@example.com') RETURNING id",
        )
        assert ids == [(1,), (2,)]
        return empty_database_url

    def insert_tag(self, database_url: str, owner_id: int, name: str) -> None:
        run_sql(
            database_url,
            "INSERT INTO tags (name, owner_id, created_at) VALUES (%s, %s, now())",
            (name, owner_id),
        )

    def insert_inbox(self, database_url: str, owner_id: int) -> None:
        run_sql(
            database_url,
            "INSERT INTO lists (name, is_inbox, owner_id, created_at) "
            "VALUES ('Inbox', true, %s, now())",
            (owner_id,),
        )

    def insert_google_account(self, database_url: str, owner_id: int) -> None:
        run_sql(
            database_url,
            "INSERT INTO google_accounts (google_account_id, email, encrypted_refresh_token, "
            "connection_state, owner_id, created_at, updated_at) VALUES ('g-1', 'me@example.com', "
            "'c', 'connected', %s, now(), now())",
            (owner_id,),
        )

    def insert_standup_entry(self, database_url: str, owner_id: int) -> None:
        run_sql(
            database_url,
            "INSERT INTO standup_entries (date, sprint_goal_snapshot, owner_id, created_at) "
            "VALUES ('2026-01-05', '', %s, now())",
            (owner_id,),
        )

    def test_a_tag_name_is_unique_per_user_ignoring_case(self, two_users: str) -> None:
        self.insert_tag(two_users, 1, "Work")
        self.insert_tag(two_users, 2, "work")

        with pytest.raises(psycopg.errors.UniqueViolation):
            self.insert_tag(two_users, 1, "WORK")

    def test_each_user_has_at_most_one_inbox(self, two_users: str) -> None:
        self.insert_inbox(two_users, 1)
        self.insert_inbox(two_users, 2)

        with pytest.raises(psycopg.errors.UniqueViolation):
            self.insert_inbox(two_users, 1)

    def test_a_google_account_is_connected_at_most_once_per_user(self, two_users: str) -> None:
        self.insert_google_account(two_users, 1)
        self.insert_google_account(two_users, 2)

        with pytest.raises(psycopg.errors.UniqueViolation):
            self.insert_google_account(two_users, 1)

    def test_a_user_has_at_most_one_stand_up_entry_per_date(self, two_users: str) -> None:
        self.insert_standup_entry(two_users, 1)
        self.insert_standup_entry(two_users, 2)

        with pytest.raises(psycopg.errors.UniqueViolation):
            self.insert_standup_entry(two_users, 1)

    def test_usernames_and_emails_are_unique_ignoring_case(self, two_users: str) -> None:
        with pytest.raises(psycopg.errors.UniqueViolation):
            run_sql(
                two_users,
                "INSERT INTO users (username, email) VALUES ('ANA', 'other@example.com')",
            )
        with pytest.raises(psycopg.errors.UniqueViolation):
            run_sql(
                two_users, "INSERT INTO users (username, email) VALUES ('cat', 'Ben@Example.com')"
            )

    def test_only_a_user_still_completing_their_profile_may_lack_an_email(
        self, two_users: str
    ) -> None:
        run_sql(
            two_users,
            "INSERT INTO users (username, must_complete_profile) VALUES ('cat', true)",
        )

        with pytest.raises(psycopg.errors.CheckViolation):
            run_sql(two_users, "INSERT INTO users (username) VALUES ('dan')")


# A 0034 settings row with every per-user field set away from its default.
SETTINGS_WITH_EVERY_FIELD = (
    "INSERT INTO settings (id, session_key, password_hash, google_client_id, "
    "encrypted_google_client_secret, assist_ollama_base_url, assist_model, "
    "assistant_base_url, assistant_model, encrypted_assistant_api_key, "
    "assistant_planning_preferences, voice_livekit_url, voice_livekit_api_key, "
    "encrypted_voice_livekit_api_secret, standup_enabled, calendar_enabled, goals_enabled, "
    "habits_enabled, focus_enabled, assistant_enabled, active_hours_enabled, "
    "active_hours_start, active_hours_end, login_failed_attempts, created_at, updated_at) "
    "VALUES (1, 'a-session-key', 'an-existing-hash', 'a-client-id', 'secret-cipher', "
    "'http://ollama:11434', 'qwen3:14b', 'https://api.example.com', 'a-model', 'key-cipher', "
    "'Mornings are for deep work', 'wss://livekit.example.com', 'lk-key', 'lk-secret-cipher', "
    "false, false, false, false, false, false, true, '08:00', '16:30', 0, now(), now())"
)

USER_SETTINGS_FIELDS = (
    "google_client_id, encrypted_google_client_secret, assist_ollama_base_url, assist_model, "
    "assistant_base_url, assistant_model, encrypted_assistant_api_key, "
    "assistant_planning_preferences, voice_livekit_url, voice_livekit_api_key, "
    "encrypted_voice_livekit_api_secret, standup_enabled, calendar_enabled, goals_enabled, "
    "habits_enabled, focus_enabled, assistant_enabled, active_hours_enabled, "
    "active_hours_start, active_hours_end"
)


def upgrade_an_install_with_every_setting(database_url: str) -> None:
    config = alembic_config(database_url)
    command.upgrade(config, "0034")
    run_sql(database_url, SETTINGS_WITH_EVERY_FIELD)
    command.upgrade(config, "head")


class TestUserSettingsMigration:
    """Issue #409: every setting but the session key moves off the
    `settings` singleton onto user #1's own `user_settings` row."""

    def test_user_1s_settings_hold_the_values_the_singleton_held(
        self, empty_database_url: str
    ) -> None:
        upgrade_an_install_with_every_setting(empty_database_url)

        assert run_sql(
            empty_database_url,
            f"SELECT user_id, {USER_SETTINGS_FIELDS} FROM user_settings",  # noqa: S608
        ) == [
            (
                1,
                "a-client-id",
                "secret-cipher",
                "http://ollama:11434",
                "qwen3:14b",
                "https://api.example.com",
                "a-model",
                "key-cipher",
                "Mornings are for deep work",
                "wss://livekit.example.com",
                "lk-key",
                "lk-secret-cipher",
                False,
                False,
                False,
                False,
                False,
                False,
                True,
                "08:00",
                "16:30",
            )
        ]

    def test_the_singleton_keeps_only_the_session_key(self, empty_database_url: str) -> None:
        """The install password is dropped once login reads `users`
        (issue #410, migration 0037)."""
        upgrade_an_install_with_every_setting(empty_database_url)

        assert columns_of(empty_database_url, "settings") == {
            "id",
            "session_key",
            "created_at",
            "updated_at",
        }
        assert run_sql(empty_database_url, "SELECT session_key FROM settings") == [
            ("a-session-key",)
        ]

    def test_user_1_keeps_the_install_password(self, empty_database_url: str) -> None:
        upgrade_an_install_with_every_setting(empty_database_url)

        assert run_sql(empty_database_url, "SELECT id, password_hash FROM users") == [
            (1, "an-existing-hash")
        ]

    def test_user_1_without_a_settings_row_gets_the_defaults(self, empty_database_url: str) -> None:
        config = alembic_config(empty_database_url)
        command.upgrade(config, "0034")
        run_sql(
            empty_database_url,
            "INSERT INTO folders (id, name, sort_order, owner, created_at) "
            "VALUES (1, 'Work', 0, 'local', now())",
        )

        command.upgrade(config, "head")

        assert run_sql(
            empty_database_url,
            "SELECT user_id, google_client_id, standup_enabled, calendar_enabled, "
            "active_hours_enabled, active_hours_start, active_hours_end FROM user_settings",
        ) == [(1, None, True, True, False, "09:00", "17:00")]

    def test_a_fresh_database_has_no_user_settings(self, empty_database_url: str) -> None:
        run_migrations(empty_database_url)

        assert run_sql(empty_database_url, "SELECT COUNT(*) FROM user_settings") == [(0,)]

    def test_a_user_has_at_most_one_settings_row(self, empty_database_url: str) -> None:
        run_migrations(empty_database_url)
        run_sql(empty_database_url, "INSERT INTO users (username, email) VALUES ('ana', 'a@x.io')")
        run_sql(empty_database_url, "INSERT INTO user_settings (user_id) VALUES (1)")

        with pytest.raises(psycopg.errors.UniqueViolation):
            run_sql(empty_database_url, "INSERT INTO user_settings (user_id) VALUES (1)")


class TestPasswordChangedMigration:
    """Issue #475: existing Users never had the time recorded, so it starts
    at when their account was created rather than blank."""

    def test_existing_users_get_their_created_at(self, empty_database_url: str) -> None:
        config = alembic_config(empty_database_url)
        command.upgrade(config, "0037")
        run_sql(
            empty_database_url,
            "INSERT INTO users (username, email, created_at) VALUES "
            "('ana', 'ana@example.com', '2026-03-04T05:06:07+00:00'), "
            "('ben', 'ben@example.com', '2026-07-08T09:10:11+00:00')",
        )

        command.upgrade(config, "head")

        assert run_sql(
            empty_database_url,
            "SELECT username, password_changed_at::text FROM users ORDER BY id",
        ) == [("ana", "2026-03-04 05:06:07+00"), ("ben", "2026-07-08 09:10:11+00")]

    def test_a_user_inserted_without_one_gets_the_current_time(
        self, empty_database_url: str
    ) -> None:
        run_migrations(empty_database_url)

        assert run_sql(
            empty_database_url,
            "INSERT INTO users (username, email) VALUES ('ana', 'a@x.io') "
            "RETURNING password_changed_at IS NOT NULL",
        ) == [(True,)]


class TestLastActiveMigration:
    """Issue #478: no request was ever recorded before the upgrade, so every
    existing User reads "Never" until their next authenticated request."""

    def test_existing_users_start_never_active(self, empty_database_url: str) -> None:
        config = alembic_config(empty_database_url)
        command.upgrade(config, "0038")
        run_sql(
            empty_database_url,
            "INSERT INTO users (username, email) VALUES ('ana', 'ana@example.com')",
        )

        command.upgrade(config, "head")

        assert run_sql(empty_database_url, "SELECT username, last_active_at FROM users") == [
            ("ana", None)
        ]


# A 0040 install holding one linked row under every parent a delete rule
# hangs off (issue #508).
LINKED_ROWS = (
    "INSERT INTO users (id, username, email) VALUES (1, 'ana', 'ana@example.com')",
    "INSERT INTO folders (id, name, sort_order, owner_id, created_at) "
    "VALUES (1, 'Work', 0, 1, now())",
    "INSERT INTO lists (id, name, is_inbox, is_archived, sort_order, view_mode, folder_id, "
    "owner_id, created_at) VALUES (1, 'Errands', false, false, 0, 'list', 1, 1, now())",
    "INSERT INTO sections (id, list_id, name, sort_order, owner_id, created_at) "
    "VALUES (1, 1, 'Later', 0, 1, now())",
    "INSERT INTO tasks (id, title, completed, description, priority, is_all_day, reminders, "
    "list_id, section_id, sort_order, owner_id, created_at) VALUES "
    "(1, 'Write code', false, '', 'none', false, '[]', 1, 1, 0, 1, now())",
    "INSERT INTO tags (id, name, owner_id, created_at) VALUES (1, 'Errand', 1, now())",
    "INSERT INTO task_tags (task_id, tag_id) VALUES (1, 1)",
    "INSERT INTO check_items (id, task_id, title, done, sort_order, owner_id, created_at) "
    "VALUES (1, 1, 'Tests', false, 0, 1, now())",
    "INSERT INTO habits (id, name, type, target, step, encouragement, frequency, is_archived, "
    "owner_id, created_at) VALUES (1, 'Read', 'boolean', 1, 1, '', 'FREQ=DAILY', false, 1, now())",
    "INSERT INTO check_ins (id, habit_id, date, value, owner_id) VALUES (1, 1, '2026-01-05', 1, 1)",
    "INSERT INTO focus_sessions (id, mode, task_id, habit_id, started_at, ended_at, "
    "pause_seconds, note, owner_id, created_at) VALUES "
    "(1, 'pomo', 1, NULL, now(), now(), 0, '', 1, now()), "
    "(2, 'pomo', NULL, 1, now(), now(), 0, '', 1, now())",
    "INSERT INTO timers (id, name, mode, duration_seconds, task_id, habit_id, owner_id, "
    "created_at) VALUES (1, 'Coding', 'pomo', 1500, 1, NULL, 1, now()), "
    "(2, 'Reading', 'pomo', 1500, NULL, 1, 1, now())",
    "INSERT INTO goals (id, title, description, status, is_focused, owner_id, created_at) "
    "VALUES (1, 'Ship', '', 'active', false, 1, now())",
    "INSERT INTO key_results (id, goal_id, name, source, start_value, target_value, "
    "current_value, sort_order, owner_id, created_at) VALUES "
    "(1, 1, 'Releases', 'manual', 0, 3, 1, 0, 1, now())",
    "INSERT INTO standup_entries (id, date, sprint_goal_snapshot, owner_id, created_at) "
    "VALUES (1, '2026-01-05', '', 1, now())",
    "INSERT INTO standup_bullets (id, entry_id, section, text, sort_order, owner_id, "
    "created_at) VALUES (1, 1, 'today', 'Pair', 0, 1, now())",
)


class TestDeleteRulesMigration:
    """Issue #508: PostgreSQL, not hand-written router sweeps, decides what
    a delete takes with it. Each case deletes one parent straight in SQL
    and checks what survives: dependents that mean nothing without it go,
    history and presets of their own stay with the link cleared."""

    @pytest.mark.parametrize(
        ("parent", "survivors"),
        [
            pytest.param(
                "folders",
                {"SELECT id, folder_id FROM lists": [(1, None)]},
                id="folder-unfiles-its-lists",
            ),
            pytest.param(
                "sections",
                {"SELECT id, section_id FROM tasks": [(1, None)]},
                id="section-ungroups-its-tasks",
            ),
            pytest.param(
                "tags",
                {
                    "SELECT * FROM task_tags": [],
                    "SELECT id FROM tasks": [(1,)],
                },
                id="tag-detaches-from-tasks",
            ),
            pytest.param(
                "tasks",
                {
                    "SELECT * FROM task_tags": [],
                    "SELECT id FROM check_items": [],
                    "SELECT id, task_id FROM focus_sessions ORDER BY id": [(1, None), (2, None)],
                    "SELECT id, task_id FROM timers ORDER BY id": [(1, None), (2, None)],
                    "SELECT id FROM tags": [(1,)],
                },
                id="task-takes-its-items-and-unlinks-its-history",
            ),
            pytest.param(
                "habits",
                {
                    "SELECT id FROM check_ins": [],
                    "SELECT id, habit_id FROM focus_sessions ORDER BY id": [(1, None), (2, None)],
                    "SELECT id, habit_id FROM timers ORDER BY id": [(1, None), (2, None)],
                },
                id="habit-takes-its-check-ins-and-unlinks-its-history",
            ),
            pytest.param(
                "lists",
                {
                    "SELECT id FROM sections": [],
                    "SELECT id FROM tasks": [],
                    "SELECT id FROM check_items": [],
                    "SELECT id, task_id FROM focus_sessions ORDER BY id": [(1, None), (2, None)],
                    "SELECT id FROM folders": [(1,)],
                },
                id="list-takes-its-sections-and-tasks",
            ),
            pytest.param(
                "goals",
                {"SELECT id FROM key_results": []},
                id="goal-takes-its-key-results",
            ),
            pytest.param(
                "standup_entries",
                {"SELECT id FROM standup_bullets": []},
                id="stand-up-entry-takes-its-bullets",
            ),
        ],
    )
    def test_deleting_a_parent_applies_its_rule(
        self, empty_database_url: str, parent: str, survivors: dict[str, list[tuple]]
    ) -> None:
        config = alembic_config(empty_database_url)
        command.upgrade(config, "0040")
        for statement in LINKED_ROWS:
            run_sql(empty_database_url, statement)
        command.upgrade(config, "head")

        run_sql(empty_database_url, f"DELETE FROM {parent} WHERE id = 1")  # noqa: S608

        for query, rows in survivors.items():
            assert run_sql(empty_database_url, query) == rows, query


# pg_constraint.confdeltype, as the ON DELETE clause SQLAlchemy writes.
PG_DELETE_RULES = {"a": None, "r": "RESTRICT", "c": "CASCADE", "n": "SET NULL"}


class TestDeleteRulesContract:
    """Issue #508: the models declare the same delete rules the migrations
    build, and every foreign key has one. The only exception is the
    foreign keys to `users`: no User is ever deleted, so one who still owns
    rows is refused rather than cascading their account away."""

    def declared_rules(self) -> dict[tuple[str, str], str | None]:
        return {
            (table.name, foreign_key.parent.name): foreign_key.ondelete
            for table in Base.metadata.tables.values()
            for foreign_key in table.foreign_keys
        }

    def test_every_foreign_key_but_the_owners_declares_a_rule(self) -> None:
        for (table, column), ondelete in self.declared_rules().items():
            referred = next(
                fk.column.table.name
                for fk in Base.metadata.tables[table].foreign_keys
                if fk.parent.name == column
            )
            if referred == "users":
                assert ondelete is None, (table, column)
            else:
                assert ondelete in {"CASCADE", "SET NULL"}, (table, column)

    def test_the_migrated_database_matches_the_models(self, database_url: str) -> None:
        rows = run_sql(
            database_url,
            "SELECT c.conrelid::regclass::text, a.attname, c.confdeltype "
            "FROM pg_constraint c JOIN pg_attribute a "
            "ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] WHERE c.contype = 'f'",
        )
        built = {(table, column): PG_DELETE_RULES[rule] for table, column, rule in rows}

        assert built == self.declared_rules()


class TestReminderOptInAtMigration:
    """Review of #565: the missed list is bounded by when the User turned
    Reminder notifications on. A User already opted in is bounded from the
    upgrade, so no stored offset surfaces as missed after it."""

    def test_an_opted_in_user_is_bounded_from_the_upgrade_and_others_never_were_on(
        self, empty_database_url: str
    ) -> None:
        config = alembic_config(empty_database_url)
        command.upgrade(config, "0055_planning_window")
        run_sql(
            empty_database_url,
            "INSERT INTO users (username, email) VALUES ('ana', 'a@x.io'), ('ben', 'b@x.io')",
        )
        run_sql(
            empty_database_url,
            "INSERT INTO user_settings (user_id, reminder_notifications_enabled) "
            "VALUES (1, true), (2, false)",
        )

        command.upgrade(config, "head")

        assert run_sql(
            empty_database_url,
            "SELECT user_id, reminder_notifications_enabled_at > now() - interval '1 minute' "
            "FROM user_settings ORDER BY user_id",
        ) == [(1, True), (2, None)]


class TestGoogleSsoMigration:
    """Issue #586: rolling out invite-only Google sign-in keeps every
    existing User, role, password, setting and Calendar connection as it
    was. No Calendar connection becomes a login identity, and every one
    keeps the client it was made with (its User's own)."""

    def test_existing_accounts_and_connections_survive_unchanged(
        self, empty_database_url: str
    ) -> None:
        config = alembic_config(empty_database_url)
        command.upgrade(config, "0060_github")
        run_sql(
            empty_database_url,
            "INSERT INTO users (id, username, email, password_hash, is_admin) VALUES "
            "(1, 'ana', 'ana@example.com', 'hash-a', true), (2, 'ben', 'ben@example.com', "
            "'hash-b', false)",
        )
        run_sql(
            empty_database_url,
            "INSERT INTO user_settings (user_id, google_client_id, "
            "encrypted_google_client_secret) VALUES (1, 'own-id', 'own-secret'), (2, NULL, NULL)",
        )
        run_sql(
            empty_database_url,
            "INSERT INTO google_accounts (google_account_id, email, encrypted_refresh_token, "
            "connection_state, owner_id, created_at, updated_at) VALUES ('g-ana', "
            "'ana@example.com', 'refresh', 'connected', 1, now(), now())",
        )

        command.upgrade(config, "head")

        assert run_sql(
            empty_database_url,
            "SELECT id, username, password_hash, is_admin, google_subject FROM users ORDER BY id",
        ) == [(1, "ana", "hash-a", True, None), (2, "ben", "hash-b", False, None)]
        assert run_sql(
            empty_database_url,
            "SELECT google_client_id, encrypted_google_client_secret FROM user_settings "
            "WHERE user_id = 1",
        ) == [("own-id", "own-secret")]
        assert run_sql(
            empty_database_url,
            "SELECT google_account_id, encrypted_refresh_token, connection_state, "
            "uses_shared_client FROM google_accounts",
        ) == [("g-ana", "refresh", "connected", False)]
        assert run_sql(empty_database_url, "SELECT count(*) FROM invitations") == [(0,)]

    def test_a_google_login_identity_belongs_to_one_user_and_passwords_stay_optional(
        self, empty_database_url: str
    ) -> None:
        run_migrations(empty_database_url)
        run_sql(
            empty_database_url,
            "INSERT INTO users (username, email, google_subject) VALUES "
            "('ana', 'ana@example.com', 'sub-1')",
        )

        with pytest.raises(psycopg.errors.UniqueViolation):
            run_sql(
                empty_database_url,
                "INSERT INTO users (username, email, google_subject) VALUES "
                "('ben', 'ben@example.com', 'sub-1')",
            )
        assert run_sql(empty_database_url, "SELECT password_hash FROM users") == [(None,)]
