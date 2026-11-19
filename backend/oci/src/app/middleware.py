"""Session enforcement middleware (ADR 0005, issue #84; ADR 0008, issue #115;
ADR 0018, issues #410, #413).

Default-deny by construction: a per-router auth dependency is default-open,
so a router added without the decorator is silently published
unauthenticated. Middleware sits in front of routing entirely, so it also
covers the interactive docs and the OpenAPI schema, which aren't routers at
all and which a per-router approach couldn't reach.

Every accepted request carries the signed-in User's id on
`request.state.user_id` (read through app.current_user) and runs inside
`app.ownership.acting_as` that User, so every session it opens sees only
their rows (issue #411). A public path runs with no User in context: it
can't touch an owned table at all. The cookie names
a User and their session epoch; the User is loaded on each request and the
cookie is refused once that User is disabled or their epoch has moved on.

A client that cannot log in with a password (the MCP server's HTTP mode)
sends `Authorization: Bearer <API token>` instead (issue #413, app.api_tokens):
the same checks as the cookie except the epoch, and never the routes that
manage credentials or accounts (TOKEN_REFUSED_ROUTES, the admin API).

The AUTH_DISABLED local-dev escape hatch below is the one exception: when
set, no cookie is needed and every request acts as the first Admin. The
app refuses to start with it outside APP_ENV=development
(app.main.create_app).
"""

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from app.api_tokens import find_live_token, mark_used, owner_of
from app.app_settings import require_app_settings
from app.config import Settings
from app.errors import error_response
from app.models import User
from app.ownership import acting_as
from app.session import (
    SESSION_COOKIE_NAME,
    Clock,
    needs_reissue,
    set_session_cookie,
    verify_session_token,
)
from app.users import first_admin, install_has_password

# Exact-match only, never by prefix: a future path that merely starts with
# one of these strings must not be accidentally opened.
PUBLIC_PATHS = frozenset({"/health", "/api/v1/auth/login", "/api/v1/auth/setup"})

# All a User may reach while a forced step (a temporary password to
# replace, a profile to complete) is pending: enough to see which step,
# complete it, or give up and log out. Exact-match on method and path, like
# PUBLIC_PATHS: reading /me is open, editing the profile there (issue #474)
# is not.
FORCED_STEP_ROUTES = frozenset(
    {
        ("GET", "/api/v1/auth/me"),
        ("POST", "/api/v1/auth/complete"),
        ("POST", "/api/v1/auth/logout"),
    }
)

# What an API token may never do (issue #413), so a stolen one stays a
# credential its owner can simply revoke: mint another token, set the
# password or complete a forced step, change the account's identity, or,
# for an Admin's token, manage any account. Exact match on method and path,
# plus everything under the admin API.
TOKEN_REFUSED_ROUTES = frozenset(
    {
        ("POST", "/api/v1/auth/me/tokens"),
        ("POST", "/api/v1/auth/password"),
        ("POST", "/api/v1/auth/complete"),
        ("PATCH", "/api/v1/auth/me"),
    }
)
ADMIN_PATH = "/api/v1/admin"


def _needs_password_session(request: Request) -> bool:
    path = request.url.path
    return (
        (request.method, path) in TOKEN_REFUSED_ROUTES
        or path == ADMIN_PATH
        or path.startswith(ADMIN_PATH + "/")
    )


def _setup_required() -> Response:
    # A distinct code from "unauthorized" so the frontend can route to the
    # first-run setup screen instead of the login screen.
    return error_response(401, "setup_required", "Initial setup is required")


def _account_disabled() -> Response:
    return error_response(401, "account_disabled", "This account is disabled")


def _bearer_token(request: Request) -> str | None:
    """The credential of an `Authorization: Bearer ...` header, if the
    request carries one; it then decides alone, whatever cookie comes too."""
    scheme, _, credential = request.headers.get("authorization", "").partition(" ")
    return credential.strip() if scheme.lower() == "bearer" else None


def _forced_step_gate(request: Request, user: User) -> Response | None:
    if (request.method, request.url.path) in FORCED_STEP_ROUTES:
        return None
    return _forced_step(user)


