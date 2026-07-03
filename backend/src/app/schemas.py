"""Pydantic request/response models and the shared pagination envelope."""

from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator


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

    @field_validator("name", "sort_order")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("Field may not be null; omit it to leave it unchanged")
        return value


class FolderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    sort_order: int


class ListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    color: str | None = Field(default=None, max_length=32)
    emoji: str | None = Field(default=None, max_length=16)


# PATCH fields: absent means "leave unchanged". name, is_archived, and sort_order
# may not be null; an explicit null for color or emoji clears the attribute, and
# an explicit null for folder_id moves the List out of its Folder.
class ListUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    color: str | None = Field(default=None, max_length=32)
    emoji: str | None = Field(default=None, max_length=16)
    is_archived: bool | None = None
    folder_id: int | None = None
    sort_order: int | None = None

    @field_validator("name", "is_archived", "sort_order")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("Field may not be null; omit it to leave it unchanged")
        return value


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


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    list_id: int | None = None


# PATCH fields: absent means "leave unchanged"; an explicit JSON null is rejected.
# Defaults are not validated, so the validator only fires on explicit nulls.
class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    completed: bool | None = None
    list_id: int | None = None

    @field_validator("title", "completed", "list_id")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("Field may not be null; omit it to leave it unchanged")
        return value


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    completed: bool
    list_id: int
    created_at: datetime

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> str:
        # SQLite drops tzinfo on the roundtrip; timestamps are UTC by convention,
        # so pin naive values to UTC and always emit the Z suffix.
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
