"""SQLAlchemy models. Vocabulary per CONTEXT.md; owner column per ADR 0002."""

from datetime import UTC, date, datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

DEFAULT_OWNER = "local"

# Sparse gap between consecutive sort_order values, so a drag-reorder
# writes one row (the moved one) instead of renumbering all siblings.
SORT_GAP = 1024


def utcnow() -> datetime:
    return datetime.now(UTC)


class AppSettings(Base):
    """The DB-backed settings singleton (ADR 0008): the login password
    hash, the session-cookie signing key, and — added by issue #117, but
    the column shape anticipates it here — the Google OAuth client ID and
    its encrypted client secret. Always exactly one row (`id` fixed at
    `SETTINGS_ID` in app.app_settings), bootstrapped on first boot.

    `password_hash` is nullable: its absence is exactly what gates every
    route behind `/setup` (app.middleware). `encrypted_google_client_secret`
    is encrypted with `APP_MASTER_KEY` (app.crypto), never `session_key` —
    a copy of the SQLite file must not disclose it.
    """

    __tablename__ = "settings"
    __table_args__ = (CheckConstraint("id = 1", name="settings_singleton"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    password_hash: Mapped[str | None] = mapped_column(Text, default=None)
    session_key: Mapped[str] = mapped_column(Text)
    google_client_id: Mapped[str | None] = mapped_column(String(255), default=None)
    encrypted_google_client_secret: Mapped[str | None] = mapped_column(Text, default=None)
    # Assist (ADR 0005). Neither value is sensitive — an Ollama base URL and
    # a model name, not a credential — so unlike the Google secret above,
    # these are stored plain, no encryption needed.
    assist_ollama_base_url: Mapped[str | None] = mapped_column(String(255), default=None)
    assist_model: Mapped[str | None] = mapped_column(String(255), default=None)
    # The Assistant (ADR 0009, issue #185) — entirely independent of Assist
    # above; never read by it and never reads it. `encrypted_assistant_api_key`
    # is encrypted with `APP_MASTER_KEY` (app.crypto), like the Google client
    # secret, since unlike the base URL and model it is a credential.
    assistant_base_url: Mapped[str | None] = mapped_column(String(255), default=None)
    assistant_model: Mapped[str | None] = mapped_column(String(255), default=None)
    encrypted_assistant_api_key: Mapped[str | None] = mapped_column(Text, default=None)
    assistant_planning_preferences: Mapped[str | None] = mapped_column(Text, default=None)
    # UI-only visibility toggle for the Stand-up feature (issue #140):
    # turning it off hides the nav item and route, nothing more — no route
    # is blocked and no stored data is ever touched by this flag.
    standup_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Folder(Base):
    """A Folder — a user-created grouping of Lists in the sidebar."""

    __tablename__ = "folders"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(BigInteger, default=0)
    owner: Mapped[str] = mapped_column(String(64), default=DEFAULT_OWNER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    lists: Mapped[list["TaskList"]] = relationship(back_populates="folder")


class TaskList(Base):
    """A List — a user-created container of tasks. The Inbox is the built-in one."""

    __tablename__ = "lists"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    is_inbox: Mapped[bool] = mapped_column(default=False)
    color: Mapped[str | None] = mapped_column(String(32), default=None)
    emoji: Mapped[str | None] = mapped_column(String(16), default=None)
    is_archived: Mapped[bool] = mapped_column(default=False)
    sort_order: Mapped[int] = mapped_column(BigInteger, default=0)
    view_mode: Mapped[str] = mapped_column(String(6), default="list")
    folder_id: Mapped[int | None] = mapped_column(
        ForeignKey("folders.id"), index=True, default=None
    )
    owner: Mapped[str] = mapped_column(String(64), default=DEFAULT_OWNER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    folder: Mapped[Folder | None] = relationship(back_populates="lists")
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="task_list", cascade="all, delete-orphan"
    )


task_tags = Table(
    "task_tags",
    Base.metadata,
    Column("task_id", ForeignKey("tasks.id"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id"), primary_key=True),
)


class Tag(Base):
    """A Tag — a first-class label (name + color) applied to any number of Tasks."""

    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    color: Mapped[str | None] = mapped_column(String(32), default=None)
    owner: Mapped[str] = mapped_column(String(64), default=DEFAULT_OWNER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Section(Base):
    """A Section — a named, ordered sub-group inside a List (also a Kanban column)."""

    __tablename__ = "sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    list_id: Mapped[int] = mapped_column(ForeignKey("lists.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(BigInteger, default=0)
    owner: Mapped[str] = mapped_column(String(64), default=DEFAULT_OWNER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    completed: Mapped[bool] = mapped_column(default=False)
    # When the task was last completed; drives the completed view's newest-first
    # order. Cleared when the task is reopened.
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    description: Mapped[str] = mapped_column(Text, default="")
    priority: Mapped[str] = mapped_column(String(6), default="none")
    # Scheduling: due only, start+due duration, or all-day span (dates stored
    # as UTC; all-day values are date-only semantics at midnight UTC). The
    # timezone is the IANA key the client scheduled in (v1: browser timezone).
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    is_all_day: Mapped[bool] = mapped_column(default=False)
    time_zone: Mapped[str | None] = mapped_column(String(64), default=None)
    # Reminders: signed ISO-8601 duration offsets from the task's date
    # (iCalendar TRIGGER convention: "PT0S" at time, "-PT30M" 30 min before).
    # Stored only — v1 delivers no notifications (see the PRD).
    reminders: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Recurrence: iCalendar RRULE content (e.g. "FREQ=WEEKLY;BYDAY=MO,TH"),
    # anchored at the task's due date. Completing a recurring task advances
    # its dates in place instead of completing the row (ADR 0003).
    recurrence: Mapped[str | None] = mapped_column(String(255), default=None)
    list_id: Mapped[int] = mapped_column(ForeignKey("lists.id"), index=True)
    section_id: Mapped[int | None] = mapped_column(
        ForeignKey("sections.id"), index=True, default=None
    )
    sort_order: Mapped[int] = mapped_column(BigInteger, default=0)
    owner: Mapped[str] = mapped_column(String(64), default=DEFAULT_OWNER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Provenance of a Task converted from a Google Event (issue #111): which
    # Event it came from, remembered here since Google access is read-only
    # and no Event storage exists to hang this off instead (ADR 0006). Both
    # null for an ordinary Task. Set together; a disconnected calendar SETs
    # NULL on the FK rather than deleting the Task — converting never costs
    # the user the Task itself.
    source_google_calendar_id: Mapped[int | None] = mapped_column(
        ForeignKey("google_calendars.id", ondelete="SET NULL"), default=None
    )
    source_google_event_id: Mapped[str | None] = mapped_column(String(255), default=None)

    task_list: Mapped[TaskList] = relationship(back_populates="tasks")
    # Check Items always travel with their Task (composition), so load them
    # eagerly — async lazy loading would raise on serialization anyway.
    check_items: Mapped[list["CheckItem"]] = relationship(
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="CheckItem.sort_order, CheckItem.id",
        lazy="selectin",
    )
    # Tags travel with their Task in every read, so load them eagerly too.
    # One-directional: nothing navigates Tag -> Tasks in the ORM.
    tags: Mapped[list[Tag]] = relationship(
        secondary=task_tags,
        order_by="Tag.name, Tag.id",
        lazy="selectin",
    )


class CheckItem(Base):
    """A Check Item — one line in a Task's checklist; not a Task itself.

    Composition under a Task (not a root entity), so no owner column —
    ownership flows through the parent Task.
    """

    __tablename__ = "check_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    done: Mapped[bool] = mapped_column(default=False)
    sort_order: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    task: Mapped[Task] = relationship(back_populates="check_items")


class CompletedOccurrence(Base):
    """A Completed Occurrence — the history record written when one occurrence
    of a recurring Task is completed (the Task itself stays open with its date
    advanced). The completed view and statistics read these.

    History under a Task (deleted with it), so no owner column — ownership
    flows through the parent Task.
    """

    __tablename__ = "completed_occurrences"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # The occurrence the user completed: the task's dates before they advanced.
    due_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_all_day: Mapped[bool] = mapped_column(default=False)


class Habit(Base):
    """A Habit — a recurring practice tracked by Check-ins rather than
    completion: Boolean (done / not done) or Numeric (an amount toward a Goal).
    """

    __tablename__ = "habits"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(7), default="boolean")
    # The Numeric target and one tap's increment; Boolean habits keep the
    # defaults (a check-in is the whole goal).
    goal: Mapped[float] = mapped_column(default=1.0)
    step: Mapped[float] = mapped_column(default=1.0)
    unit: Mapped[str | None] = mapped_column(String(32), default=None)
    icon: Mapped[str | None] = mapped_column(String(16), default=None)
    color: Mapped[str | None] = mapped_column(String(32), default=None)
    encouragement: Mapped[str] = mapped_column(String(255), default="")
    # RRULE frequency content: daily, chosen weekdays, or N times per week
    # (TickTick's TT_TIMES extension). See app.habit_frequency.
    frequency: Mapped[str] = mapped_column(String(255), default="FREQ=DAILY")
    # Archived Habits leave the today screen but keep their whole Check-in
    # history; unarchiving restores them.
    is_archived: Mapped[bool] = mapped_column(default=False)
    owner: Mapped[str] = mapped_column(String(64), default=DEFAULT_OWNER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    check_ins: Mapped[list["CheckIn"]] = relationship(
        back_populates="habit", cascade="all, delete-orphan"
    )


class CheckIn(Base):
    """A Check-in — one day's progress on a Habit: a date stamp and, for
    Numeric habits, the accumulated value. Keyed by (habit, date) and
    upserted, so re-taps and backfill corrections are idempotent.

    Composition under a Habit (deleted with it), so no owner column —
    ownership flows through the parent Habit.
    """

    __tablename__ = "check_ins"
    __table_args__ = (UniqueConstraint("habit_id", "date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    habit_id: Mapped[int] = mapped_column(ForeignKey("habits.id"), index=True)
    # The local calendar day the user checked in (the caller's day, like the
    # Smart Lists' `today` parameter) — never a UTC instant.
    date: Mapped[date] = mapped_column(Date)
    value: Mapped[float] = mapped_column(default=1.0)

    habit: Mapped[Habit] = relationship(back_populates="check_ins")


class FocusSession(Base):
    """A Focus Session — one persisted period of focused work, Pomo or
    Stopwatch, optionally linked to a Task or Habit for statistics. Timers
    tick client-side; this row records the finished (or retroactively
    added) period only.
    """

    __tablename__ = "focus_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    mode: Mapped[str] = mapped_column(String(9))
    # At most one link: a session belongs to a Task or a Habit, never both.
    # Deleting the linked row clears the link; the history stays.
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"), index=True, default=None)
    habit_id: Mapped[int | None] = mapped_column(ForeignKey("habits.id"), index=True, default=None)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Wall-clock seconds spent paused: recorded focus time stays honest.
    pause_seconds: Mapped[int] = mapped_column(default=0)
    note: Mapped[str] = mapped_column(Text, default="")
    owner: Mapped[str] = mapped_column(String(64), default=DEFAULT_OWNER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GoogleAccount(Base):
    """A Google Account — a connected Google identity (issue #105): the
    Google-side account id, its email, and its refresh credential encrypted
    at rest (app.crypto, keyed by APP_MASTER_KEY). `connection_state` is
    "connected" or "needs_reconnect"; #105
    only ever writes "connected" — the latter is set once event/calendar
    reads can fail terminally, in a later ticket.

    No owner column: this app has exactly one owner, and a Google Account
    is itself a login credential, not owned data.
    """

    __tablename__ = "google_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    google_account_id: Mapped[str] = mapped_column(String(255), unique=True)
    email: Mapped[str] = mapped_column(String(320))
    encrypted_refresh_token: Mapped[str] = mapped_column(Text)
    connection_state: Mapped[str] = mapped_column(String(16), default="connected")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    calendars: Mapped[list["GoogleCalendar"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )


class GoogleCalendar(Base):
    """A Google Calendar exposed by a connected Google Account (issue #106)
    — one of possibly several a single account offers (primary, secondary,
    shared, holiday/birthday feeds). `enabled` controls whether its Events
    appear in the Calendar view: seeded on connect from Google's own
    per-calendar `selected` flag, then purely local — toggling it here never
    reaches Google. `color` is chosen from tuk-tuk's own palette, never
    Google's, so a calendar's colour never clashes with the app's theme.
    `summary` is cosmetic metadata refreshed on demand; staleness here is
    harmless, unlike stale Events (never persisted — see ADR 0006).
    """

    __tablename__ = "google_calendars"
    __table_args__ = (UniqueConstraint("google_account_id", "google_calendar_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    google_account_id: Mapped[int] = mapped_column(
        ForeignKey("google_accounts.id", ondelete="CASCADE"), index=True
    )
    google_calendar_id: Mapped[str] = mapped_column(String(255))
    summary: Mapped[str] = mapped_column(String(255))
    color: Mapped[str] = mapped_column(String(32))
    enabled: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    account: Mapped[GoogleAccount] = relationship(back_populates="calendars")


class StandupEntry(Base):
    """A Stand-up Entry — one calendar date's daily stand-up: Yesterday /
    Today / Blockers Bullets, plus a Sprint-goal snapshot column (populated
    with an empty placeholder for now; the real Sprint Goal field lands in a
    follow-up ticket). Lazily persisted: navigating to a date with no entry
    shows an editable empty form, and the row exists only once the first
    Bullet is saved for that date (app.routers.v1.stand_up).
    """

    __tablename__ = "standup_entries"
    __table_args__ = (UniqueConstraint("date", "owner"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    sprint_goal_snapshot: Mapped[str] = mapped_column(Text, default="")
    owner: Mapped[str] = mapped_column(String(64), default=DEFAULT_OWNER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    bullets: Mapped[list["StandupBullet"]] = relationship(
        back_populates="entry",
        cascade="all, delete-orphan",
        order_by="StandupBullet.sort_order, StandupBullet.id",
        lazy="selectin",
    )


class StandupBullet(Base):
    """One bullet within a Stand-up Entry's Yesterday / Today / Blockers
    section (`section` discriminator). Each section orders independently via
    its own sparse `sort_order`.

    Composition under a StandupEntry (deleted with it), so no owner column —
    ownership flows through the parent Entry.
    """

    __tablename__ = "standup_bullets"

    id: Mapped[int] = mapped_column(primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("standup_entries.id"), index=True)
    section: Mapped[str] = mapped_column(String(9))
    text: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    entry: Mapped[StandupEntry] = relationship(back_populates="bullets")


class SprintGoal(Base):
    """The single, persistent Sprint-goal text (issue #139) shown as a
    header above the Stand-up detail pane. Editable at any time and applies
    going forward — it is routinely-edited domain data, not app
    configuration, so it lives here rather than on AppSettings. Lazily
    created on first write, like StandupEntry; `StandupEntry.sprint_goal_snapshot`
    copies this row's `text` at Entry-creation time and never changes
    afterward, so editing this row never retroactively touches old Entries.
    """

    __tablename__ = "sprint_goals"
    __table_args__ = (UniqueConstraint("owner"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    text: Mapped[str] = mapped_column(Text, default="")
    owner: Mapped[str] = mapped_column(String(64), default=DEFAULT_OWNER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Timer(Base):
    """A Timer — a saved Focus Session preset (name + mode + duration,
    optionally pre-linked to a Task or Habit) for recurring scenarios like
    "Reading 30m". The tap that starts it is client-side; this row is the
    preset only, never running state.
    """

    __tablename__ = "timers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    mode: Mapped[str] = mapped_column(String(9))
    # The Pomo countdown length; a Stopwatch preset has none (it counts up).
    duration_seconds: Mapped[int | None] = mapped_column(default=None)
    # At most one link, like the sessions the preset starts. Deleting the
    # linked row clears the link; the preset stays.
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"), index=True, default=None)
    habit_id: Mapped[int | None] = mapped_column(ForeignKey("habits.id"), index=True, default=None)
    owner: Mapped[str] = mapped_column(String(64), default=DEFAULT_OWNER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
