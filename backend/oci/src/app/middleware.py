"""Session enforcement middleware (ADR 0005, issue #84).

Default-deny by construction: a per-router auth dependency is default-open,
so a router added without the decorator is silently published
unauthenticated. Middleware sits in front of routing entirely, so it also
covers the interactive docs and the OpenAPI schema, which aren't routers at
all and which a per-router approach couldn't reach.
"""

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from app.config import Settings
from app.errors import error_response
from app.session import SESSION_COOKIE_NAME, needs_reissue, set_session_cookie, verify_session_token

# Exact-match only, never by prefix: a future path that merely starts with
# one of these strings must not be accidentally opened.
PUBLIC_PATHS = frozenset({"/health", "/api/v1/auth/login"})


class SessionAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        super().__init__(app)
        self._settings = settings

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        issued_at = verify_session_token(request.cookies.get(SESSION_COOKIE_NAME), self._settings)
        if issued_at is None:
            return error_response(401, "unauthorized", "A valid session is required")

        response = await call_next(request)
        if needs_reissue(issued_at, self._settings):
            set_session_cookie(response, self._settings)
        return response
