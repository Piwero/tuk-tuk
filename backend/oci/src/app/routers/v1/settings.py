"""Small, dedicated settings endpoints that don't warrant a generic PATCH
surface (issue #140's Stand-up toggle is the first of these — mirrors the
GoogleStatus precedent in app.routers.v1.google rather than exposing the
whole of a user's settings for editing). Each reads and writes the acting
user's own settings (issue #409).
"""

import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, field_validator, model_validator

from app.clock_labels import is_hh_mm, minutes_of
from app.current_user import require_admin
from app.db import DatabaseUrl, SessionDep
from app.db_probe import ProbeResult, is_valid_postgres_url, probe_connection
from app.errors import APIError
from app.models import UserSettings
from app.quiet_hours import InvalidQuietHoursError, QuietHours
from app.user_settings import CurrentUserSettings

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


class FlagSettings(BaseModel):
    """One on/off setting of the User's: Stand-up, Gentle return, Reminder
    notifications."""

    enabled: bool


# Section visibility toggles (this feature): same UI-only pattern as
# standup_enabled above — one flag per nav item/route, all default True —
# but exposed as a single GET/PUT pair instead of five hand-copied
# endpoints. Tasks is deliberately not one of these: it's the one section
# that can never be hidden.
_SECTION_FIELDS = {
    "calendar": "calendar_enabled",
    "goals": "goals_enabled",
    "habits": "habits_enabled",
    "focus": "focus_enabled",
    "assistant": "assistant_enabled",
}


class SectionSettings(BaseModel):
    calendar: bool
    goals: bool
    habits: bool
    focus: bool
    assistant: bool


# Active hours (issue #210). The band is aligned to 30 minutes, must have
# start strictly before end, and must not wrap past midnight — a wrapping
# band makes "the start of your day" ambiguous, which leaks into the
# Calendar's initial scroll. Night-shift support is explicitly out of scope.
ACTIVE_HOURS_GRANULARITY_MINUTES = 30


class InvalidBandError(ValueError):
    """A day band that can't be saved; the message says why, for the User."""


class ActiveHoursSettings(BaseModel):
    enabled: bool
    start: str
    end: str

    @model_validator(mode="after")
    def _check_band(self) -> "ActiveHoursSettings":
        _check_day_band(self.start, self.end, "Active hours must start before they end")
        return self


def _check_day_band(start: str, end: str, out_of_order: str) -> None:
    """A band of one day on the 30-minute grid: start strictly before end,
    no wrap past midnight (24:00 is the day's end). InvalidBandError if not."""
    for label in (start, end):
        if not is_hh_mm(label):
            raise InvalidBandError(f"{label!r} is not an HH:MM time")
        minute = minutes_of(label)
        if not 0 <= minute <= 24 * 60:
            raise InvalidBandError(f"{label!r} is outside the day")
        if minute % ACTIVE_HOURS_GRANULARITY_MINUTES != 0:
            raise InvalidBandError(f"{label!r} is not aligned to 30 minutes")
    if minutes_of(start) >= minutes_of(end):
        raise InvalidBandError(out_of_order)


class PlanningWindowSettings(BaseModel):
    """Planning window (issue #563): the band of each day the capacity
    summary measures. Same grid as Active hours, stored apart so changing
    one never moves the other. Validated in its handler, like its sibling
    band Quiet hours, so a refusal carries its own code and a message the
    User can read."""

    enabled: bool
    start: str
    end: str


class QuietHoursSettings(BaseModel):
    enabled: bool
    start: str
    end: str


def invalid_band(code: str, error: ValueError) -> APIError:
    return APIError(status_code=422, code=code, message=str(error))


@router.get("/stand-up")
async def read_standup_settings(user_settings: CurrentUserSettings) -> FlagSettings:
    return FlagSettings(enabled=user_settings.standup_enabled)


@router.put("/stand-up")
async def update_standup_settings(
    payload: FlagSettings, session: SessionDep, user_settings: CurrentUserSettings
) -> FlagSettings:
    """Purely a UI-visibility flag (issue #140): toggling it never blocks
    the stand-up API routes and never touches stored entries, bullets, or
    the Sprint goal — those stay intact and reachable while the feature is
    hidden in the sidebar.
    """
    user_settings.standup_enabled = payload.enabled
    await session.commit()
    return FlagSettings(enabled=user_settings.standup_enabled)