def _forced_step(user: User) -> Response | None:
    # 403, not 401: the session is valid and must not be dropped by the
    # frontend's log-out-on-401 listener; it just can't be used yet.
    if user.must_complete_profile:
        return error_response(
            403, "profile_completion_required", "Complete your profile to continue"
        )
    if user.must_change_password:
        return error_response(403, "password_change_required", "Choose a new password to continue")
    return None


def _sets_session_cookie(response: Response) -> bool:
    """Whether the route already issued (or cleared) this device's session
    cookie, e.g. after a password change bumped the epoch. The rolling
    reissue must then stand aside: its copy carries the epoch loaded
    before the route ran and, sent last, would log this device out."""
    prefix = f"{SESSION_COOKIE_NAME}=".encode()
    return any(
        name == b"set-cookie" and value.startswith(prefix) for name, value in response.raw_headers
    )


class SessionAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, settings: Settings, clock: Clock) -> None:
        super().__init__(app)
        self._settings = settings
        self._clock = clock

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        if self._settings.auth_disabled:
            return await self._dispatch_as_first_admin(request, call_next)

        token = _bearer_token(request)
        if token is not None:
            return await self._dispatch_with_token(request, call_next, token)

        # A dedicated session, not the request's own SessionDep — this runs
        # before routing has picked a handler to inject one into. Two
        # primary-key lookups (the settings singleton, the User) per request.
        session_factory = request.app.state.session_factory
        async with session_factory() as db_session:
            app_settings = await require_app_settings(db_session)
            claims = verify_session_token(
                request.cookies.get(SESSION_COOKIE_NAME),
                app_settings.session_key,
                self._settings,
                self._clock,
            )
            user = await db_session.get(User, claims.user_id) if claims is not None else None
            if claims is None or user is None:
                # Only a request with no usable session pays for this check.
                if not await install_has_password(db_session):
                    return _setup_required()
                return error_response(401, "unauthorized", "A valid session is required")

        # Disabled before stale: disabling also bumps the epoch, and the
        # frontend wants to tell "your account was disabled" apart.
        if not user.is_active:
            return _account_disabled()
        if claims.epoch != user.session_epoch:
            return error_response(401, "unauthorized", "A valid session is required")

        blocked = _forced_step_gate(request, user)
        if blocked is not None:
            return blocked

        request.state.user_id = user.id
        with acting_as(user.id):
            response = await call_next(request)
        if needs_reissue(
            claims.issued_at, self._settings, self._clock
        ) and not _sets_session_cookie(response):
            set_session_cookie(
                response,
                app_settings.session_key,
                self._settings,
                self._clock,
                user_id=user.id,
                epoch=user.session_epoch,
            )
        return response

    async def _dispatch_with_token(
        self, request: Request, call_next: RequestResponseEndpoint, token: str
    ) -> Response:
        """`Authorization: Bearer <API token>` (issue #413): the same user
        checks as a cookie (an active User, no forced step pending), but
        no session epoch: a token is revoked on its own, so changing the
        password does not end it."""
        unauthorized = error_response(401, "unauthorized", "A valid API token is required")
        user_id = owner_of(token)
        if user_id is None:
            return unauthorized
        session_factory = request.app.state.session_factory
        # The token is looked up acting as the User it names: only their
        # own tokens are searched (app.api_tokens).
        with acting_as(user_id):
            async with session_factory() as db_session:
                api_token = await find_live_token(db_session, token)
                user = await db_session.get(User, user_id) if api_token is not None else None
                if api_token is None or user is None:
                    return unauthorized
                if not user.is_active:
                    return _account_disabled()
                blocked = _forced_step_gate(request, user)
                if blocked is not None:
                    return blocked
                if _needs_password_session(request):
                    return error_response(
                        403, "token_not_allowed", "Sign in with your password to do this"
                    )
                if mark_used(api_token, self._clock()):
                    await db_session.commit()

            request.state.user_id = user_id
            return await call_next(request)

    async def _dispatch_as_first_admin(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        """Local-dev escape hatch (AUTH_DISABLED): no cookie, no forced
        steps; every request acts as the first Admin. An install with no
        User yet still has to go through `/setup` to create one."""
        session_factory = request.app.state.session_factory
        async with session_factory() as db_session:
            admin = await first_admin(db_session)
        if admin is None:
            return _setup_required()
        request.state.user_id = admin.id
        with acting_as(admin.id):
            return await call_next(request)
