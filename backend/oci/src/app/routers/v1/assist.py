"""Assist availability probe (ADR 0005; issue #42) — the foundation every
Assist feature (Assisted Capture, Overdue Triage, ...) rides on. The
frontend polls this on load and on window refocus and renders no AI
affordance anywhere until it reports available: true.
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.assist import assist_available
from app.config import Settings

router = APIRouter(prefix="/api/v1/assist", tags=["assist"])


class AssistStatus(BaseModel):
    available: bool


@router.get("/status")
async def assist_status(request: Request) -> AssistStatus:
    settings: Settings = request.app.state.settings
    available = await assist_available(settings.assist_ollama_base_url, settings.assist_model)
    return AssistStatus(available=available)