def _sections(user_settings: UserSettings) -> SectionSettings:
    return SectionSettings(
        **{name: getattr(user_settings, field) for name, field in _SECTION_FIELDS.items()}
    )


@router.get("/sections")
async def read_section_settings(user_settings: CurrentUserSettings) -> SectionSettings:
    return _sections(user_settings)


@router.put("/sections")
async def update_section_settings(
    payload: SectionSettings, session: SessionDep, user_settings: CurrentUserSettings
) -> SectionSettings:
    """Purely UI-visibility flags, same contract as the Stand-up toggle:
    turning one off hides its nav item and route, never blocks the section's
    own API routes and never touches its stored data.
    """
    for name, field in _SECTION_FIELDS.items():
        setattr(user_settings, field, getattr(payload, name))
    await session.commit()
    return _sections(user_settings)


def _active_hours(user_settings: UserSettings) -> ActiveHoursSettings:
    return ActiveHoursSettings(
        enabled=user_settings.active_hours_enabled,
        start=user_settings.active_hours_start,
        end=user_settings.active_hours_end,
    )


@router.get("/active-hours")
async def read_active_hours_settings(user_settings: CurrentUserSettings) -> ActiveHoursSettings:
    return _active_hours(user_settings)


@router.put("/active-hours")
async def update_active_hours_settings(
    payload: ActiveHoursSettings, session: SessionDep, user_settings: CurrentUserSettings
) -> ActiveHoursSettings:
    """Active hours describe the user (issue #210): the Calendar renders this
    band at double height and compresses the hours outside it. Stored on the
    user's own settings, not per-device. The payload is validated for the
    30-minute grid, start-before-end, and no midnight wrap before it lands.
    """
    user_settings.active_hours_enabled = payload.enabled
    user_settings.active_hours_start = payload.start
    user_settings.active_hours_end = payload.end
    await session.commit()
    return _active_hours(user_settings)


def _planning_window(user_settings: UserSettings) -> PlanningWindowSettings:
    return PlanningWindowSettings(
        enabled=user_settings.planning_window_enabled,
        start=user_settings.planning_window_start,
        end=user_settings.planning_window_end,
    )


@router.get("/planning-window")
async def read_planning_window_settings(
    user_settings: CurrentUserSettings,
) -> PlanningWindowSettings:
    return _planning_window(user_settings)


@router.put("/planning-window")
async def update_planning_window_settings(
    payload: PlanningWindowSettings, session: SessionDep, user_settings: CurrentUserSettings
) -> PlanningWindowSettings:
    """The planning window (issue #563) is the User's own choice, never
    derived from Active hours: Active hours shapes the Calendar grid, this
    band is only what the capacity summary measures."""
    try:
        _check_day_band(payload.start, payload.end, "The planning window must start before it ends")
    except InvalidBandError as error:
        raise invalid_band("invalid_planning_window", error) from None
    user_settings.planning_window_enabled = payload.enabled
    user_settings.planning_window_start = payload.start
    user_settings.planning_window_end = payload.end
    await session.commit()
    return _planning_window(user_settings)


@router.get("/gentle-return")
async def read_gentle_return_settings(user_settings: CurrentUserSettings) -> FlagSettings:
    return FlagSettings(enabled=user_settings.gentle_return_enabled)


@router.put("/gentle-return")
async def update_gentle_return_settings(
    payload: FlagSettings, session: SessionDep, user_settings: CurrentUserSettings
) -> FlagSettings:
    """Gentle return (issue #548): Today collapses earlier overdue Tasks
    behind a counted disclosure. Presentation only — no Task dates change."""
    user_settings.gentle_return_enabled = payload.enabled
    await session.commit()
    return FlagSettings(enabled=user_settings.gentle_return_enabled)


@router.get("/reminder-notifications")
async def read_reminder_notification_settings(
    user_settings: CurrentUserSettings,
) -> FlagSettings:
    return FlagSettings(enabled=user_settings.reminder_notifications_enabled)


