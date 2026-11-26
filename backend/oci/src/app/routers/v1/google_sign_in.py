"""Invite-only Google sign-in (issue #586): signing in with Google,
accepting an invitation, and linking Google to an existing account.

Three separate things never blur here:

- Admission: only an invitation (or an Admin creating an account) lets a
  person in. Signing in with a Google account no User has linked creates
  nothing and is simply refused.
- Login identity: Google's stable account id (`sub`) on the User, unique
  across Users, matched on every sign-in. Never matched by email, and
  never taken from a Google Calendar connection.
- Calendar connection: a separate, optional consent (app.routers.v1.google)
  that signing in never requests.

Signing in asks Google for identity only (`openid email`, no refresh
token). Every round trip is guarded by the browser-bound transaction of
app.oauth_transaction: state, nonce and PKCE.

The login and invitation callback is public (the person has no session);
the link callback is a separate route that needs the signed-in User who
started it, and neither accepts the other's transaction.
"""

import logging
from datetime import datetime
from urllib.parse import urlencode

from fastapi import APIRouter, Request, Response
from fastapi.responses import RedirectResponse
from itsdangerous import BadSignature, URLSafeSerializer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import require_app_settings
from app.calendar_source import GoogleOAuthClient
from app.config import Settings
from app.current_user import CurrentUserDep
from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.google_identity import (
    GOOGLE_AUTH_URL,
    SIGN_IN_SCOPE,
    GoogleIdentity,
    GoogleSignInError,
    InvalidIdTokenError,
    new_pkce_verifier,
    pkce_challenge,
    shared_google_client,
    verify_id_token,
)
from app.invitations import InvitationStatus, find_by_token, status_of
from app.models import Invitation, User
from app.oauth_transaction import (
    Purpose,
    Transaction,
    clear_transaction_cookie,
    frontend_origin,
    invalid_state,
    new_transaction,
    read_transaction,
    safe_next_path,
    set_transaction_cookie,
)
from app.routers.v1.auth import confirm_password, sign_in
from app.users import (
    clean_username,
    create_user,
    email_in_use,
    ensure_identity_free,
    google_identity_taken,
    reporting_taken_identity,
    same_email,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

CALLBACK_PATH = "/api/v1/auth/google/callback"
LINK_CALLBACK_PATH = "/api/v1/auth/google/link/callback"

# The verified Google identity between the invitation callback and the
# person choosing a username: signed, short-lived, and only ever sent to
# the acceptance route.
ACCEPTANCE_COOKIE = "tuktuk_invitation_acceptance"
ACCEPTANCE_COOKIE_PATH = "/api/v1/auth/invitations"
ACCEPTANCE_MAX_AGE_SECONDS = 900
_ACCEPTANCE_SALT = "tuk-tuk-invitation-acceptance"


class Providers(BaseModel):
    """Which sign-in methods this instance offers besides a password."""

    google: bool


class AuthorizationStart(BaseModel):
    """Where the browser goes next: Google's consent screen."""

    authorization_url: str


class LoginStart(BaseModel):
    next: str | None = None


class InvitationToken(BaseModel):
    token: str


class InvitationLookup(BaseModel):
    email: str
    status: InvitationStatus


class AcceptRequest(BaseModel):
    username: str


class LinkStart(BaseModel):
    password: str
    next: str | None = None


def _shared_client_or_404(settings: Settings) -> GoogleOAuthClient:
    client = shared_google_client(settings)
    if client is None:
        raise NotFoundError("Google sign-in is not configured")
    return client


def _redirect_uri(origin: str, purpose: Purpose) -> str:
    """The callback Google sends the browser back to: built from the
    verified frontend origin (the dev proxy rewrites Host, so not
    `request.url_for`), and registered with the OAuth client per origin."""
    return f"{origin}{LINK_CALLBACK_PATH if purpose == 'link' else CALLBACK_PATH}"


async def _begin(
    request: Request,
    session: AsyncSession,
    response: Response,
    transaction: Transaction,
    *,
    login_hint: str | None = None,
) -> AuthorizationStart:
    settings: Settings = request.app.state.settings
    client = _shared_client_or_404(settings)
    if not transaction.origin:
        raise APIError(400, "unknown_origin", "No frontend origin is configured")
    params = {
        "client_id": client.client_id,
        "redirect_uri": _redirect_uri(transaction.origin, transaction.purpose),
        "response_type": "code",
        "scope": SIGN_IN_SCOPE,
        "state": transaction.state,
        "nonce": transaction.nonce,
        "code_challenge": pkce_challenge(transaction.verifier),
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    if login_hint:
        params["login_hint"] = login_hint
    app_settings = await require_app_settings(session)
    set_transaction_cookie(response, transaction, app_settings.session_key, settings)
    return AuthorizationStart(authorization_url=f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


async def _verified_identity(
    request: Request, transaction: Transaction, code: str
) -> GoogleIdentity | None:
    """The identity Google asserts for this round trip, or None when the
    code exchange or the ID token's verification fails."""
    settings: Settings = request.app.state.settings
    client = _shared_client_or_404(settings)
    google = request.app.state.google_sign_in
    try:
        id_token = await google.exchange_code(
            client,
            code,
            _redirect_uri(transaction.origin, transaction.purpose),
            transaction.verifier,
        )
        keys = await google.signing_keys()
        return verify_id_token(
            id_token,
            keys,
            client_id=client.client_id,
            nonce=transaction.nonce,
            now=request.app.state.clock(),
        )
    except (GoogleSignInError, InvalidIdTokenError) as exc:
        logger.info("Google sign-in (%s) failed: %s", transaction.purpose, exc)
        return None


def _with_query(url: str, **params: str) -> str:
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}{urlencode(params)}"


def _landing(transaction: Transaction, **params: str) -> RedirectResponse:
    """Back to the app: an invitation to its own page, a link to `next`,
    a login to `next` once signed in or to the sign-in screen if not."""
    if transaction.purpose == "invitation":
        url = f"{transaction.origin}/invite"
    elif transaction.purpose == "login" and "signInError" in params:
        url = f"{transaction.origin}/"
    else:
        url = f"{transaction.origin}{transaction.next_path}"
    return RedirectResponse(_with_query(url, **params) if params else url, status_code=302)


def _failure(transaction: Transaction, code: str) -> RedirectResponse:
    key = {"login": "signInError", "invitation": "error", "link": "googleLink"}[transaction.purpose]
    return _landing(transaction, **{key: code})


async def _user_with_subject(session: AsyncSession, subject: str) -> User | None:
    found: User | None = await session.scalar(select(User).where(User.google_subject == subject))
    return found


def _acceptance_serializer(session_key: str) -> URLSafeSerializer:
    return URLSafeSerializer(session_key, salt=_ACCEPTANCE_SALT)


def _invitation_unavailable(status: InvitationStatus | None = None) -> APIError:
    return APIError(
        409,
        "invitation_unavailable",
        "This invitation can no longer be accepted. Ask your admin for a new one.",
        details=None if status is None else {"status": status},
    )


async def _acceptable_invitation(
    session: AsyncSession, invitation_id: int | None, token_hash: str | None, now: datetime
) -> Invitation | None:
    """The invitation, locked, if it is still pending under the credential
    the round trip began with (a resend or cancel since then ends it)."""
    if invitation_id is None:
        return None
    invitation = await session.get(Invitation, invitation_id, with_for_update=True)
    if (
        invitation is None
        or invitation.token_hash != token_hash
        or status_of(invitation, now) != "pending"
    ):
        return None
    return invitation


@router.get("/providers")
async def providers(request: Request) -> Providers:
    return Providers(google=shared_google_client(request.app.state.settings) is not None)


@router.post("/google/login")
async def start_login(
    payload: LoginStart, request: Request, response: Response, session: SessionDep
) -> AuthorizationStart:
    """Starts signing in with Google. `next` is a path on this site to land
    on afterwards (400 `unsafe_return_url` for anything else)."""
    settings: Settings = request.app.state.settings
    _shared_client_or_404(settings)
    transaction = new_transaction(
        "login",
        frontend_origin(request, settings),
        new_pkce_verifier(),
        request.app.state.clock(),
        next_path=safe_next_path(payload.next),
    )
    return await _begin(request, session, response, transaction)


@router.post("/invitations/lookup")
async def lookup_invitation(
    payload: InvitationToken, request: Request, session: SessionDep
) -> InvitationLookup:
    """What an invitation link is for: its email and whether it can still
    be accepted. An unknown or replaced link is 404."""
    invitation = await find_by_token(session, payload.token)
    if invitation is None:
        raise NotFoundError("This invitation link is not valid")
    return InvitationLookup(
        email=invitation.email, status=status_of(invitation, request.app.state.clock())
    )


@router.post("/google/invitation")
async def start_invitation(
    payload: InvitationToken, request: Request, response: Response, session: SessionDep
) -> AuthorizationStart:
    """Starts accepting an invitation by signing in with Google, hinting
    the invited address. 404 for an unknown link, 409
    `invitation_unavailable` for one no longer pending."""
    settings: Settings = request.app.state.settings
    _shared_client_or_404(settings)
    invitation = await find_by_token(session, payload.token)
    if invitation is None:
        raise NotFoundError("This invitation link is not valid")
    status = status_of(invitation, request.app.state.clock())
    if status != "pending":
        raise _invitation_unavailable(status)
    transaction = new_transaction(
        "invitation",
        frontend_origin(request, settings),
        new_pkce_verifier(),
        request.app.state.clock(),
        invitation_id=invitation.id,
        token_hash=invitation.token_hash,
    )
    return await _begin(request, session, response, transaction, login_hint=invitation.email)


@router.get("/google/callback", name="google_sign_in_callback")
async def callback(
    request: Request,
    session: SessionDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Google's redirect back for a login or an invitation. Always lands
    back on the app, with the outcome in the query string: signed in, on to
    choosing a username, or why not."""
    settings: Settings = request.app.state.settings
    app_settings = await require_app_settings(session)
    transaction = read_transaction(
        request, app_settings.session_key, state, {"login", "invitation"}, request.app.state.clock()
    )

    response = await _finish(request, session, transaction, code, error)
    clear_transaction_cookie(response, settings)
    return response


async def _finish(
    request: Request,
    session: AsyncSession,
    transaction: Transaction,
    code: str | None,
    error: str | None,
) -> RedirectResponse:
    if error is not None or code is None:
        return _failure(transaction, "google_cancelled")
    identity = await _verified_identity(request, transaction, code)
    if identity is None:
        return _failure(transaction, "google_failed")
    if not identity.email_verified:
        return _failure(transaction, "google_email_unverified")

    if transaction.purpose == "login":
        return await _finish_login(request, session, transaction, identity)
    return await _finish_invitation(request, session, transaction, identity)


async def _finish_login(
    request: Request, session: AsyncSession, transaction: Transaction, identity: GoogleIdentity
) -> RedirectResponse:
    """Signs in the User whose login identity this is. A Google account no
    User has linked, whatever its email, creates nothing: no open
    registration, and no merging into an account by email."""
    user = await _user_with_subject(session, identity.subject)
    if user is None:
        return _failure(transaction, "not_recognized")
    if not user.is_active:
        return _failure(transaction, "account_disabled")
    response = _landing(transaction)
    app_settings = await require_app_settings(session)
    sign_in(request, response, app_settings.session_key, user, "google")
    return response


async def _finish_invitation(
    request: Request, session: AsyncSession, transaction: Transaction, identity: GoogleIdentity
) -> RedirectResponse:
    """Checks the Google account may accept this invitation, then holds
    its identity for the username step. Creates nothing yet."""
    now = request.app.state.clock()
    invitation = await _acceptable_invitation(
        session, transaction.invitation_id, transaction.token_hash, now
    )
    if invitation is None:
        return _failure(transaction, "invitation_unavailable")
    if not same_email(identity.email, invitation.email):
        return _failure(transaction, "email_mismatch")
    if await _user_with_subject(session, identity.subject) is not None:
        return _failure(transaction, "identity_in_use")
    if await email_in_use(session, invitation.email):
        return _failure(transaction, "email_in_use")
    pending = {
        "i": invitation.id,
        "h": invitation.token_hash,
        "sub": identity.subject,
        "email": identity.email,
        "t": now.timestamp(),
    }
    await session.rollback()  # release the lock: nothing was written

    response = _landing(transaction, step="username")
    app_settings = await require_app_settings(session)
    response.set_cookie(
        ACCEPTANCE_COOKIE,
        _acceptance_serializer(app_settings.session_key).dumps(pending),
        max_age=ACCEPTANCE_MAX_AGE_SECONDS,
        httponly=True,
        secure=request.app.state.settings.auth_cookie_secure,
        samesite="strict",
        path=ACCEPTANCE_COOKIE_PATH,
    )
    return response


@router.post("/invitations/accept", status_code=204)
async def accept_invitation(
    payload: AcceptRequest, request: Request, response: Response, session: SessionDep
) -> None:
    """Accepts the invitation this browser verified with Google, as a new
    regular User named `username`, and signs them in. The invitation is
    consumed and the User, their settings and Inbox created in one
    transaction, under a lock on the invitation: a repeat or concurrent
    acceptance finds it accepted (409 `invitation_unavailable`), and a
    refused username (422/409) consumes nothing."""
    settings: Settings = request.app.state.settings
    app_settings = await require_app_settings(session)
    try:
        pending = _acceptance_serializer(app_settings.session_key).loads(
            request.cookies.get(ACCEPTANCE_COOKIE, "")
        )
        invitation_id, token_hash = int(pending["i"]), str(pending["h"])
        subject, google_email = str(pending["sub"]), str(pending["email"])
        verified_at = float(pending["t"])
    except (BadSignature, KeyError, TypeError, ValueError):
        verified_at = None
    now = request.app.state.clock()
    if verified_at is None or now.timestamp() - verified_at > ACCEPTANCE_MAX_AGE_SECONDS:
        raise APIError(
            400,
            "acceptance_not_started",
            "Open your invitation link and continue with Google first",
        ) from None

    username = clean_username(payload.username)
    invitation = await _acceptable_invitation(session, invitation_id, token_hash, now)
    if invitation is None:
        raise _invitation_unavailable()
    if await _user_with_subject(session, subject) is not None:
        raise google_identity_taken()
    await ensure_identity_free(session, username, invitation.email)

    async with reporting_taken_identity():
        user = await create_user(
            session,
            User(
                username=username,
                email=invitation.email,
                password_hash=None,
                is_admin=False,
                google_subject=subject,
                google_email=google_email,
                google_linked_at=now,
                password_changed_at=now,
            ),
        )
        invitation.accepted_at = now
        invitation.accepted_user_id = user.id
        await session.commit()

    response.delete_cookie(
        ACCEPTANCE_COOKIE,
        path=ACCEPTANCE_COOKIE_PATH,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="strict",
    )
    sign_in(request, response, app_settings.session_key, user, "google")


@router.post("/google/link")
async def start_link(
    payload: LinkStart,
    request: Request,
    response: Response,
    user: CurrentUserDep,
    session: SessionDep,
) -> AuthorizationStart:
    """Starts linking Google to the signed-in User's existing account,
    after they confirm their password (same lockout as /login). Only a
    Google account whose verified email matches the account's can be
    linked; one already linked is replaced only by an Admin's recovery.
    Never with an API token (app.middleware)."""
    settings: Settings = request.app.state.settings
    _shared_client_or_404(settings)
    if user.google_subject is not None:
        raise APIError(409, "google_already_linked", "This account already signs in with Google")
    next_path = safe_next_path(payload.next)
    await confirm_password(request, session, user, payload.password)
    transaction = new_transaction(
        "link",
        frontend_origin(request, settings),
        new_pkce_verifier(),
        request.app.state.clock(),
        next_path=next_path,
        user_id=user.id,
    )
    return await _begin(request, session, response, transaction, login_hint=user.email)


@router.get("/google/link/callback", name="google_link_callback")
async def link_callback(
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Google's redirect back for a link: only for the signed-in User who
    started it. Lands back on `next` with `googleLink` set to `linked` or
    why not."""
    settings: Settings = request.app.state.settings
    app_settings = await require_app_settings(session)
    transaction = read_transaction(
        request, app_settings.session_key, state, {"link"}, request.app.state.clock()
    )
    if transaction.user_id != user.id:
        raise invalid_state()

    response = await _finish_link(request, session, transaction, user, code, error)
    clear_transaction_cookie(response, settings)
    return response


async def _finish_link(
    request: Request,
    session: AsyncSession,
    transaction: Transaction,
    user: User,
    code: str | None,
    error: str | None,
) -> RedirectResponse:
    if error is not None or code is None:
        return _failure(transaction, "google_cancelled")
    identity = await _verified_identity(request, transaction, code)
    if identity is None:
        return _failure(transaction, "google_failed")
    if not identity.email_verified:
        return _failure(transaction, "google_email_unverified")
    if user.google_subject is not None:
        return _failure(transaction, "google_already_linked")
    if not same_email(identity.email, user.email):
        return _failure(transaction, "email_mismatch")
    holder = await _user_with_subject(session, identity.subject)
    if holder is not None:
        return _failure(transaction, "identity_in_use")

    user.link_google(identity.subject, identity.email, request.app.state.clock())
    try:
        async with reporting_taken_identity():
            await session.commit()
    except APIError:
        return _failure(transaction, "identity_in_use")
    return _landing(transaction, googleLink="linked")
