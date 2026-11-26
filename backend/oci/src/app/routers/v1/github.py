"""GitHub: GitHub Tokens (issue #578, spec #576, ADR 0020).

A User pastes a fine-grained personal access token; it is checked with
GitHub before it is saved, encrypted with the master key, and listed by the
GitHub owner it grants access to. The token itself is write-only: no
response ever carries it.
"""

from datetime import datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.crypto import encrypt_credential
from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.github_source import (
    GitHubSource,
    TerminalGitHubSourceError,
    TransientGitHubSourceError,
)
from app.models import GitHubToken

router = APIRouter(prefix="/api/v1/github", tags=["github"])

FINE_GRAINED_PREFIX = "github_pat_"


class GitHubTokenCreate(BaseModel):
    token: str = Field(min_length=1, max_length=1024)


class GitHubTokenRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_login: str
    owner_kind: str
    expires_at: datetime | None
    connection_state: str
    created_at: datetime


def _not_fine_grained_error() -> APIError:
    return APIError(
        422,
        "github_token_not_fine_grained",
        "tuk-tuk accepts only fine-grained personal access tokens (they start with "
        "github_pat_). Create one with read-only access to Metadata, Issues and "
        "Pull requests.",
    )


@router.get("/tokens")
async def list_tokens(session: SessionDep) -> list[GitHubTokenRead]:
    rows = await session.scalars(select(GitHubToken).order_by(GitHubToken.id))
    return [GitHubTokenRead.model_validate(row) for row in rows]


@router.post("/tokens", status_code=201)
async def add_token(
    payload: GitHubTokenCreate, request: Request, session: SessionDep
) -> GitHubTokenRead:
    token = payload.token.strip()
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
        raise APIError(
            502,
            "github_unavailable",
            "GitHub could not be reached to check this token. Nothing was saved; "
            "try again in a moment.",
        ) from None
    if identity.token_type != "fine_grained":
        raise _not_fine_grained_error()

    # GitHub logins are case-insensitive; one GitHub Token per owner.
    existing = await session.scalar(
        select(GitHubToken).where(
            func.lower(GitHubToken.owner_login) == identity.owner_login.lower()
        )
    )
    if existing is not None:
        raise APIError(
            409,
            "github_token_owner_exists",
            f"You already have a GitHub Token for {identity.owner_login}. "
            "Remove it first to use a different one.",
        )

    settings = request.app.state.settings
    assert settings.app_master_key is not None  # app.main refuses to start without it
    row = GitHubToken(
        owner_login=identity.owner_login,
        owner_kind=identity.owner_kind,
        encrypted_token=encrypt_credential(token, key=settings.app_master_key),
        expires_at=identity.expires_at,
        connection_state="connected",
    )
    session.add(row)
    await session.commit()
    return GitHubTokenRead.model_validate(row)


@router.delete("/tokens/{token_id}", status_code=204)
async def remove_token(token_id: int, session: SessionDep) -> None:
    row = await session.get(GitHubToken, token_id)
    if row is None:
        raise NotFoundError(f"GitHub Token {token_id} not found")
    await session.delete(row)
    await session.commit()
