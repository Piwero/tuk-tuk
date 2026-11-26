"""Watched Repositories and their picker (issue #581, spec #576, ADR 0020).

The picker offers every repository the User's GitHub Tokens can read, once
each; a Watched Repository is read through the GitHub Token it was picked
with and deleted with it.
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.github_source import (
    GitHubRepository,
    GitHubSource,
    TerminalGitHubSourceError,
    TransientGitHubSourceError,
)
from app.github_tokens import (
    github_unavailable,
    learn_owner,
    mark_needs_reconnect,
    plaintext,
    token_name,
)
from app.models import GitHubToken, WatchedRepository

router = APIRouter(prefix="/api/v1/github", tags=["github"])

# How one GitHub Token fared in the picker: "unavailable" when GitHub had a
# transient problem (the token stays connected), "needs_reconnect" when
# GitHub rejected the token.
PickerTokenStatus = Literal["ok", "unavailable", "needs_reconnect"]


class AccessibleRepositoryRead(BaseModel):
    github_repo_id: int
    full_name: str
    private: bool
    github_token_id: int
    watched_repository_id: int | None


class PickerTokenRead(BaseModel):
    """How one GitHub Token fared in the picker. A token that validated
    but reads no repositories usually belongs to an organisation that has
    not yet allowed or approved fine-grained tokens."""

    id: int
    owner_login: str | None
    status: PickerTokenStatus
    repository_count: int


class RepositoryPickerRead(BaseModel):
    repositories: list[AccessibleRepositoryRead]
    tokens: list[PickerTokenRead]


class WatchedRepositoryCreate(BaseModel):
    github_token_id: int
    github_repo_id: int


class WatchedRepositoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    github_token_id: int
    github_repo_id: int
    full_name: str
    private: bool
    created_at: datetime


async def _readable_repositories(request: Request, token: GitHubToken) -> list[GitHubRepository]:
    github_source: GitHubSource = request.app.state.github_source
    return await github_source.list_accessible_repositories(plaintext(request, token))


@router.get("/repositories")
async def list_accessible_repositories(
    request: Request, session: SessionDep
) -> RepositoryPickerRead:
    """The Watched Repositories picker: every repository the User's GitHub
    Tokens can read, each marked with its Watched Repository if any."""
    watched = {row.github_repo_id: row for row in await session.scalars(select(WatchedRepository))}
    # Keyed by GitHub's repository id: a repository readable through two
    # tokens is offered once, through the first token that reads it.
    repositories: dict[int, AccessibleRepositoryRead] = {}
    tokens: list[PickerTokenRead] = []
    for token in (await session.scalars(select(GitHubToken).order_by(GitHubToken.id))).all():
        status: PickerTokenStatus = "ok"
        readable: list[GitHubRepository] = []
        # One token's failure never hides another token's repositories.
        try:
            readable = await _readable_repositories(request, token)
        except TransientGitHubSourceError:
            status = "unavailable"
        except TerminalGitHubSourceError:
            status = "needs_reconnect"
            await mark_needs_reconnect(session, token)
        if readable and token.owner_login is None:
            await learn_owner(request, session, token)
        tokens.append(
            PickerTokenRead(
                id=token.id,
                owner_login=token.owner_login,
                status=status,
                repository_count=len(readable),
            )
        )
        for repo in readable:
            existing = watched.get(repo.github_id)
            repositories.setdefault(
                repo.github_id,
                AccessibleRepositoryRead(
                    github_repo_id=repo.github_id,
                    full_name=repo.full_name,
                    private=repo.private,
                    github_token_id=existing.github_token_id if existing else token.id,
                    watched_repository_id=existing.id if existing else None,
                ),
            )
    return RepositoryPickerRead(repositories=list(repositories.values()), tokens=tokens)


@router.get("/watched-repositories")
async def list_watched_repositories(session: SessionDep) -> list[WatchedRepositoryRead]:
    rows = await session.scalars(
        select(WatchedRepository).order_by(func.lower(WatchedRepository.full_name))
    )
    return [WatchedRepositoryRead.model_validate(row) for row in rows]


@router.post("/watched-repositories", status_code=201)
async def watch_repository(
    payload: WatchedRepositoryCreate, request: Request, session: SessionDep
) -> WatchedRepositoryRead:
    token = await session.get(GitHubToken, payload.github_token_id)
    if token is None:
        raise NotFoundError(f"GitHub Token {payload.github_token_id} not found")
    already = await session.scalar(
        select(WatchedRepository).where(WatchedRepository.github_repo_id == payload.github_repo_id)
    )
    if already is not None:
        raise APIError(
            409,
            "github_repository_already_watched",
            f"You already watch {already.full_name}.",
        )
    try:
        readable = await _readable_repositories(request, token)
    except TerminalGitHubSourceError:
        await mark_needs_reconnect(session, token)
        raise APIError(
            422,
            "github_token_rejected",
            f"GitHub rejected {token_name(token)}: it may be expired or revoked. "
            "Reconnect it in Settings.",
        ) from None
    except TransientGitHubSourceError:
        raise github_unavailable(
            "GitHub could not be reached. Nothing was saved; try again in a moment."
        ) from None
    repo = next((r for r in readable if r.github_id == payload.github_repo_id), None)
    if repo is None:
        raise APIError(
            422,
            "github_repository_not_readable",
            f"{token_name(token).capitalize()} cannot read that repository.",
        )
    row = WatchedRepository(
        github_token_id=token.id,
        github_repo_id=repo.github_id,
        full_name=repo.full_name,
        private=repo.private,
    )
    session.add(row)
    await session.commit()
    return WatchedRepositoryRead.model_validate(row)


@router.delete("/watched-repositories/{watched_id}", status_code=204)
async def unwatch_repository(watched_id: int, session: SessionDep) -> None:
    row = await session.get(WatchedRepository, watched_id)
    if row is None:
        raise NotFoundError(f"Watched Repository {watched_id} not found")
    await session.delete(row)
    await session.commit()
