"""Pydantic request/response models and the shared pagination envelope."""

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

# The four named Priority levels — named, not numbered, on the wire.
Priority = Literal["none", "low", "medium", "high"]

# How a List is displayed: flat or as a Kanban board of its Sections.
ViewMode = Literal["list", "kanban"]


def reject_explicit_null(value: object) -> object:
    """Shared PATCH-field rule: absent means "leave unchanged"; explicit null is rejected.

    Defaults are not validated, so the validator only fires on explicit nulls.
    """
    if value is None:
        raise ValueError("Field may not be null; omit it to leave it unchanged")
    return value


def as_utc(value: datetime) -> datetime:
    """Pin naive datetimes (SQLite roundtrips) to UTC — the storage convention."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def normalize_to_utc(value: datetime | None) -> datetime | None:
    """Store schedule datetimes in UTC; naive input is taken as UTC by convention."""
    return None if value is None else as_utc(value)


def utc_z(value: datetime) -> str:
    return as_utc(value).isoformat().replace("+00:00", "Z")


class Page[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


# PATCH fields: absent means "leave unchanged"; an explicit JSON null is rejected.
class FolderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    sort_order: int | None = None

    _reject_nulls = field_validator("name", "sort_order")(reject_explicit_null)


class FolderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    sort_order: int


class ListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    color: str | None = Field(default=None, max_length=32)
    emoji: str | None = Field(default=None, max_length=16)


# PATCH fields: absent means "leave unchanged". name, is_archived, sort_order,
# and view_mode may not be null; an explicit null for color or emoji clears the
# attribute, and an explicit null for folder_id moves the List out of its Folder.
class ListUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    color: str | None = Field(default=None, max_length=32)
    emoji: str | None = Field(default=None, max_length=16)
    is_archived: bool | None = None
    folder_id: int | None = None
    sort_order: int | None = None
    view_mode: ViewMode | None = None

    _reject_nulls = field_validator("name", "is_archived", "sort_order", "view_mode")(
        reject_explicit_null
    )


class ListRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_inbox: bool
    color: str | None
    emoji: str | None
    is_archived: bool
    folder_id: int | None
    sort_order: int
    view_mode: ViewMode


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str | None = Field(default=None, max_length=32)


# PATCH fields: absent means "leave unchanged". name may not be null;
# an explicit null for color clears it.
class TagUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    color: str | None = Field(default=None, max_length=32)

    _reject_nulls = field_validator("name")(reject_explicit_null)


class TagRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str | None


class SectionCreate(BaseModel):
    list_id: int
    name: str = Field(min_length=1, max_length=255)


# PATCH fields: absent means "leave unchanged"; an explicit JSON null is rejected.
class SectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    sort_order: int | None = None

    _reject_nulls = field_validator("name", "sort_order")(reject_explicit_null)


class SectionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    list_id: int
    name: str
    sort_order: int


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    list_id: int | None = None
    section_id: int | None = None
    start_date: datetime | None = None
    due_date: datetime | None = None
    is_all_day: bool = False
    time_zone: str | None = Field(default=None, max_length=64)

    _normalize_dates = field_validator("start_date", "due_date")(normalize_to_utc)


# PATCH fields: absent means "leave unchanged". An explicit null is rejected,
# except section_id, where null moves the task out of its Section, and
# start_date / due_date / time_zone, where null clears the schedule.
# tag_ids replaces the task's whole tag set.
class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    completed: bool | None = None
    list_id: int | None = None
    description: str | None = None
    priority: Priority | None = None
    tag_ids: list[int] | None = None
    section_id: int | None = None
    sort_order: int | None = None
    start_date: datetime | None = None
    due_date: datetime | None = None
    is_all_day: bool | None = None
    time_zone: str | None = Field(default=None, max_length=64)

    _reject_nulls = field_validator(
        "title",
        "completed",
        "list_id",
        "description",
        "priority",
        "tag_ids",
        "sort_order",
        "is_all_day",
    )(reject_explicit_null)
    _normalize_dates = field_validator("start_date", "due_date")(normalize_to_utc)


class CheckItemCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)


# PATCH fields: absent means "leave unchanged"; an explicit JSON null is rejected.
class CheckItemUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    done: bool | None = None
    sort_order: int | None = None

    _reject_nulls = field_validator("title", "done", "sort_order")(reject_explicit_null)


class CheckItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    done: bool
    sort_order: int


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    completed: bool
    completed_at: datetime | None
    description: str
    priority: Priority
    list_id: int
    section_id: int | None
    sort_order: int
    start_date: datetime | None
    due_date: datetime | None
    is_all_day: bool
    time_zone: str | None
    check_items: list[CheckItemRead]
    tags: list[TagRead]
    created_at: datetime

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> str:
        return utc_z(value)

    @field_serializer("start_date", "due_date", "completed_at")
    def serialize_schedule_dates(self, value: datetime | None) -> str | None:
        return None if value is None else utc_z(value)
