"""First-run setup, login, and session-probe endpoints (ADR 0005, issue #83;
ADR 0008, issue #115)."""

import asyncio

from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app.app_settings import get_app_settings, require_app_settings
from app.auth import password_hasher
from app.db import SessionDep
from app.errors import APIError
from app.session import SESSION_COOKIE_NAME, set_session_cookie

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str


class SetupRequest(BaseModel):
    password: str


@router.post("/setup", status_code=204)
async def setup(
    payload: SetupRequest, request: Request, response: Response, session: SessionDep
) -> None:
    """Sets the initial password (ADR 0008). The settings row itself always
    exists by the time any request reaches here — app.main's lifespan
    bootstraps it before the app serves anything — but its password_hash
    starts out unset, which is exactly what SessionAuthMiddleware gates
    every other route on.

    Rejects once a password already exists: this must never be replayable
    to reset the password without a valid session — that's the
    change-password flow (issue #116), reachable only once already logged
    in.
    """
    app_settings = await require_app_settings(session)
    if app_settings.password_hash is not None:
        raise APIError(404, "not_found", "Setup has already been completed")
    if not payload.password:
        raise APIError(422, "invalid_password", "Password must not be empty")

    app_settings.password_hash = password_hasher.hash(payload.password)
    await session.commit()

    set_session_cookie(
        response, app_settings.session_key, request.app.state.settings, request.app.state.clock
    )


@router.post("/login", status_code=204)
async def login(
    payload: LoginRequest, request: Request, response: Response, session: SessionDep
) -> None:
    settings = request.app.state.settings
    throttle = request.app.state.login_throttle

    app_settings = await get_app_settings(session)
    if app_settings is None or app_settings.password_hash is None:
        raise APIError(404, "not_found", "Setup has not been completed")

    try:
        password_hasher.verify(app_settings.password_hash, payload.password)
    except VerifyMismatchError:
        delay = throttle.record_failure(base=settings.auth_login_delay_seconds)
        await asyncio.sleep(delay)
        raise APIError(401, "invalid_credentials", "Incorrect password") from None

    throttle.record_success()
    set_session_cookie(response, app_settings.session_key, settings, request.app.state.clock)


@router.get("/session", status_code=204)
async def session_probe() -> None:
    """Reached only when SessionAuthMiddleware has already accepted the
    request's cookie — the frontend uses this to ask "am I logged in?" in
    one cheap request, rather than inferring login state from whether a
    data load happened to succeed.
    """


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response) -> None:
    """Clears the session cookie. There is no server-side session store to
    revoke (ADR 0005) — this is reached only with a currently-valid cookie
    (SessionAuthMiddleware), and deleting it is the whole of "logging out".
    """
    settings = request.app.state.settings
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="strict",
    )
