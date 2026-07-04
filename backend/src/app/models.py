"""SQLAlchemy models. Vocabulary per CONTEXT.md; owner column per ADR 0002."""

from datetime import UTC, date, datetime

from sqlalchemy import (
    JSON,
    BigInteger,
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
