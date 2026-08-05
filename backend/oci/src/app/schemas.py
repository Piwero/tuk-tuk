"""Pydantic request/response models and the shared pagination envelope."""

from datetime import UTC, date, datetime
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_serializer,
    field_validator,
)

# The four named Priority levels — named, not numbered, on the wire.
Priority = Literal["none", "low", "medium", "high"]

# How a List is displayed: flat or as a Kanban board of its Sections.
ViewMode = Literal["list", "kanban"]

# The two Habit types — named on the wire, like Priority.
HabitType = Literal["boolean", "numeric"]


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
    description: str = ""
    list_id: int | None = None
    section_id: int | None = None
    priority: Priority = "none"
    tag_ids: list[int] = Field(default_factory=list)
    start_date: datetime | None = None
    due_date: datetime | None = None
    is_all_day: bool = False
    time_zone: str | None = Field(default=None, max_length=64)
    recurrence: str | None = Field(default=None, max_length=255)
    # Provenance of a Task converted from a Google Event (issue #111);
    # absent for an ordinary Task.
    source_google_calendar_id: int | None = None
    source_google_event_id: str | None = Field(default=None, max_length=255)

    _normalize_dates = field_validator("start_date", "due_date")(normalize_to_utc)


# PATCH fields: absent means "leave unchanged". An explicit null is rejected,
# except section_id, where null moves the task out of its Section,
# start_date / due_date / time_zone, where null clears the schedule, and
# recurrence, where null stops the task repeating.
# tag_ids replaces the task's whole tag set; reminders replaces the whole
# reminder set ([] clears it).
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
    reminders: list[str] | None = None
    recurrence: str | None = Field(default=None, max_length=255)

    _reject_nulls = field_validator(
        "title",
        "completed",
        "list_id",
        "description",
        "priority",
        "tag_ids",
        "sort_order",
        "is_all_day",
        "reminders",
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


class CompletedOccurrenceRead(BaseModel):
    """One completed occurrence of a recurring Task, with the live task's
    title and List joined in for the completed view.
    """

    id: int
    task_id: int
    title: str
    list_id: int
    completed_at: datetime
    due_date: datetime
    is_all_day: bool

    @field_serializer("completed_at", "due_date")
    def serialize_dates(self, value: datetime) -> str:
        return utc_z(value)


class HabitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    type: HabitType = "boolean"
    # Numeric habits: goal is required, step defaults to 1, unit is optional.
    # Boolean habits may not carry any of them (the router enforces both).
    goal: float | None = Field(default=None, gt=0)
    step: float | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, min_length=1, max_length=32)
    icon: str | None = Field(default=None, max_length=16)
    color: str | None = Field(default=None, max_length=32)
    encouragement: str = Field(default="", max_length=255)
    frequency: str = Field(default="FREQ=DAILY", max_length=255)


# PATCH fields: absent means "leave unchanged". An explicit null is rejected,
# except unit / icon / color, where null clears the attribute.
class HabitUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    type: HabitType | None = None
    goal: float | None = Field(default=None, gt=0)
    step: float | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, min_length=1, max_length=32)
    icon: str | None = Field(default=None, max_length=16)
    color: str | None = Field(default=None, max_length=32)
    encouragement: str | None = Field(default=None, max_length=255)
    frequency: str | None = Field(default=None, max_length=255)
    is_archived: bool | None = None

    _reject_nulls = field_validator(
        "name", "type", "goal", "step", "encouragement", "frequency", "is_archived"
    )(reject_explicit_null)


class HabitRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: HabitType
    goal: float
    step: float
    unit: str | None
    icon: str | None
    color: str | None
    encouragement: str
    frequency: str
    is_archived: bool
    created_at: datetime

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> str:
        return utc_z(value)


class CheckInPut(BaseModel):
    """The upsert body: the day's whole value (1 for a Boolean tap; the
    accumulated amount for a Numeric habit)."""

    value: float = Field(default=1, gt=0)


class CheckInRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    habit_id: int
    date: date
    value: float


class HeatmapDay(BaseModel):
    """One checked-in day of the yearly heatmap; intensity is the value's
    share of the Goal (0..1], so Numeric habits render partial fills."""

    date: date
    value: float
    intensity: float


