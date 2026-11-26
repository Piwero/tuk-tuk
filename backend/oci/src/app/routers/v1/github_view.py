"""GitHub view reads: open Pull Requests (issue #579) — spec #576, ADR 0020.

Every read goes to GitHub, one round trip per GitHub Token, and nothing it
returns is ever stored (ADR 0006). Grouping, sorting, the per-repository
cap and bot flagging happen here, so every client sees the same answer.

The open GitHub Issues read (#582) sits beside the Pull Requests one and
reuses `_watched_by_token`, the per-token status and `RepositoryReadRead`.
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, field_serializer
from sqlalchemy import select

from app.crypto import decrypt_credential
from app.db import SessionDep
from app.github_source import (
    GitHubPullRequest,
    GitHubRepository,
    GitHubSource,
    TerminalGitHubSourceError,
    TransientGitHubSourceError,
)
from app.models import GitHubToken, WatchedRepository
from app.schemas import utc_z

router = APIRouter(prefix="/api/v1/github", tags=["github"])

Relationship = Literal["review_requested", "mine", "other"]
TokenReadStatus = Literal["ok", "unavailable", "needs_reconnect"]


class GitHubLabelRead(BaseModel):
    name: str
    color: str


class PullRequestRead(BaseModel):
    watched_repository_id: int
    repository: str
    number: int
    title: str
    url: str
    # Absent for an author whose GitHub account was deleted.
    author: str | None
    author_is_bot: bool
    created_at: datetime
    updated_at: datetime
    labels: list[GitHubLabelRead]
    is_draft: bool
    review_decision: Literal["approved", "changes_requested", "pending"]
    ci_status: Literal["pass", "fail", "pending"] | None
    relationship: Relationship

    @field_serializer("created_at", "updated_at")
    def _serialize_instants(self, value: datetime) -> str:
        return utc_z(value)


class RepositoryReadRead(BaseModel):
    """How much of one Watched Repository a read shows: `overflow_count`
    more open items exist on GitHub, listed at `overflow_url`."""

    watched_repository_id: int
    full_name: str
    total_count: int
    overflow_count: int
    overflow_url: str


class TokenReadStatusRead(BaseModel):
    """How one GitHub Token fared in a read, so a failing token can show
    as a banner for that token alone while the others' items render."""

    id: int
    owner_login: str
    status: TokenReadStatus


class PullRequestsRead(BaseModel):
    items: list[PullRequestRead]
    repositories: list[RepositoryReadRead]
    tokens: list[TokenReadStatusRead]
    fetched_at: datetime
    # True when GitHub could not be reached and these items are an earlier
    # result. Always false while every read is live.
    stale: bool

    @field_serializer("fetched_at")
    def _serialize_fetched_at(self, value: datetime) -> str:
        return utc_z(value)


async def _watched_by_token(
    session: SessionDep,
) -> list[tuple[GitHubToken, list[WatchedRepository]]]:
    """The User's GitHub Tokens that have Watched Repositories, each with
    the repositories read through it."""
    watched = (await session.scalars(select(WatchedRepository))).all()
    tokens = (await session.scalars(select(GitHubToken).order_by(GitHubToken.id))).all()
    groups = [(token, [w for w in watched if w.github_token_id == token.id]) for token in tokens]
    return [(token, repos) for token, repos in groups if repos]


def _relationship(pr: GitHubPullRequest, viewer_login: str) -> Relationship:
    # A review requested from the User outranks having written it.
    if pr.review_requested:
        return "review_requested"
    if pr.author_login is not None and pr.author_login.lower() == viewer_login.lower():
        return "mine"
    return "other"


_GROUP_ORDER: dict[Relationship, int] = {"review_requested": 0, "mine": 1, "other": 2}


@router.get("/pull-requests")
async def list_pull_requests(request: Request, session: SessionDep) -> PullRequestsRead:
    """The open Pull Requests of every Watched Repository, grouped by the
    User's relationship to them (Review requested, then Mine, then Others)
    and most recently updated first within each group."""
    github_source: GitHubSource = request.app.state.github_source
    key = request.app.state.settings.app_master_key
    items: list[PullRequestRead] = []
    repositories: list[RepositoryReadRead] = []
    statuses: list[TokenReadStatusRead] = []
    for token, watched in await _watched_by_token(session):
        by_github_id = {w.github_repo_id: w for w in watched}
        status: TokenReadStatus = "ok"
        # One token's failure never hides another token's repositories.
        try:
            result = await github_source.list_open_pull_requests(
                decrypt_credential(token.encrypted_token, key=key),
                [
                    GitHubRepository(
                        github_id=w.github_repo_id, full_name=w.full_name, private=w.private
                    )
                    for w in watched
                ],
            )
        except TransientGitHubSourceError:
            status = "unavailable"
        except TerminalGitHubSourceError:
            status = "needs_reconnect"
        statuses.append(
            TokenReadStatusRead(id=token.id, owner_login=token.owner_login, status=status)
        )
        if status != "ok":
            continue
        for repo in result.repositories:
            row = by_github_id.get(repo.github_id)
            if row is None:
                continue
            # The source returns at most 100 per repository (spec #576);
            # the rest are a "N more on GitHub" link.
            shown = repo.pull_requests
            repositories.append(
                RepositoryReadRead(
                    watched_repository_id=row.id,
                    full_name=repo.full_name,
                    total_count=repo.total_count,
                    overflow_count=max(repo.total_count - len(shown), 0),
                    overflow_url=f"{repo.url}/pulls",
                )
            )
            items.extend(
                PullRequestRead(
                    watched_repository_id=row.id,
                    repository=repo.full_name,
                    number=pr.number,
                    title=pr.title,
                    url=pr.url,
                    author=pr.author_login,
                    author_is_bot=pr.author_is_bot,
                    created_at=pr.created_at,
                    updated_at=pr.updated_at,
                    labels=[GitHubLabelRead(name=lb.name, color=lb.color) for lb in pr.labels],
                    is_draft=pr.is_draft,
                    review_decision=pr.review_decision,
                    ci_status=pr.ci_status,
                    relationship=_relationship(pr, result.viewer_login),
                )
                for pr in shown
            )
    items.sort(key=lambda item: item.updated_at, reverse=True)
    items.sort(key=lambda item: _GROUP_ORDER[item.relationship])
    return PullRequestsRead(
        items=items,
        repositories=repositories,
        tokens=statuses,
        fetched_at=request.app.state.clock(),
        stale=False,
    )
