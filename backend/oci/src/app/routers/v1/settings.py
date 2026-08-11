"""Small, dedicated settings endpoints that don't warrant a generic PATCH
surface (issue #140's Stand-up toggle is the first of these — mirrors the
GoogleStatus precedent in app.routers.v1.google rather than exposing the
whole AppSettings singleton for editing).
"""

from fastapi import APIRouter
from pydantic import BaseModel

from app.app_settings import require_app_settings
from app.db import SessionDep

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


class StandupSettings(BaseModel):
    enabled: bool


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
