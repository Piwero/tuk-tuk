"""Google Calendar integration status (issue #103).

Google Calendar is entirely optional: without the two settings below, the
app must look like it has no such feature anywhere. This is the one probe
the frontend needs to decide that, once, on load.
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/google", tags=["google"])


class GoogleStatus(BaseModel):
    configured: bool


@router.get("/status")
async def google_status(request: Request) -> GoogleStatus:
    settings = request.app.state.settings
    configured = bool(settings.google_client_id) and bool(settings.google_client_secret)
    return GoogleStatus(configured=configured)