class HabitStats(BaseModel):
    """The server-computed Habit statistics: the current Streak and one
    calendar year of heatmap days (sparse — only days with Check-ins)."""

    streak: int
    heatmap: list[HeatmapDay]


# The two Focus Session modes: a Pomo counts down, a Stopwatch counts up.
FocusMode = Literal["pomo", "stopwatch"]


class FocusSessionCreate(BaseModel):
    """A finished (or retroactively added) Focus Session — timers tick
    client-side, so the API only ever receives completed periods."""

    mode: FocusMode
    task_id: int | None = None
    habit_id: int | None = None
    started_at: datetime
    ended_at: datetime
    pause_seconds: int = Field(default=0, ge=0)
    note: str = Field(default="", max_length=2000)

    _normalize_dates = field_validator("started_at", "ended_at")(normalize_to_utc)


# PATCH fields: absent means "leave unchanged". An explicit null is rejected,
# except task_id / habit_id, where null unlinks the session (its history stays).
class FocusSessionUpdate(BaseModel):
    task_id: int | None = None
    habit_id: int | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    pause_seconds: int | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=2000)

    _reject_nulls = field_validator("started_at", "ended_at", "pause_seconds", "note")(
        reject_explicit_null
    )
    _normalize_dates = field_validator("started_at", "ended_at")(normalize_to_utc)


class FocusSessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    mode: FocusMode
    task_id: int | None
    habit_id: int | None
    started_at: datetime
    ended_at: datetime
    pause_seconds: int
    note: str
    created_at: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def duration_seconds(self) -> int:
        """Honest focus time: the wall-clock span minus the paused part.
        Derived, never stored — edits to the times can't desynchronize it."""
        span = int((as_utc(self.ended_at) - as_utc(self.started_at)).total_seconds())
        return span - self.pause_seconds

    @field_serializer("started_at", "ended_at", "created_at")
    def serialize_dates(self, value: datetime) -> str:
        return utc_z(value)


class TimerCreate(BaseModel):
    """A Timer preset. A Pomo preset needs its countdown length; a Stopwatch
    one has none (the router enforces both)."""

    name: str = Field(min_length=1, max_length=255)
    mode: FocusMode
    duration_seconds: int | None = Field(default=None, gt=0)
    task_id: int | None = None
    habit_id: int | None = None


# PATCH fields: absent means "leave unchanged". An explicit null is rejected,
# except duration_seconds, where null drops it (a Stopwatch preset has none),
# and task_id / habit_id, where null unlinks the preset.
class TimerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    mode: FocusMode | None = None
    duration_seconds: int | None = Field(default=None, gt=0)
    task_id: int | None = None
    habit_id: int | None = None

    _reject_nulls = field_validator("name", "mode")(reject_explicit_null)


class TimerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    mode: FocusMode
    duration_seconds: int | None
    task_id: int | None
    habit_id: int | None
    created_at: datetime

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> str:
        return utc_z(value)


class FocusDayTotal(BaseModel):
    date: date
    seconds: int


class FocusWeekTotal(BaseModel):
    """One Monday-started week's focus total."""

    start: date
    seconds: int


class FocusTaskTotal(BaseModel):
    task_id: int
    title: str
    seconds: int


class FocusHabitTotal(BaseModel):
    habit_id: int
    name: str
    seconds: int


class FocusStats(BaseModel):
    """Server-computed focus statistics over an inclusive day range: totals
    by day and by week, and the time attributed to each linked Task and
    Habit. Sparse — only days / weeks / rows with focus appear."""

    days: list[FocusDayTotal]
    weeks: list[FocusWeekTotal]
    tasks: list[FocusTaskTotal]
    habits: list[FocusHabitTotal]


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
    reminders: list[str]
    recurrence: str | None
    source_google_calendar_id: int | None
    source_google_event_id: str | None
    check_items: list[CheckItemRead]
    tags: list[TagRead]
    created_at: datetime

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> str:
        return utc_z(value)

    @field_serializer("start_date", "due_date", "completed_at")
    def serialize_schedule_dates(self, value: datetime | None) -> str | None:
        return None if value is None else utc_z(value)
