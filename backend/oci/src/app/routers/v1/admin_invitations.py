"""The admin invitations API (issue #586): an Admin invites an email
address, follows its lifecycle and delivery, and retries, resends, copies
or cancels it. Under /api/v1/admin, so never reachable with an API token
(app.middleware).

An invitation admits a regular User only, and creating one creates no
account: the account is created when the invitation is accepted
(app.routers.v1.google_sign_in).
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.current_user import AdminDep, require_admin
from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.google_identity import shared_google_client
from app.invitations import (
    InvitationStatus,
    deliver,
    invitation_link,
    issue_credential,
    status_of,
    token_of,
)
from app.models import Invitation
from app.schemas import Page
from app.users import clean_email, email_in_use, email_taken

router = APIRouter(
    prefix="/api/v1/admin/invitations", tags=["admin"], dependencies=[Depends(require_admin)]
)


class InvitationRead(BaseModel):
    id: int
    email: str
    status: InvitationStatus
    # What the app knows of emailing the link: never "delivered", since a
    # mail server taking a message is no receipt that it reached an inbox.
    delivery: Literal["not_sent", "sent", "failed"]
    delivery_error: str | None
    sent_at: datetime | None
    created_at: datetime
    expires_at: datetime
    accepted_at: datetime | None
    canceled_at: datetime | None
    accepted_user_id: int | None


class InvitationCreate(BaseModel):
    email: str


class InvitationAvailability(BaseModel):
    """Whether invitations can be accepted (the shared Google client is
    configured) and emailed (SMTP is). Says nothing about either secret."""

    google_sign_in: bool
    email_delivery: bool


class InvitationLink(BaseModel):
    url: str


def _read(invitation: Invitation, now: datetime) -> InvitationRead:
    return InvitationRead(
        id=invitation.id,
        email=invitation.email,
        status=status_of(invitation, now),
        delivery=invitation.delivery_state,
        delivery_error=invitation.delivery_error,
        sent_at=invitation.sent_at,
        created_at=invitation.created_at,
        expires_at=invitation.expires_at,
        accepted_at=invitation.accepted_at,
        canceled_at=invitation.canceled_at,
        accepted_user_id=invitation.accepted_user_id,
    )


def _master_key(request: Request) -> str:
    key: str | None = request.app.state.settings.app_master_key
    assert key is not None  # app.main refuses to start without it
    return key


async def _send(request: Request, invitation: Invitation, token: str) -> None:
    await deliver(
        invitation,
        token,
        settings=request.app.state.settings,
        mailer=request.app.state.mailer,
        now=request.app.state.clock(),
    )


async def _get_or_404(
    session: AsyncSession, invitation_id: int, *, lock: bool = True
) -> Invitation:
    """The invitation; locked, unless the caller is about to email it: a
    lock must not be held across a mail server's round trip, where it
    would stall an acceptance."""
    invitation = await session.get(Invitation, invitation_id, with_for_update=lock)
    if invitation is None:
        raise NotFoundError(f"Invitation {invitation_id} not found")
    return invitation


def _conflict(code: str, message: str) -> APIError:
    return APIError(409, code, message)


@router.get("/availability")
async def availability(request: Request) -> InvitationAvailability:
    return InvitationAvailability(
        google_sign_in=shared_google_client(request.app.state.settings) is not None,
        email_delivery=request.app.state.mailer is not None,
    )


@router.get("")
async def list_invitations(
    request: Request,
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[InvitationRead]:
    now = request.app.state.clock()
    total = await session.scalar(select(func.count()).select_from(Invitation)) or 0
    rows = await session.scalars(
        select(Invitation).order_by(Invitation.id.desc()).limit(limit).offset(offset)
    )
    return Page(items=[_read(row, now) for row in rows], total=total, limit=limit, offset=offset)


@router.post("", status_code=201)
async def create_invitation(
    payload: InvitationCreate, request: Request, session: SessionDep, admin: AdminDep
) -> InvitationRead:
    """Invites `email` and emails the link. 409 `google_sign_in_unavailable`
    without the shared Google client (nobody could accept it),
    `email_taken` when a User already has the address (existing accounts
    link Google instead), `invitation_exists` while an earlier invitation
    for it is pending or expired (resend that one). A failed email still
    creates the invitation, with the failure recorded."""
    if shared_google_client(request.app.state.settings) is None:
        raise _conflict(
            "google_sign_in_unavailable", "Google sign-in is not configured on this instance"
        )
    email = clean_email(payload.email)
    if await email_in_use(session, email):
        raise email_taken()
    now = request.app.state.clock()
    for earlier in await session.scalars(select(Invitation).where(Invitation.email == email)):
        if status_of(earlier, now) in ("pending", "expired"):
            raise _conflict("invitation_exists", "That email already has an open invitation")

    invitation = Invitation(email=email, invited_by_id=admin.id)
    token = issue_credential(invitation, master_key=_master_key(request), now=now)
    session.add(invitation)
    # Committed before the email goes out: a crash mid-send leaves an
    # invitation reading "not sent", never an email for one that is gone.
    try:
        await session.commit()
    except IntegrityError:
        # A concurrent invitation for the same address won the race.
        raise _conflict("invitation_exists", "That email already has an open invitation") from None
    await _send(request, invitation, token)
    await session.commit()
    return _read(invitation, now)


@router.post("/{invitation_id}/send")
async def retry_delivery(
    invitation_id: int, request: Request, session: SessionDep
) -> InvitationRead:
    """Emails a pending invitation's existing link again, after a failure.
    Its validity is unchanged: resend for a fresh seven days."""
    now = request.app.state.clock()
    invitation = await _get_or_404(session, invitation_id, lock=False)
    if status_of(invitation, now) != "pending":
        raise _conflict("invitation_not_pending", "Only a pending invitation can be sent")
    await _send(request, invitation, token_of(invitation, master_key=_master_key(request)))
    await session.commit()
    return _read(invitation, now)


@router.post("/{invitation_id}/resend")
async def resend(invitation_id: int, request: Request, session: SessionDep) -> InvitationRead:
    """Gives a pending or expired invitation a new link valid for seven
    days, invalidating every earlier link, and emails it."""
    now = request.app.state.clock()
    invitation = await _get_or_404(session, invitation_id)
    if status_of(invitation, now) not in ("pending", "expired"):
        raise _conflict("invitation_closed", "This invitation was accepted or canceled")
    token = issue_credential(invitation, master_key=_master_key(request), now=now)
    invitation.delivery_state, invitation.delivery_error = "not_sent", None
    await session.commit()
    await _send(request, invitation, token)
    await session.commit()
    return _read(invitation, now)


@router.post("/{invitation_id}/link")
async def copy_link(invitation_id: int, request: Request, session: SessionDep) -> InvitationLink:
    """A pending invitation's link, for an Admin to pass on another way. It
    obeys the same rules as the emailed one."""
    now = request.app.state.clock()
    invitation = await _get_or_404(session, invitation_id, lock=False)
    if status_of(invitation, now) != "pending":
        raise _conflict("invitation_not_pending", "Only a pending invitation has a usable link")
    token = token_of(invitation, master_key=_master_key(request))
    return InvitationLink(url=invitation_link(request.app.state.settings, token))


@router.post("/{invitation_id}/cancel")
async def cancel(invitation_id: int, request: Request, session: SessionDep) -> InvitationRead:
    """Cancels an invitation not yet accepted: its link stops working."""
    now = request.app.state.clock()
    invitation = await _get_or_404(session, invitation_id)
    status = status_of(invitation, now)
    if status == "accepted":
        raise _conflict("invitation_closed", "This invitation was already accepted")
    if status != "canceled":
        invitation.canceled_at = now
        await session.commit()
    return _read(invitation, now)
