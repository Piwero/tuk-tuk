"""Session enforcement middleware (ADR 0005, issue #84; ADR 0008, issue #115).

Default-deny by construction: a per-router auth dependency is default-open,
so a router added without the decorator is silently published
unauthenticated. Middleware sits in front of routing entirely, so it also
covers the interactive docs and the OpenAPI schema, which aren't routers at
all and which a per-router approach couldn't reach.

The AUTH_DISABLED local-dev escape hatch below is the one exception: when
set, the gate is skipped entirely and the app logs a warning at startup
(app.main.create_app). Never set in a real deployment.
"""

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from app.app_settings import get_app_settings
from app.config import Settings
from app.errors import error_response
from app.session import (
    SESSION_COOKIE_NAME,
    Clock,
    needs_reissue,
    set_session_cookie,
    verify_session_token,
)

# Exact-match only, never by prefix: a future path that merely starts with
# one of these strings must not be accidentally opened.
PUBLIC_PATHS = frozenset({"/health", "/api/v1/auth/login", "/api/v1/auth/setup"})


class SessionAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, settings: Settings, clock: Clock) -> None:
        super().__init__(app)
        self._settings = settings
        self._clock = clock

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Local-dev escape hatch (AUTH_DISABLED): skip the gate entirely, so
        # a dev database never needs a password or a cookie. Never set in a
        # real deployment — every route serves unauthenticated.
        if self._settings.auth_disabled:
            return await call_next(request)

        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        # A dedicated session, not the request's own SessionDep — this runs
        # before routing has picked a handler to inject one into. The
        # single-row `settings` lookup is cheap enough (SQLite, one row) to
        # repeat if the handler below also needs it.
        session_factory = request.app.state.session_factory
        async with session_factory() as db_session:
            app_settings = await get_app_settings(db_session)

        # No password set yet: every route (other than PUBLIC_PATHS, which
        # includes /api/v1/auth/setup itself) is gated until one is, a
        # distinct code from "unauthorized" so the frontend can route to the
        # first-run setup screen instead of the login screen.
        if app_settings is None or app_settings.password_hash is None:
            return error_response(401, "setup_required", "Initial setup is required")

        issued_at = verify_session_token(
            request.cookies.get(SESSION_COOKIE_NAME),
            app_settings.session_key,
            self._settings,
            self._clock,
        )
        if issued_at is None:
            return error_response(401, "unauthorized", "A valid session is required")

        response = await call_next(request)
        if needs_reissue(issued_at, self._settings, self._clock):
            set_session_cookie(response, app_settings.session_key, self._settings, self._clock)
        return response
