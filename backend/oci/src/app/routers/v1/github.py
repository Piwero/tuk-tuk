"""GitHub Tokens (issue #578, spec #576, ADR 0020).

A User pastes a fine-grained personal access token; it is checked with
GitHub before it is saved, encrypted with the master key, and listed by the
GitHub owner it grants access to. The token itself is write-only: no
response ever carries it. The Watched Repositories read through them live
in app.routers.v1.github_repositories.
"""

from datetime import datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.crypto import encrypt_credential
from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.github_source import (
    FINE_GRAINED_PREFIX,
    GitHubOwner,
    GitHubOwnerKind,
    GitHubSource,
    GitHubTokenIdentity,
    TerminalGitHubSourceError,
    TransientGitHubSourceError,
)
from app.github_tokens import expires_soon, github_unavailable, owner_taken
from app.models import GitHubConnectionState, GitHubToken

router = APIRouter(prefix="/api/v1/github", tags=["github"])


class GitHubTokenCreate(BaseModel):
    token: str = Field(min_length=1, max_length=1024)


class GitHubTokenRead(BaseModel):
    id: int
    # Both absent while GitHub cannot tell the token's owner (ADR 0020).
    owner_login: str | None
    owner_kind: GitHubOwnerKind | None
    expires_at: datetime | None
    expires_soon: bool
    connection_state: GitHubConnectionState
    created_at: datetime

    @classmethod
    def of(cls, row: GitHubToken, request: Request) -> "GitHubTokenRead":
        return cls(
            id=row.id,
            owner_login=row.owner_login,
            owner_kind=row.owner_kind,
            expires_at=row.expires_at,
            expires_soon=expires_soon(row.expires_at, request.app.state.clock()),
            connection_state=row.connection_state,
            created_at=row.created_at,
        )


def _not_fine_grained_error() -> APIError:
    return APIError(
        422,
        "github_token_not_fine_grained",
        "tuk-tuk accepts only fine-grained personal access tokens (they start with "
        "github_pat_). Create one with read-only access to Metadata, Issues and "
        "Pull requests.",
    )


@router.get("/tokens")
async def list_tokens(request: Request, session: SessionDep) -> list[GitHubTokenRead]:
    rows = await session.scalars(select(GitHubToken).order_by(GitHubToken.id))
    return [GitHubTokenRead.of(row, request) for row in rows]


async def _validate(request: Request, token: str) -> GitHubTokenIdentity:
    """Checks a pasted token with GitHub before anything is saved: only a
    fine-grained token GitHub accepts gets through."""
    # GitHub's own prefix for fine-grained tokens: anything else is refused
    # before it is ever sent to GitHub.
    if not token.startswith(FINE_GRAINED_PREFIX):
        raise _not_fine_grained_error()
    github_source: GitHubSource = request.app.state.github_source
    try:
        identity = await github_source.identify_token(token)
    except TerminalGitHubSourceError:
        raise APIError(
            422,
            "github_token_rejected",
            "GitHub rejected this token: it may be mistyped, expired or revoked.",
        ) from None
    except TransientGitHubSourceError:
        raise github_unavailable(
            "GitHub could not be reached to check this token. Nothing was saved; "
            "try again in a moment."
        ) from None
    if identity.token_type != "fine_grained":
        raise _not_fine_grained_error()
    return identity


def _encrypt(request: Request, token: str) -> str:
    settings = request.app.state.settings
    assert settings.app_master_key is not None  # app.main refuses to start without it
    return encrypt_credential(token, key=settings.app_master_key)


def _owner_exists_error(owner: GitHubOwner) -> APIError:
    return APIError(
        409,
        "github_token_owner_exists",
        f"You already have a GitHub Token for {owner.login}. Reconnect it to use a different one.",
    )


@router.post("/tokens", status_code=201)
async def add_token(
    payload: GitHubTokenCreate, request: Request, session: SessionDep
) -> GitHubTokenRead:
    """Saves a pasted token. One whose owner GitHub cannot tell yet is
    saved without one, and learns it once it reads a repository."""
    token = payload.token.strip()
    identity = await _validate(request, token)
    owner = identity.owner
    # One GitHub Token per owner.
    if owner is not None and await owner_taken(session, owner):
        raise _owner_exists_error(owner)

    row = GitHubToken(
        owner_login=owner.login if owner else None,
        owner_kind=owner.kind if owner else None,
        encrypted_token=_encrypt(request, token),
        expires_at=identity.expires_at,
        connection_state=GitHubConnectionState.CONNECTED,
    )
    session.add(row)
    await session.commit()
    return GitHubTokenRead.of(row, request)


@router.patch("/tokens/{token_id}")
async def reconnect_token(
    token_id: int, payload: GitHubTokenCreate, request: Request, session: SessionDep
) -> GitHubTokenRead:
    """Reconnect: replaces the token on an existing GitHub Token in place
    with a replacement for the same owner, so its Watched Repositories
    survive a rotation (issue #584). A GitHub Token whose owner is not
    known yet takes the replacement's."""
    row = await session.get(GitHubToken, token_id)
    if row is None:
        raise NotFoundError(f"GitHub Token {token_id} not found")
    token = payload.token.strip()
    identity = await _validate(request, token)
    owner = identity.owner
    if row.owner_login is None:
        if owner is not None:
            if await owner_taken(session, owner, but=row.id):
                raise _owner_exists_error(owner)
            row.owner_login, row.owner_kind = owner.login, owner.kind
    # A replacement must grant access to the same owner, or the Watched
    # Repositories it keeps would be read through someone else's access.
    elif owner is None:
        raise APIError(
            422,
            "github_token_owner_unknown",
            "GitHub cannot tell which owner this token is for until it can read a "
            f"repository. If {row.owner_login} must allow or approve fine-grained "
            "tokens, try again once it has.",
        )
    elif owner.login.lower() != row.owner_login.lower():
        raise APIError(
            422,
            "github_token_owner_mismatch",
            f"This token grants access to {owner.login}, not {row.owner_login}. Paste a "
            f"token for {row.owner_login}, or add it as a new GitHub Token.",
        )
    row.encrypted_token = _encrypt(request, token)
    row.expires_at = identity.expires_at
    row.connection_state = GitHubConnectionState.CONNECTED
    await session.commit()
    return GitHubTokenRead.of(row, request)


@router.delete("/tokens/{token_id}", status_code=204)
async def remove_token(token_id: int, session: SessionDep) -> None:
    row = await session.get(GitHubToken, token_id)
    if row is None:
        raise NotFoundError(f"GitHub Token {token_id} not found")
    await session.delete(row)
    await session.commit()
