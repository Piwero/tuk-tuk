"""SQLite-to-SQLite tests for app.copy_database — everything except
PostgreSQL sequence reseeding (issue #255), which needs a real server and is
exercised by the #254 opt-in job instead.
"""

import shutil
import sqlite3
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.copy_database import (
    CopyReport,
    DatabaseCopyError,
    OrphanedRowsError,
    TargetNotEmptyError,
    copy_database,
)
from app.models import (
    AppSettings,
    CheckIn,
    CheckItem,
    Folder,
    Goal,
    GoogleAccount,
    GoogleCalendar,
    Habit,
    KeyResult,
    Tag,
    Task,
    TaskList,
)


def sqlite_url(path: Path) -> str:
    return f"sqlite:///{path}"


def fresh_migrated_db(migrated_template_db: Path, path: Path) -> str:
    shutil.copyfile(migrated_template_db, path)
    return sqlite_url(path)


def empty_db_url(path: Path) -> str:
    """An unmigrated, nonexistent-file target — run_migrations creates it."""
    return sqlite_url(path)


def row_counts(db_path: Path, tables: list[str]) -> dict[str, int]:
    with sqlite3.connect(db_path) as conn:
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}


@pytest.fixture
def source_path(tmp_path: Path, migrated_template_db: Path) -> Path:
    path = tmp_path / "source.db"
    shutil.copyfile(migrated_template_db, path)
    return path


def test_copy_empty_database_succeeds(source_path: Path, tmp_path: Path) -> None:
    target_path = tmp_path / "target.db"

    report = copy_database(sqlite_url(source_path), sqlite_url(target_path))

    assert report.success
    assert report.tables["tasks"].source_count == 0
    assert report.tables["tasks"].target_count == 0


def _seed_populated_source(source_path: Path) -> dict[str, object]:
    """Folder -> List -> Task -> CheckItem, Tag<->Task, Habit -> CheckIn,
    Goal -> KeyResult, GoogleAccount -> GoogleCalendar, plus the settings
    singleton — every relationship the acceptance criteria names."""
    created_at = datetime(2026, 1, 2, 3, 4, 5, 123456, tzinfo=UTC)
    engine = create_engine(sqlite_url(source_path))
    with Session(engine) as session:
        folder = Folder(id=1, name="Work", created_at=created_at)
        task_list = TaskList(id=1, name="Inbox", is_inbox=True, folder_id=1, created_at=created_at)
        tag = Tag(id=1, name="urgent", created_at=created_at)
        task = Task(id=1, title="Write code", list_id=1, created_at=created_at, tags=[tag])
        check_item = CheckItem(id=1, task_id=1, title="Step 1", created_at=created_at)
        habit = Habit(id=1, name="Read", created_at=created_at)
        check_in = CheckIn(id=1, habit_id=1, date=date(2026, 1, 2), value=1.0)
        goal = Goal(id=1, title="Ship v2", created_at=created_at)
        key_result = KeyResult(id=1, goal_id=1, name="Tasks done", created_at=created_at)
        account = GoogleAccount(
            id=1,
            google_account_id="g-1",
            email="a@example.com",
            encrypted_refresh_token="enc:abc123==",
            created_at=created_at,
        )
        calendar = GoogleCalendar(
            id=1,
            google_account_id=1,
            google_calendar_id="cal-1",
            summary="Primary",
            color="#fff",
            created_at=created_at,
        )
        session.add_all(
            [folder, task_list, tag, task, check_item, habit, check_in, goal, key_result]
        )
        settings_row = AppSettings(
            id=1, password_hash="hash123", session_key="sesskey456", created_at=created_at
        )
        session.add_all([account, calendar, settings_row])
        session.commit()
    engine.dispose()
    return {"created_at": created_at}


def test_copy_populated_database_preserves_rows_ids_and_relationships(
    source_path: Path, tmp_path: Path
) -> None:
    seed = _seed_populated_source(source_path)
    target_path = tmp_path / "target.db"

    report = copy_database(sqlite_url(source_path), sqlite_url(target_path))

    assert report.success
    target_engine = create_engine(sqlite_url(target_path))
    with Session(target_engine) as session:
        task = session.get(Task, 1)
        assert task is not None
        assert task.list_id == 1
        assert task.task_list.folder_id == 1
        assert [t.id for t in task.tags] == [1]
        assert task.check_items[0].id == 1

        check_in = session.get(CheckIn, 1)
        assert check_in is not None
        assert check_in.habit_id == 1

        key_result = session.get(KeyResult, 1)
        assert key_result is not None
        assert key_result.goal_id == 1

        calendar = session.get(GoogleCalendar, 1)
        assert calendar is not None
        assert calendar.google_account_id == 1
        assert calendar.account.encrypted_refresh_token == "enc:abc123=="

        # Settings singleton, encrypted refresh token, and timestamp precision.
        account = session.get(GoogleAccount, 1)
        assert account is not None
        assert account.encrypted_refresh_token == "enc:abc123=="
        # SQLite's driver round-trips a stored timestamp as naive (drops
        # tzinfo) regardless of copy — the microsecond precision is what
        # matters here, not the tzinfo object identity.
        expected_created_at = seed["created_at"]
        assert isinstance(expected_created_at, datetime)
        assert account.created_at.replace(tzinfo=UTC) == expected_created_at
        assert account.created_at.microsecond == expected_created_at.microsecond

    with sqlite3.connect(target_path) as conn:
        password_hash, session_key = conn.execute(
            "SELECT password_hash, session_key FROM settings WHERE id = 1"
        ).fetchone()
        assert password_hash == "hash123"
        assert session_key == "sesskey456"


