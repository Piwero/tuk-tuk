"""Session enforcement middleware (ADR 0005, issue #84; ADR 0008, issue #115;
ADR 0018, issue #410).

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
A request let through to its route also moves the User's last-active time
(issue #478), at most once every LAST_ACTIVE_WRITE_INTERVAL.

The AUTH_DISABLED local-dev escape hatch below is the one exception: when
set, no cookie is needed and every request acts as the first Admin. The
app refuses to start with it outside APP_ENV=development
(app.main.create_app).
"""

from datetime import timedelta

from sqlalchemy import or_, update
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

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

# A User's last-active time (issue #478) is coarse on purpose: written at
# most this often, so serving a request doesn't also mean a write.
LAST_ACTIVE_WRITE_INTERVAL = timedelta(minutes=5)

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


def _setup_required() -> Response:
    # A distinct code from "unauthorized" so the frontend can route to the
    # first-run setup screen instead of the login screen.
    return error_response(401, "setup_required", "Initial setup is required")


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
            return error_response(401, "account_disabled", "This account is disabled")
        if claims.epoch != user.session_epoch:
            return error_response(401, "unauthorized", "A valid session is required")

        if (request.method, request.url.path) not in FORCED_STEP_ROUTES:
            blocked = _forced_step(user)
            if blocked is not None:
                return blocked

        request.state.user_id = user.id
        await self._record_activity(request, user)
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

    async def _record_activity(self, request: Request, user: User) -> None:
        """Moves the User's last-active time (issue #478) to now, unless it
        was written less than LAST_ACTIVE_WRITE_INTERVAL ago: one write per
        User every few minutes, not one per request. The condition sits in
        the UPDATE itself, so concurrent requests can't both write."""
        now = self._clock()
        if user.last_active_at is not None and now - user.last_active_at < (
            LAST_ACTIVE_WRITE_INTERVAL
        ):
            return
        async with request.app.state.session_factory() as db_session:
            await db_session.execute(
                update(User)
                .where(
                    User.id == user.id,
                    or_(
                        User.last_active_at.is_(None),
                        User.last_active_at <= now - LAST_ACTIVE_WRITE_INTERVAL,
                    ),
                )
                # Being active doesn't change the account: keep `updated_at`
                # from its onupdate default.
                .values(last_active_at=now, updated_at=User.updated_at)
                .execution_options(synchronize_session=False)
            )
            await db_session.commit()

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