@router.put("/reminder-notifications")
async def update_reminder_notification_settings(
    payload: FlagSettings,
    request: Request,
    session: SessionDep,
    user_settings: CurrentUserSettings,
) -> FlagSettings:
    """Reminder notifications (issue #557): the User's opt-in to Reminder
    delivery. Private to the User; browser permission is per device and is
    never recorded here. Turning them on records when, which bounds the
    missed list (#565); saving "on" again while on keeps that instant."""
    if payload.enabled and not user_settings.reminder_notifications_enabled:
        user_settings.reminder_notifications_enabled_at = request.app.state.clock()
    user_settings.reminder_notifications_enabled = payload.enabled
    await session.commit()
    return FlagSettings(enabled=user_settings.reminder_notifications_enabled)


def _quiet_hours(user_settings: UserSettings) -> QuietHoursSettings:
    return QuietHoursSettings(
        enabled=user_settings.quiet_hours_enabled,
        start=user_settings.quiet_hours_start,
        end=user_settings.quiet_hours_end,
    )


@router.get("/quiet-hours")
async def read_quiet_hours_settings(user_settings: CurrentUserSettings) -> QuietHoursSettings:
    return _quiet_hours(user_settings)


@router.put("/quiet-hours")
async def update_quiet_hours_settings(
    payload: QuietHoursSettings, session: SessionDep, user_settings: CurrentUserSettings
) -> QuietHoursSettings:
    """Quiet hours (issue #567): Reminders falling due inside the band are
    held and notify once when it ends. A notification setting only; Active
    hours, the Calendar band, is a different setting and never read here.
    The band may wrap past midnight; a start equal to its end is refused."""
    try:
        QuietHours.parse(payload.start, payload.end)
    except InvalidQuietHoursError as error:
        raise invalid_band("invalid_quiet_hours", error) from None
    user_settings.quiet_hours_enabled = payload.enabled
    user_settings.quiet_hours_start = payload.start
    user_settings.quiet_hours_end = payload.end
    await session.commit()
    return _quiet_hours(user_settings)


# Database status + connection probe (issue #256). Read-only: the status
# endpoint only inspects the running app's own configured database_url
# (never the settings table), and the test-connection endpoint only ever
# probes a candidate URL supplied in the request body — neither can switch
# the app's engine, and the submitted URL is never logged, stored, or
# echoed back. Both are the instance's own concern, not a User's: Admins
# only, and never over an API token (ADR 0018, app.middleware).
class DatabaseStatus(BaseModel):
    # Always "postgresql", the only engine (issue #407); kept so the response
    # shape the Settings screen reads doesn't change.
    engine: Literal["postgresql"] = "postgresql"
    host: str | None
    database: str | None


class TestConnectionRequest(BaseModel):
    connection_url: str

    @field_validator("connection_url")
    @classmethod
    def _check_postgres_url(cls, value: str) -> str:
        if not is_valid_postgres_url(value):
            raise ValueError("connection_url must be a postgresql:// or postgresql+psycopg:// URL")
        return value


@router.get("/database", dependencies=[Depends(require_admin)])
async def read_database_status(request: Request) -> DatabaseStatus:
    url = DatabaseUrl(request.app.state.settings.database_url)
    return DatabaseStatus(host=url.hostname, database=url.database)


@router.post("/database/test-connection", dependencies=[Depends(require_admin)])
async def test_database_connection(payload: TestConnectionRequest) -> ProbeResult:
    """A pure probe — see app.db_probe. No path from here touches the
    `settings` row or the app's own engine; validation of the URL's scheme
    happens before this handler even runs (TestConnectionRequest), so a
    malformed URL never reaches the connection attempt.

    `probe_connection` blocks for up to its connect timeout, so it runs in a
    thread: an unreachable host must fail only this request, not stall every
    other one sharing the event loop.

    It makes the server connect wherever it is told (server-side request
    forgery by construction, ADR 0013), so only an Admin may run it.
    """
    return await asyncio.to_thread(probe_connection, payload.connection_url)