def test_orphaned_check_item_is_detected_and_named_in_refusal(
    source_path: Path, tmp_path: Path
) -> None:
    with sqlite3.connect(source_path) as conn:
        conn.execute(
            "INSERT INTO lists (id, name, is_inbox, is_archived, sort_order, view_mode, owner, "
            "created_at) VALUES (1, 'Inbox', 1, 0, 0, 'list', 'local', '2026-01-01T00:00:00+00:00')"
        )
        conn.execute(
            "INSERT INTO tasks (id, title, completed, description, priority, is_all_day, "
            "reminders, list_id, sort_order, owner, created_at) VALUES "
            "(1, 'Task', 0, '', 'none', 0, '[]', 1, 0, 'local', '2026-01-01T00:00:00+00:00')"
        )
        # A check item pointing at a nonexistent task — bypasses the ORM's FK
        # validation on purpose, since SQLite doesn't enforce FKs by default.
        conn.execute(
            "INSERT INTO check_items (id, task_id, title, done, sort_order, created_at) VALUES "
            "(1, 999, 'Orphan', 0, 0, '2026-01-01T00:00:00+00:00')"
        )
        conn.commit()

    with pytest.raises(OrphanedRowsError) as exc_info:
        copy_database(sqlite_url(source_path), sqlite_url(tmp_path / "target.db"))

    assert "check_items" in str(exc_info.value)
    assert "task_id" in str(exc_info.value)


def test_orphaned_task_and_key_result_are_both_detected_and_named(
    source_path: Path, tmp_path: Path
) -> None:
    with sqlite3.connect(source_path) as conn:
        # A Task pointing at a nonexistent list.
        conn.execute(
            "INSERT INTO tasks (id, title, completed, description, priority, is_all_day, "
            "reminders, list_id, sort_order, owner, created_at) VALUES "
            "(1, 'Orphan task', 0, '', 'none', 0, '[]', 999, 0, 'local', "
            "'2026-01-01T00:00:00+00:00')"
        )
        # A Task pointing at a nonexistent key result.
        conn.execute(
            "INSERT INTO lists (id, name, is_inbox, is_archived, sort_order, view_mode, owner, "
            "created_at) VALUES (1, 'Inbox', 1, 0, 0, 'list', 'local', '2026-01-01T00:00:00+00:00')"
        )
        conn.execute(
            "INSERT INTO tasks (id, title, completed, description, priority, is_all_day, "
            "reminders, list_id, sort_order, owner, created_at, key_result_id) VALUES "
            "(2, 'Task with bad KR', 0, '', 'none', 0, '[]', 1, 0, 'local', "
            "'2026-01-01T00:00:00+00:00', 999)"
        )
        conn.commit()

    with pytest.raises(OrphanedRowsError) as exc_info:
        copy_database(sqlite_url(source_path), sqlite_url(tmp_path / "target.db"))

    message = str(exc_info.value)
    assert "tasks" in message
    assert "list_id" in message
    assert "key_result_id" in message


def test_prune_orphans_removes_them_and_allows_copy_to_proceed(
    source_path: Path, tmp_path: Path
) -> None:
    with sqlite3.connect(source_path) as conn:
        conn.execute(
            "INSERT INTO tasks (id, title, completed, description, priority, is_all_day, "
            "reminders, list_id, sort_order, owner, created_at) VALUES "
            "(1, 'Orphan task', 0, '', 'none', 0, '[]', 999, 0, 'local', "
            "'2026-01-01T00:00:00+00:00')"
        )
        conn.commit()
    before = row_counts(source_path, ["tasks"])
    assert before["tasks"] == 1

    report = copy_database(
        sqlite_url(source_path), sqlite_url(tmp_path / "target.db"), prune_orphans=True
    )

    assert report.success
    assert report.pruned["tasks"]["list_id"] == [1]
    after = row_counts(source_path, ["tasks"])
    assert after["tasks"] == 0  # only prune_orphans is allowed to mutate the source


