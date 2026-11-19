"""Small, dedicated settings endpoints that don't warrant a generic PATCH
surface (issue #140's Stand-up toggle is the first of these — mirrors the
GoogleStatus precedent in app.routers.v1.google rather than exposing the
whole of a user's settings for editing). Each reads and writes the acting
user's own settings (issue #409).
"""

import asyncio
import re
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, field_validator, model_validator

from app.db import DatabaseUrl, SessionDep
from app.db_probe import ProbeResult, is_valid_postgres_url, probe_connection
from app.models import UserSettings
from app.user_settings import CurrentUserSettings

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


class StandupSettings(BaseModel):
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
_HH_MM = re.compile(r"^\d{2}:\d{2}$")


def _minutes(label: str) -> int:
    hours, minutes = label.split(":")
    return int(hours) * 60 + int(minutes)


class ActiveHoursSettings(BaseModel):
    enabled: bool
    start: str
    end: str

    @model_validator(mode="after")
    def _check_band(self) -> "ActiveHoursSettings":
        for label in (self.start, self.end):
            if not _HH_MM.match(label):
                raise ValueError(f"{label!r} is not an HH:MM time")
            minute = _minutes(label)
            if not 0 <= minute <= 24 * 60:
                raise ValueError(f"{label!r} is outside the day")
            if minute % ACTIVE_HOURS_GRANULARITY_MINUTES != 0:
                raise ValueError(f"{label!r} is not aligned to 30 minutes")
        if _minutes(self.start) >= _minutes(self.end):
            raise ValueError("Active hours must start before they end")
        return self


@router.get("/stand-up")
async def read_standup_settings(user_settings: CurrentUserSettings) -> StandupSettings:
    return StandupSettings(enabled=user_settings.standup_enabled)


@router.put("/stand-up")
async def update_standup_settings(
    payload: StandupSettings, session: SessionDep, user_settings: CurrentUserSettings
) -> StandupSettings:
    """Purely a UI-visibility flag (issue #140): toggling it never blocks
    the stand-up API routes and never touches stored entries, bullets, or
    the Sprint goal — those stay intact and reachable while the feature is
    hidden in the sidebar.
    """
    user_settings.standup_enabled = payload.enabled
    await session.commit()
    return StandupSettings(enabled=user_settings.standup_enabled)


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


# Database status + connection probe (issue #256). Read-only: the status
# endpoint only inspects the running app's own configured database_url
# (never the settings table), and the test-connection endpoint only ever
# probes a candidate URL supplied in the request body — neither can switch
# the app's engine, and the submitted URL is never logged, stored, or
# echoed back.
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


@router.get("/database")
async def read_database_status(request: Request) -> DatabaseStatus:
    url = DatabaseUrl(request.app.state.settings.database_url)
    return DatabaseStatus(host=url.hostname, database=url.database)


@router.post("/database/test-connection")
async def test_database_connection(payload: TestConnectionRequest) -> ProbeResult:
    """A pure probe — see app.db_probe. No path from here touches the
    `settings` row or the app's own engine; validation of the URL's scheme
    happens before this handler even runs (TestConnectionRequest), so a
    malformed URL never reaches the connection attempt.

    `probe_connection` blocks for up to its connect timeout, so it runs in a
    thread: an unreachable host must fail only this request, not stall every
    other one sharing the event loop.
    """
    return await asyncio.to_thread(probe_connection, payload.connection_url)
