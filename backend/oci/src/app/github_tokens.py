"""GitHub Tokens outside any one route (spec #576, ADR 0020): what both the
GitHub Token routes and the GitHub view reads need to know about a token —
its expiry warning, its plaintext, its owner, and how a failure at GitHub
changes it.
"""

from datetime import datetime, timedelta

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto import decrypt_credential
from app.errors import APIError
from app.github_source import GitHubOwner, GitHubSource, GitHubSourceError
from app.models import GitHubConnectionState, GitHubToken

# How long before a GitHub Token expires the User is warned (spec #576).
EXPIRY_WARNING = timedelta(days=7)


def expires_soon(expires_at: datetime | None, now: datetime) -> bool:
    """Whether a GitHub Token expiring at `expires_at` is within the expiry
    warning, or already expired. A token without an expiry never is."""
    return expires_at is not None and expires_at - now <= EXPIRY_WARNING


def plaintext(request: Request, token: GitHubToken) -> str:
    """The token itself, decrypted with the master key, to call GitHub with."""
    return decrypt_credential(token.encrypted_token, key=request.app.state.settings.app_master_key)


async def mark_needs_reconnect(session: AsyncSession, token: GitHubToken) -> None:
    """GitHub rejected the token itself (401): it needs reconnecting (issue
    #584, ADR 0007). A transient failure never comes here."""
    token.connection_state = GitHubConnectionState.NEEDS_RECONNECT
    await session.commit()


async def mark_connected(session: AsyncSession, token: GitHubToken) -> None:
    """GitHub accepted the token on a live read after all."""
    token.connection_state = GitHubConnectionState.CONNECTED
    await session.commit()


def github_unavailable(message: str) -> APIError:
    """GitHub could not be reached (a transient failure): retryable."""
    return APIError(502, "github_unavailable", message)


async def owner_taken(session: AsyncSession, owner: GitHubOwner, but: int | None = None) -> bool:
    """Whether another of the User's GitHub Tokens (any but `but`) is for
    `owner`. GitHub logins are case-insensitive."""
    query = select(GitHubToken.id).where(func.lower(GitHubToken.owner_login) == owner.login.lower())
    if but is not None:
        query = query.where(GitHubToken.id != but)
    return await session.scalar(query) is not None


async def learn_owner(request: Request, session: AsyncSession, token: GitHubToken) -> None:
    """Asks GitHub again for the owner of a GitHub Token that has none
    yet, now that it reads repositories (ADR 0020). An owner another GitHub
    Token already covers is not taken, so each owner keeps one token."""
    github_source: GitHubSource = request.app.state.github_source
    try:
        owner = (await github_source.identify_token(plaintext(request, token))).owner
    except GitHubSourceError:
        return  # Asked again next time.
    if owner is not None and not await owner_taken(session, owner, but=token.id):
        token.owner_login, token.owner_kind = owner.login, owner.kind
        await session.commit()


def token_name(token: GitHubToken) -> str:
    """How messages name a GitHub Token: by its owner, when known."""
    if token.owner_login is None:
        return "the GitHub Token whose owner is not known yet"
    return f"the GitHub Token for {token.owner_login}"