def test_prune_reports_rows_orphaned_by_its_own_deletions(
    source_path: Path, tmp_path: Path
) -> None:
    """A pruned Task orphans its own Check Items. Those go too — but every
    id deleted is named in the report, so nothing disappears silently."""
    with sqlite3.connect(source_path) as conn:
        conn.execute(
            "INSERT INTO tasks (id, title, completed, description, priority, is_all_day, "
            "reminders, list_id, sort_order, owner, created_at) VALUES "
            "(1, 'Orphan task', 0, '', 'none', 0, '[]', 999, 0, 'local', "
            "'2026-01-01T00:00:00+00:00')"
        )
        conn.execute(
            "INSERT INTO check_items (id, task_id, title, done, sort_order, created_at) VALUES "
            "(1, 1, 'Step 1', 0, 0, '2026-01-01T00:00:00+00:00')"
        )
        conn.commit()

    report = copy_database(
        sqlite_url(source_path), sqlite_url(tmp_path / "target.db"), prune_orphans=True
    )

    assert report.success
    assert report.pruned["tasks"]["list_id"] == [1]
    assert report.pruned["check_items"]["task_id"] == [1]
    assert row_counts(source_path, ["check_items"])["check_items"] == 0


def test_non_empty_target_refused_without_force_accepted_with_force(
    source_path: Path, tmp_path: Path, migrated_template_db: Path
) -> None:
    target_path = tmp_path / "target.db"
    shutil.copyfile(migrated_template_db, target_path)
    with sqlite3.connect(target_path) as conn:
        conn.execute(
            "INSERT INTO lists (id, name, is_inbox, is_archived, sort_order, view_mode, owner, "
            "created_at) VALUES (1, 'Inbox', 1, 0, 0, 'list', 'local', '2026-01-01T00:00:00+00:00')"
        )
        conn.commit()

    with pytest.raises(TargetNotEmptyError) as exc_info:
        copy_database(sqlite_url(source_path), sqlite_url(target_path))
    assert "lists" in str(exc_info.value)
    assert "DELETE" in str(exc_info.value)  # --force destroys; say so before it is used

    report = copy_database(sqlite_url(source_path), sqlite_url(target_path), force=True)
    assert report.success
    assert report.cleared["lists"] == 1  # what --force destroyed, named in the report
    assert "Deleted existing rows from the target" in str(report)


def test_verification_reports_matching_counts_and_max_ids(
    source_path: Path, tmp_path: Path
) -> None:
    _seed_populated_source(source_path)
    target_path = tmp_path / "target.db"

    report = copy_database(sqlite_url(source_path), sqlite_url(target_path))

    assert isinstance(report, CopyReport)
    tasks_report = report.tables["tasks"]
    assert tasks_report.source_count == tasks_report.target_count == 1
    assert tasks_report.source_max_id == tasks_report.target_max_id == 1


def test_source_is_never_modified_by_a_successful_copy(source_path: Path, tmp_path: Path) -> None:
    _seed_populated_source(source_path)
    before = row_counts(source_path, ["folders", "lists", "tasks", "tags", "habits"])

    copy_database(sqlite_url(source_path), sqlite_url(tmp_path / "target.db"))

    after = row_counts(source_path, ["folders", "lists", "tasks", "tags", "habits"])
    assert after == before


def test_a_mid_copy_failure_says_the_target_is_not_trustworthy(
    source_path: Path, tmp_path: Path, migrated_template_db: Path
) -> None:
    """A target that passes preflight but breaks partway through: the copy
    fails with a message telling the operator the target holds an unknown
    partial state, rather than a bare driver traceback."""
    _seed_populated_source(source_path)
    target_path = tmp_path / "target.db"
    shutil.copyfile(migrated_template_db, target_path)
    with sqlite3.connect(target_path) as conn:
        # Empty (so preflight passes) but structurally broken, so the insert
        # into `tasks` fails after earlier tables have already been written.
        conn.execute("DROP TABLE tasks")
        conn.commit()

    with pytest.raises(DatabaseCopyError) as exc_info:
        copy_database(sqlite_url(source_path), sqlite_url(target_path))

    message = str(exc_info.value)
    assert "inspect the target before retrying" in message
    assert row_counts(target_path, ["lists"])["lists"] == 1  # partial, and the message says so


def test_source_is_never_modified_by_a_failed_preflight(source_path: Path, tmp_path: Path) -> None:
    with sqlite3.connect(source_path) as conn:
        conn.execute(
            "INSERT INTO tasks (id, title, completed, description, priority, is_all_day, "
            "reminders, list_id, sort_order, owner, created_at) VALUES "
            "(1, 'Orphan task', 0, '', 'none', 0, '[]', 999, 0, 'local', "
            "'2026-01-01T00:00:00+00:00')"
        )
        conn.commit()
    before = row_counts(source_path, ["tasks"])

    with pytest.raises(OrphanedRowsError):
        copy_database(sqlite_url(source_path), sqlite_url(tmp_path / "target.db"))

    after = row_counts(source_path, ["tasks"])
    assert after == before
