"""Invitations (issue #586): the rules every invitation path shares — its
lifecycle, its single-use credential, and emailing its link.

An invitation's lifecycle is read from its timestamps, never stored:
accepted once `accepted_at` is set, canceled once `canceled_at` is,
expired from `expires_at` on (the boundary instant included), pending
otherwise. Only a pending invitation can be accepted, retried or copied.
Its delivery outcome is separate: a pending invitation may never have been
emailed, or may have failed to be.
"""

import hashlib
import secrets
from datetime import datetime, timedelta
from email.message import EmailMessage
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.crypto import decrypt_credential, encrypt_credential
from app.mailer import MailDeliveryError, Mailer
from app.models import Invitation

INVITATION_LIFETIME = timedelta(days=7)

InvitationStatus = Literal["pending", "accepted", "canceled", "expired"]

NOT_CONFIGURED = "Email delivery is not configured"


def status_of(invitation: Invitation, now: datetime) -> InvitationStatus:
    if invitation.accepted_at is not None:
        return "accepted"
    if invitation.canceled_at is not None:
        return "canceled"
    if now >= invitation.expires_at:
        return "expired"
    return "pending"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_credential(invitation: Invitation, *, master_key: str, now: datetime) -> str:
    """Gives `invitation` a fresh single-use credential and seven days from
    `now`, replacing any earlier one (so older links stop working), and
    returns the plaintext token for its link."""
    token = secrets.token_urlsafe(32)
    invitation.token_hash = hash_token(token)
    invitation.encrypted_token = encrypt_credential(token, key=master_key)
    invitation.expires_at = now + INVITATION_LIFETIME
    return token


def token_of(invitation: Invitation, *, master_key: str) -> str:
    return decrypt_credential(invitation.encrypted_token, key=master_key)


async def find_by_token(session: AsyncSession, token: str) -> Invitation | None:
    found: Invitation | None = await session.scalar(
        select(Invitation).where(Invitation.token_hash == hash_token(token))
    )
    return found


def public_url(settings: Settings) -> str:
    """The frontend origin links in emails point at."""
    base = settings.app_public_url or (settings.cors_origins[0] if settings.cors_origins else "")
    return base.rstrip("/")


def invitation_link(settings: Settings, token: str) -> str:
    """The acceptance link. The token travels in the fragment, which
    browsers never send to a server, so it stays out of access logs."""
    return f"{public_url(settings)}/invite#token={token}"


def _message(settings: Settings, invitation: Invitation, link: str) -> EmailMessage:
    message = EmailMessage()
    message["To"] = invitation.email
    message["Subject"] = f"You're invited to {settings.app_name}"
    expires = invitation.expires_at.strftime("%d %B %Y, %H:%M UTC")
    message.set_content(
        f"You have been invited to {settings.app_name}.\n\n"
        f"Accept the invitation by signing in with the Google account for "
        f"{invitation.email}:\n\n{link}\n\n"
        f"This link works once and expires on {expires}. If you were not "
        "expecting this invitation, ignore this email.\n"
    )
    return message


async def deliver(
    invitation: Invitation,
    token: str,
    *,
    settings: Settings,
    mailer: Mailer | None,
    now: datetime,
) -> None:
    """Emails the invitation's link and records the outcome on it: "sent"
    only once the mail server took the message, "failed" (with a safe
    reason) otherwise, including when no mail server is configured. The
    caller commits."""
    if mailer is None:
        invitation.delivery_state = "failed"
        invitation.delivery_error = NOT_CONFIGURED
        return
    try:
        await mailer.send(_message(settings, invitation, invitation_link(settings, token)))
    except MailDeliveryError as exc:
        invitation.delivery_state = "failed"
        invitation.delivery_error = str(exc)[:255]
        return
    invitation.delivery_state = "sent"
    invitation.delivery_error = None
    invitation.sent_at = now
