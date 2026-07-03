"""SQLAlchemy models. Vocabulary per CONTEXT.md; owner column per ADR 0002."""

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

DEFAULT_OWNER = "local"


def utcnow() -> datetime:
    return datetime.now(UTC)


class TaskList(Base):
    """A List — a user-created container of tasks. The Inbox is the built-in one."""

    __tablename__ = "lists"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    is_inbox: Mapped[bool] = mapped_column(default=False)
    owner: Mapped[str] = mapped_column(String(64), default=DEFAULT_OWNER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    tasks: Mapped[list["Task"]] = relationship(
        back_populates="task_list", cascade="all, delete-orphan"
    )


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    completed: Mapped[bool] = mapped_column(default=False)
    list_id: Mapped[int] = mapped_column(ForeignKey("lists.id"), index=True)
    owner: Mapped[str] = mapped_column(String(64), default=DEFAULT_OWNER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    task_list: Mapped[TaskList] = relationship(back_populates="tasks")
