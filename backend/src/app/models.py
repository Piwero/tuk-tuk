"""SQLAlchemy models. Vocabulary per CONTEXT.md; owner column per ADR 0002."""

from datetime import UTC, datetime

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, String, Table, Text
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


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    completed: Mapped[bool] = mapped_column(default=False)
    description: Mapped[str] = mapped_column(Text, default="")
    priority: Mapped[str] = mapped_column(String(6), default="none")
    list_id: Mapped[int] = mapped_column(ForeignKey("lists.id"), index=True)
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
