"""SQLAlchemy models. Vocabulary per GLOSSARY.md; every owned row carries an
`owner_id` (issue #408)."""

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
    Index,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

# User #1: the admin an existing single-user install's data was migrated to
# (migration 0035).
SEED_USER_ID = 1

# Sparse gap between consecutive sort_order values, so a drag-reorder
# writes one row (the moved one) instead of renumbering all siblings.
SORT_GAP = 1024


def utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    """A person with their own login and their own data (issue #405).

    `email` is nullable only while `must_complete_profile` is set: the
    seeded user #1 has none until its profile is completed. The login
    lockout lives here, per user (moved off `settings`, issue #408):
    persisted so it survives a pod restart (issue #333/#339), but correct
    across restarts only, NOT across replicas: two pods would race on
    read-then-write, so `replicas: 1` stays load-bearing.
    `login_locked_until` null means not locked; see app.login_throttle.
    """

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "email IS NOT NULL OR must_complete_profile",
            name="users_email_until_profile_complete",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(CITEXT, unique=True)
    email: Mapped[str | None] = mapped_column(CITEXT, unique=True, default=None)
    password_hash: Mapped[str | None] = mapped_column(Text, default=None)
    is_admin: Mapped[bool] = mapped_column(default=False)
    is_active: Mapped[bool] = mapped_column(default=True)
    session_epoch: Mapped[int] = mapped_column(default=0)
    must_change_password: Mapped[bool] = mapped_column(default=False)
    must_complete_profile: Mapped[bool] = mapped_column(default=False)
    # When the password was last set (issue #475): on creation, on an
    # Admin's temporary password, and on the User's own change. Shown only
    # to the User themselves (GET /auth/me), never in the admin list.
    password_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # When the User was last served an authenticated request (issue #478),
    # written at most once every few minutes (app.middleware); null until
    # first use. Shown to Admins in the users list.
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    login_failed_attempts: Mapped[int] = mapped_column(default=0)
    login_locked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class OwnedMixin:
    """Every owned table, children included, carries its own `owner_id`, so
    isolating one user's rows never depends on a join (issue #405).

    Nothing here filters or fills it: app.ownership does both, for every
    session the app opens (issue #411). There is deliberately no default,
    so a row created outside that filter fails the NOT NULL rather than
    landing on some User.

    No ON DELETE rule, unlike every other foreign key (issue #508): no User
    is ever deleted, and deleting one who still owns rows must be refused
    rather than cascade their whole account away.
    """

    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)


