"""Login and session-probe endpoints (ADR 0005, issue #83)."""

import asyncio

from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app.auth import password_hasher
from app.errors import APIError
from app.session import set_session_cookie

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str


@router.post("/login", status_code=204)
async def login(payload: LoginRequest, request: Request, response: Response) -> None:
    settings = request.app.state.settings
    throttle = request.app.state.login_throttle

    # The app refuses to start without a password hash configured (ADR 0005),
    # so this is always set by the time a request reaches the handler.
    assert settings.auth_password_hash is not None

    try:
        password_hasher.verify(settings.auth_password_hash, payload.password)
    except VerifyMismatchError:
        delay = throttle.record_failure(base=settings.auth_login_delay_seconds)
        await asyncio.sleep(delay)
        raise APIError(401, "invalid_credentials", "Incorrect password") from None

    throttle.record_success()
    set_session_cookie(response, settings)


@router.get("/session", status_code=204)
async def session_probe() -> None:
    """Reached only when SessionAuthMiddleware has already accepted the
    request's cookie — the frontend uses this to ask "am I logged in?" in
    one cheap request, rather than inferring login state from whether a
    data load happened to succeed.
    """
