"""Small, dedicated settings endpoints that don't warrant a generic PATCH
surface (issue #140's Stand-up toggle is the first of these — mirrors the
GoogleStatus precedent in app.routers.v1.google rather than exposing the
whole AppSettings singleton for editing).
"""

import re
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Request
from pydantic import BaseModel, field_validator, model_validator

from app.app_settings import require_app_settings
from app.db import SessionDep
from app.db_probe import ProbeResult, is_valid_postgres_url, probe_connection
from app.models import AppSettings

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
async def read_standup_settings(session: SessionDep) -> StandupSettings:
    app_settings = await require_app_settings(session)
    return StandupSettings(enabled=app_settings.standup_enabled)


@router.put("/stand-up")
async def update_standup_settings(payload: StandupSettings, session: SessionDep) -> StandupSettings:
    """Purely a UI-visibility flag (issue #140): toggling it never blocks
    the stand-up API routes and never touches stored entries, bullets, or
    the Sprint goal — those stay intact and reachable while the feature is
    hidden in the sidebar.
    """
    app_settings = await require_app_settings(session)
    app_settings.standup_enabled = payload.enabled
    await session.commit()
    return StandupSettings(enabled=app_settings.standup_enabled)


def _sections(app_settings: AppSettings) -> SectionSettings:
    return SectionSettings(
        **{name: getattr(app_settings, field) for name, field in _SECTION_FIELDS.items()}
    )


@router.get("/sections")
async def read_section_settings(session: SessionDep) -> SectionSettings:
    return _sections(await require_app_settings(session))


@router.put("/sections")
async def update_section_settings(payload: SectionSettings, session: SessionDep) -> SectionSettings:
    """Purely UI-visibility flags, same contract as the Stand-up toggle:
    turning one off hides its nav item and route, never blocks the section's
    own API routes and never touches its stored data.
    """
    app_settings = await require_app_settings(session)
    for name, field in _SECTION_FIELDS.items():
        setattr(app_settings, field, getattr(payload, name))
    await session.commit()
    return _sections(app_settings)


def _active_hours(app_settings: AppSettings) -> ActiveHoursSettings:
    return ActiveHoursSettings(
        enabled=app_settings.active_hours_enabled,
        start=app_settings.active_hours_start,
        end=app_settings.active_hours_end,
    )


@router.get("/active-hours")
async def read_active_hours_settings(session: SessionDep) -> ActiveHoursSettings:
    return _active_hours(await require_app_settings(session))


@router.put("/active-hours")
async def update_active_hours_settings(
    payload: ActiveHoursSettings, session: SessionDep
) -> ActiveHoursSettings:
    """Active hours describe the user (issue #210): the Calendar renders this
    band at double height and compresses the hours outside it. Stored on the
    settings singleton, not per-device. The payload is validated for the
    30-minute grid, start-before-end, and no midnight wrap before it lands.
    """
    app_settings = await require_app_settings(session)
    app_settings.active_hours_enabled = payload.enabled
    app_settings.active_hours_start = payload.start
    app_settings.active_hours_end = payload.end
    await session.commit()
    return _active_hours(app_settings)


# Database status + connection probe (issue #256). Read-only: the status
# endpoint only inspects the running app's own configured database_url
# (never the settings table), and the test-connection endpoint only ever
# probes a candidate URL supplied in the request body — neither can switch
# the app's engine, and the submitted URL is never logged, stored, or
# echoed back.
class DatabaseStatus(BaseModel):
    engine: Literal["sqlite", "postgresql"]
    host: str | None = None
    database: str | None = None


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
    url = request.app.state.settings.database_url
    scheme = urlsplit(url).scheme
    if scheme.startswith("postgresql"):
        parts = urlsplit(url)
        return DatabaseStatus(
            engine="postgresql",
            host=parts.hostname,
            database=parts.path.lstrip("/") or None,
        )
    return DatabaseStatus(engine="sqlite")


@router.post("/database/test-connection")
async def test_database_connection(payload: TestConnectionRequest) -> ProbeResult:
    """A pure probe — see app.db_probe. No path from here touches the
    `settings` row or the app's own engine; validation of the URL's scheme
    happens before this handler even runs (TestConnectionRequest), so a
    malformed URL never reaches the connection attempt.
    """
    return probe_connection(payload.connection_url)