class AppSettings(Base):
    """The DB-backed settings singleton (ADR 0008), down to what is still
    install-wide (issue #409): the session-cookie signing key. Always
    exactly one row (`id` fixed at `SETTINGS_ID` in app.app_settings),
    bootstrapped on first boot. Passwords live on each User (issue #410).
    """

    __tablename__ = "settings"
    __table_args__ = (CheckConstraint("id = 1", name="settings_singleton"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    session_key: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class UserSettings(Base):
    """One user's own settings, 1:1 with `users` (issue #409, ADR 0018):
    everything the `settings` singleton used to hold except the session
    key. Each user brings their own integrations. Created together with
    the user (app.users.create_user) and read through
    app.user_settings.current_user_settings only.

    Every `encrypted_*` column is encrypted with `APP_MASTER_KEY`
    (app.crypto), never `session_key`: a copy of the database must not
    disclose it.
    """

    __tablename__ = "user_settings"

    # No ON DELETE rule, like OwnedMixin.owner_id: no User is ever deleted.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
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
    # The Voice Assistant's LiveKit connection (ADR 0015, issue #366). Only
    # the API secret is a credential, so — like `encrypted_assistant_api_key`
    # — it is encrypted with `APP_MASTER_KEY`; the URL and key are plain.
    voice_livekit_url: Mapped[str | None] = mapped_column(String(255), default=None)
    voice_livekit_api_key: Mapped[str | None] = mapped_column(String(255), default=None)
    encrypted_voice_livekit_api_secret: Mapped[str | None] = mapped_column(Text, default=None)
    # UI-only visibility toggle for the Stand-up feature (issue #140):
    # turning it off hides the nav item and route, nothing more — no route
    # is blocked and no stored data is ever touched by this flag.
    standup_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Same UI-only visibility pattern as standup_enabled above, one flag per
    # section (this feature): all default to True so an upgrade shows every
    # nav item exactly as before, until someone turns one off in Settings.
    calendar_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    goals_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    habits_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    focus_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    assistant_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Active hours (issue #210): the band of the day the Calendar renders at
    # double height, so short tasks stay readable in place. Describes the
    # user, not a browser — hence server-side, like standup_enabled above,
    # not in the frontend's per-device layoutPrefs. Disabled by default so an
    # existing install's grid is byte-identical after upgrade; the first
    # enable prefills 09:00–17:00 in the UI. Start/end are "HH:MM" wall-clock
    # labels aligned to 30 minutes, start strictly before end, no wrap past
    # midnight (validated in the router).
    active_hours_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    active_hours_start: Mapped[str] = mapped_column(String(5), default="09:00")
    active_hours_end: Mapped[str] = mapped_column(String(5), default="17:00")
    # Gentle return (issue #548): Today collapses every earlier overdue Task
    # behind a counted disclosure. Chosen by the User, never inferred; off by
    # default so Today is unchanged after upgrade.
    gentle_return_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Reminder notifications (issue #557): the User opts in to Reminder
    # delivery. Off by default so stored Reminder offsets never start
    # notifying after upgrade. Browser permission is per device and stays in
    # the browser; this flag only records the User's choice.
    reminder_notifications_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Quiet hours (issue #567): a band of the day during which Reminder
    # notifications are held and delivered once when it ends. "HH:MM"
    # wall-clock labels read in the claiming tab's zone; the band may wrap
    # past midnight (start after end). Not Active hours, which only shapes
    # the Calendar grid and never delivery.
    quiet_hours_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    quiet_hours_start: Mapped[str] = mapped_column(String(5), default="22:00")
    quiet_hours_end: Mapped[str] = mapped_column(String(5), default="07:00")
    # Planning window (issue #563): the band of each day the capacity summary
    # measures available time against. The User's own choice, stored apart
    # from Active hours so changing the grid band never moves it. Off by
    # default; same "HH:MM" 30-minute grid and no-wrap rule (router-validated).
    planning_window_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    planning_window_start: Mapped[str] = mapped_column(String(5), default="09:00")
    planning_window_end: Mapped[str] = mapped_column(String(5), default="17:00")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Folder(OwnedMixin, Base):
    """A Folder — a user-created grouping of Lists in the sidebar."""

    __tablename__ = "folders"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    lists: Mapped[list["TaskList"]] = relationship(back_populates="folder")


class TaskList(OwnedMixin, Base):
    """A List — a user-created container of tasks. The Inbox is the built-in one."""

    __tablename__ = "lists"
    # One Inbox per user.
    __table_args__ = (
        Index(
            "uq_lists_owner_id_inbox", "owner_id", unique=True, postgresql_where=text("is_inbox")
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    is_inbox: Mapped[bool] = mapped_column(default=False)
    color: Mapped[str | None] = mapped_column(String(32), default=None)
    emoji: Mapped[str | None] = mapped_column(String(16), default=None)
    is_archived: Mapped[bool] = mapped_column(default=False)
    sort_order: Mapped[int] = mapped_column(BigInteger, default=0)
    view_mode: Mapped[str] = mapped_column(String(6), default="list")
    folder_id: Mapped[int | None] = mapped_column(
        ForeignKey("folders.id", ondelete="SET NULL"), index=True, default=None
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    folder: Mapped[Folder | None] = relationship(back_populates="lists")
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="task_list", cascade="all, delete-orphan", passive_deletes=True
    )


task_tags = Table(
    "task_tags",
    Base.metadata,
    Column("task_id", ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class Tag(OwnedMixin, Base):
    """A Tag — a first-class label (name + color) applied to any number of Tasks."""

    __tablename__ = "tags"
    # A user's Tag names are unique ignoring case: "Work" and "work" would
    # read as the same Tag in the sidebar.
    __table_args__ = (
        Index("uq_tags_owner_id_lower_name", "owner_id", func.lower(text("name")), unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    color: Mapped[str | None] = mapped_column(String(32), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Section(OwnedMixin, Base):
    """A Section — a named, ordered sub-group inside a List (also a Kanban column)."""

    __tablename__ = "sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    list_id: Mapped[int] = mapped_column(ForeignKey("lists.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Task(OwnedMixin, Base):
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
    # Delivered only to an open tab of a User who opted in (issue #561,
    # ADR 0019; ledger in ReminderDelivery).
    reminders: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Recurrence: iCalendar RRULE content (e.g. "FREQ=WEEKLY;BYDAY=MO,TH"),
    # anchored at the task's due date. Completing a recurring task advances
    # its dates in place instead of completing the row (ADR 0003).
    recurrence: Mapped[str | None] = mapped_column(String(255), default=None)
    # Planned work (issue #558): at most one optional block of reserved work
    # time, held apart from start/due — moving or removing it never touches
    # the deadline, and it is not a Reminder anchor. Start, duration and
    # timezone are set together (all null = no plan); the buffer is optional.
    planned_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    planned_duration_minutes: Mapped[int | None] = mapped_column(default=None)
    planned_time_zone: Mapped[str | None] = mapped_column(String(64), default=None)
    planned_buffer_minutes: Mapped[int | None] = mapped_column(default=None)
    list_id: Mapped[int] = mapped_column(ForeignKey("lists.id", ondelete="CASCADE"), index=True)
    section_id: Mapped[int | None] = mapped_column(
        ForeignKey("sections.id", ondelete="SET NULL"), index=True, default=None
    )
    sort_order: Mapped[int] = mapped_column(BigInteger, default=0)
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
    # The Key Result this Task's completion counts toward, if any (ADR 0012,
    # issue #236). A nullable FK, not a join table: a Task serves at most
    # one outcome. SET NULL on Key Result deletion — deleting a Key Result
    # never costs the user the Task.
    key_result_id: Mapped[int | None] = mapped_column(
        ForeignKey("key_results.id", ondelete="SET NULL"), index=True, default=None
    )

    @property
    def planned_work(self) -> dict[str, object] | None:
        """The planned work block as one value, or None when unplanned."""
        if self.planned_start is None or self.planned_duration_minutes is None:
            return None
        return {
            "start": self.planned_start,
            "duration_minutes": self.planned_duration_minutes,
            "time_zone": self.planned_time_zone,
            "buffer_minutes": self.planned_buffer_minutes,
        }

    def clear_planned_work(self) -> None:
        self.planned_start = None
        self.planned_duration_minutes = None
        self.planned_time_zone = None
        self.planned_buffer_minutes = None

    task_list: Mapped[TaskList] = relationship(back_populates="tasks")
    # Check Items always travel with their Task (composition), so load them
    # eagerly — async lazy loading would raise on serialization anyway.
    check_items: Mapped[list["CheckItem"]] = relationship(
        back_populates="task",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="CheckItem.sort_order, CheckItem.id",
        lazy="selectin",
    )
    # Tags travel with their Task in every read, so load them eagerly too.
    # One-directional: nothing navigates Tag -> Tasks in the ORM.
    tags: Mapped[list[Tag]] = relationship(
        secondary=task_tags,
        passive_deletes=True,
        order_by="Tag.name, Tag.id",
        lazy="selectin",
    )


class CheckItem(OwnedMixin, Base):
    """A Check Item — one line in a Task's checklist; not a Task itself.

    Composition under a Task (not a root entity); it still carries its own
    `owner_id` (OwnedMixin), always the parent Task's.
    """

    __tablename__ = "check_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    done: Mapped[bool] = mapped_column(default=False)
    sort_order: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    task: Mapped[Task] = relationship(back_populates="check_items")


class CompletedOccurrence(OwnedMixin, Base):
    """A Completed Occurrence — the history record written when one occurrence
    of a recurring Task is completed (the Task itself stays open with its date
    advanced). The completed view and statistics read these.

    History under a Task (deleted with it); it still carries its own
    `owner_id` (OwnedMixin), always the parent Task's.
    """

    __tablename__ = "completed_occurrences"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # The occurrence the user completed: the task's dates before they advanced.
    due_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_all_day: Mapped[bool] = mapped_column(default=False)


class Habit(OwnedMixin, Base):
    """A Habit — a recurring practice tracked by Check-ins rather than
    completion: Boolean (done / not done) or Numeric (an amount toward a
    Target). Not to be confused with a Goal, which is its own entity.
    """

    __tablename__ = "habits"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(7), default="boolean")
    # The Numeric target and one tap's increment; Boolean habits keep the
    # defaults (a check-in is the whole target).
    target: Mapped[float] = mapped_column(default=1.0)
    step: Mapped[float] = mapped_column(default=1.0)
    unit: Mapped[str | None] = mapped_column(String(32), default=None)
    icon: Mapped[str | None] = mapped_column(String(16), default=None)
    color: Mapped[str | None] = mapped_column(String(32), default=None)
    encouragement: Mapped[str] = mapped_column(String(255), default="")
    # RRULE frequency content: daily, chosen weekdays, or N times per week
    # (a TT_TIMES extension parameter). See app.habit_frequency.
    frequency: Mapped[str] = mapped_column(String(255), default="FREQ=DAILY")
    # Archived Habits leave the today screen but keep their whole Check-in
    # history; unarchiving restores them.
    is_archived: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    check_ins: Mapped[list["CheckIn"]] = relationship(
        back_populates="habit", cascade="all, delete-orphan", passive_deletes=True
    )
    pauses: Mapped[list["HabitPause"]] = relationship(
        back_populates="habit",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by="HabitPause.start_date",
    )
    skips: Mapped[list["HabitSkip"]] = relationship(
        back_populates="habit",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by="HabitSkip.date",
    )


class CheckIn(OwnedMixin, Base):
    """A Check-in — one day's progress on a Habit: a date stamp and, for
    Numeric habits, the accumulated value. Keyed by (habit, date) and
    upserted, so re-taps and backfill corrections are idempotent.

    Composition under a Habit (deleted with it); it still carries its own
    `owner_id` (OwnedMixin), always the parent Habit's.
    """

    __tablename__ = "check_ins"
    __table_args__ = (UniqueConstraint("habit_id", "date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    habit_id: Mapped[int] = mapped_column(ForeignKey("habits.id", ondelete="CASCADE"), index=True)
    # The local calendar day the user checked in (the caller's day, like the
    # Smart Lists' `today` parameter) — never a UTC instant.
    date: Mapped[date] = mapped_column(Date)
    value: Mapped[float] = mapped_column(default=1.0)

    habit: Mapped[Habit] = relationship(back_populates="check_ins")


class HabitPause(OwnedMixin, Base):
    """A Habit pause (issue #559) — an explicit date interval, both ends
    inclusive local days, whose days are not eligible: neither done nor
    missed. `end_date` None is open-ended. A Habit's pauses never overlap,
    and never cover a date holding a Check-in (app.routers.v1.habits).

    Composition under a Habit (deleted with it), carrying its own
    `owner_id` like a Check-in.
    """

    __tablename__ = "habit_pauses"

    id: Mapped[int] = mapped_column(primary_key=True)
    habit_id: Mapped[int] = mapped_column(ForeignKey("habits.id", ondelete="CASCADE"), index=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date, default=None)

    habit: Mapped[Habit] = relationship(back_populates="pauses")


class ReminderDelivery(OwnedMixin, Base):
    """One entry of the delivery ledger (issue #561, ADR 0019): a Reminder
    of one Task occurrence that an open tab claimed for display.

    Keyed by (Task, Reminder offset, occurrence due date): the unique key is
    what makes one occurrence notify once however many tabs claim it. The
    lease (`lease_token`, `lease_expires_at`) says which tab holds it; an
    unreported lease that expires is retried (app.reminder_delivery).
    `fire_at` is when this occurrence's Reminder came due. History under a
    Task (deleted with it), carrying its own `owner_id`.
    """

    __tablename__ = "reminder_deliveries"
    __table_args__ = (UniqueConstraint("task_id", "offset", "occurrence_due"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    offset: Mapped[str] = mapped_column(String(32))
    occurrence_due: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    fire_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # "claimed" (a tab holds or held the lease), "shown" (the browser
    # reported display), "failed" (the browser refused to show it) or
    # "snoozed" (the User asked for it again at `snoozed_until`, issue #566).
    # "dismissed" (the User dismissed it as a missed reminder, issue #565).
    state: Mapped[str] = mapped_column(String(16), default="claimed")
    attempts: Mapped[int] = mapped_column(default=1)
    lease_token: Mapped[str] = mapped_column(String(64))
    lease_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    claimed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    # The User's snooze (issue #566): while set, this occurrence's Reminder
    # comes due at this instant instead of `fire_at`. An override on the
    # delivery only; the Task's dates and offsets never change.
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    # Every read names its Task, so load it with the row.
    task: Mapped[Task] = relationship(lazy="joined")


class HabitSkip(OwnedMixin, Base):
    """A Habit skip (issue #564) — one scheduled local day the User
    explicitly marks as not practised: neither done nor missed, unlike a
    forgotten (missed) day. Keyed by (habit, date); never placed on an
    unscheduled or paused day, nor on a date holding a Check-in
    (app.routers.v1.habits).

    Composition under a Habit (deleted with it), carrying its own
    `owner_id` like a Check-in.
    """

    __tablename__ = "habit_skips"
    __table_args__ = (UniqueConstraint("habit_id", "date", name="uq_habit_skips_habit_id_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    habit_id: Mapped[int] = mapped_column(ForeignKey("habits.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date)

    habit: Mapped[Habit] = relationship(back_populates="skips")


class Goal(OwnedMixin, Base):
    """A Goal — a durable outcome with a window (ADR 0012). OKR spine (title
    is the Wish, description the Outcome) with WOOP's obstacle/if_then_plan
    on top, both nullable so a Goal is creatable in seconds. Goals do not
    nest and there is no Theme entity.
    """

    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    obstacle: Mapped[str | None] = mapped_column(Text, default=None)
    if_then_plan: Mapped[str | None] = mapped_column(Text, default=None)
    # Nullable only for the Sprint Goal seed migration's carried-over Goal
    # (ADR 0012, issue #238): "no window". Every user-created Goal still
    # gets a window — the router fills in the current quarter by default.
    start_date: Mapped[date | None] = mapped_column(Date, default=None)
    end_date: Mapped[date | None] = mapped_column(Date, default=None)
    status: Mapped[str] = mapped_column(String(9), default="active")
    is_focused: Mapped[bool] = mapped_column(default=False)
    final_score: Mapped[float | None] = mapped_column(default=None)
    retro: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    # Key Results always travel with their Goal (composition), so load them
    # eagerly — async lazy loading would raise on serialization anyway.
    key_results: Mapped[list["KeyResult"]] = relationship(
        back_populates="goal",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="KeyResult.sort_order, KeyResult.id",
        lazy="selectin",
    )


class KeyResult(OwnedMixin, Base):
    """A Key Result — one measurable number belonging to a Goal (ADR 0012).
    `source` is "manual" (typed in, `current_value` is a stored column),
    "habit_checkins" (summed from the linked Habit's Check-ins inside the
    Goal's window, computed on read), or "task_count" (count of completed
    Tasks linking to this Key Result, computed on read). `current_value` is
    only meaningful/writable for "manual" — automatic sources reject writes
    to it with a 409 and compute the value in the read path instead.

    Composition under a Goal (deleted with it); it still carries its own
    `owner_id` (OwnedMixin), always the parent Goal's.
    """

    __tablename__ = "key_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    goal_id: Mapped[int] = mapped_column(ForeignKey("goals.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    source: Mapped[str] = mapped_column(String(16), default="manual")
    start_value: Mapped[float] = mapped_column(default=0.0)
    target_value: Mapped[float] = mapped_column(default=1.0)
    current_value: Mapped[float] = mapped_column(default=0.0)
    # Set only when source == "habit_checkins". SET NULL on Habit deletion:
    # the Key Result degrades to counting nothing rather than breaking the
    # Goal (ADR 0012).
    source_habit_id: Mapped[int | None] = mapped_column(
        ForeignKey("habits.id", ondelete="SET NULL"), index=True, default=None
    )
    sort_order: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    goal: Mapped[Goal] = relationship(back_populates="key_results")


class FocusSession(OwnedMixin, Base):
    """A Focus Session — one persisted period of focused work, Pomo or
    Stopwatch, optionally linked to a Task or Habit for statistics. Timers
    tick client-side; this row records the finished (or retroactively
    added) period only.
    """

    __tablename__ = "focus_sessions"
    __table_args__ = (
        UniqueConstraint(
            "owner_id", "client_run_id", name="uq_focus_sessions_owner_id_client_run_id"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    mode: Mapped[str] = mapped_column(String(9))
    # At most one link: a session belongs to a Task or a Habit, never both.
    # Deleting the linked row clears the link; the history stays.
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), index=True, default=None
    )
    habit_id: Mapped[int | None] = mapped_column(
        ForeignKey("habits.id", ondelete="SET NULL"), index=True, default=None
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Wall-clock seconds spent paused: recorded focus time stays honest.
    pause_seconds: Mapped[int] = mapped_column(default=0)
    note: Mapped[str] = mapped_column(Text, default="")
    # The client's identity for the run this session records (issue #546):
    # a retried finish for the same run finds this row instead of adding one.
    client_run_id: Mapped[str | None] = mapped_column(String(64), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GoogleAccount(OwnedMixin, Base):
    """A Google Account — a connected Google identity (issue #105): the
    Google-side account id, its email, and its refresh credential encrypted
    at rest (app.crypto, keyed by APP_MASTER_KEY). `connection_state` is
    "connected" or "needs_reconnect"; #105
    only ever writes "connected" — the latter is set once event/calendar
    reads can fail terminally, in a later ticket.

    Owned like any other row: each user connects their own Google
    Accounts, and the same Google identity may be connected by two users.
    """

    __tablename__ = "google_accounts"
    __table_args__ = (UniqueConstraint("owner_id", "google_account_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    google_account_id: Mapped[str] = mapped_column(String(255))
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


class GoogleCalendar(OwnedMixin, Base):
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


class StandupEntry(OwnedMixin, Base):
    """A Stand-up Entry — one calendar date's daily stand-up: Yesterday /
    Today / Blockers Bullets, plus a Sprint-goal snapshot column (populated
    with an empty placeholder for now; the real Sprint Goal field lands in a
    follow-up ticket). Lazily persisted: navigating to a date with no entry
    shows an editable empty form, and the row exists only once the first
    Bullet is saved for that date (app.routers.v1.stand_up).
    """

    __tablename__ = "standup_entries"
    __table_args__ = (UniqueConstraint("date", "owner_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    sprint_goal_snapshot: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    bullets: Mapped[list["StandupBullet"]] = relationship(
        back_populates="entry",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="StandupBullet.sort_order, StandupBullet.id",
        lazy="selectin",
    )


class StandupBullet(OwnedMixin, Base):
    """One bullet within a Stand-up Entry's Yesterday / Today / Blockers
    section (`section` discriminator). Each section orders independently via
    its own sparse `sort_order`.

    Composition under a StandupEntry (deleted with it); it still carries
    its own `owner_id` (OwnedMixin), always the parent Entry's.
    """

    __tablename__ = "standup_bullets"

    id: Mapped[int] = mapped_column(primary_key=True)
    entry_id: Mapped[int] = mapped_column(
        ForeignKey("standup_entries.id", ondelete="CASCADE"), index=True
    )
    section: Mapped[str] = mapped_column(String(9))
    text: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    entry: Mapped[StandupEntry] = relationship(back_populates="bullets")


class Timer(OwnedMixin, Base):
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
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), index=True, default=None
    )
    habit_id: Mapped[int | None] = mapped_column(
        ForeignKey("habits.id", ondelete="SET NULL"), index=True, default=None
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ApiToken(OwnedMixin, Base):
    """An API token (GLOSSARY.md; ADR 0014's amendment, issue #413): a
    named, personal credential for a client that cannot log in with a
    password. Only a SHA-256 hash of the plaintext is kept; `prefix` is its
    first few characters, enough for its owner to tell tokens apart.
    Revoking sets `revoked_at`: the token stops authenticating at once and
    leaves every listing. See app.api_tokens.
    """

    __tablename__ = "api_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    prefix: Mapped[str] = mapped_column(String(32))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NowSelection(OwnedMixin, Base):
    """The one Task a User chose to do next in Today (issue #547), and
    whether the Now panel is shown at all. At most one row per User,
    created on first write; no row reads as off with nothing selected.

    Its own table rather than `user_settings` columns, so writing the
    selection can never overwrite another preference. Turning Now off
    keeps `task_id`; deleting the Task clears it (SET NULL).
    """

    __tablename__ = "now_selections"
    __table_args__ = (UniqueConstraint("owner_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    enabled: Mapped[bool] = mapped_column(default=False)
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), default=None
    )
    # The chosen occurrence's schedule (issue #549): a recurring Task that
    # advanced in place no longer matches, so it stops reading as Now.
    task_start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    task_due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    # Optional cue for picking the selection back up (issue #554); cleared
    # whenever the selection changes, is removed or is pruned.
    resume_note: Mapped[str | None] = mapped_column(Text, default=None)


class NowShortlistItem(OwnedMixin, Base):
    """One entry on a User's Now shortlist (issue #551): an ordered,
    deduplicated set of alternatives beside Now, with no cap. Deleting the
    Task removes the entry; the saved schedule prunes completed or advanced
    occurrences by the same rule as Now (app.now_rule)."""

    __tablename__ = "now_shortlist_items"
    __table_args__ = (UniqueConstraint("owner_id", "task_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    position: Mapped[int]
    task_start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    task_due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
