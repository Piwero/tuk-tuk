"""GitHub view reads: open Pull Requests (issue #579) and open GitHub Issues
(issue #582) — spec #576, ADR 0020.

Every read goes to GitHub, one round trip per GitHub Token, and nothing it
returns is ever stored (ADR 0006). Grouping, sorting, the per-repository
cap and bot flagging happen here, so every client sees the same answer.

Both reads share `_read_each_token` (one round trip per GitHub Token, with
its status) and `_repository_read` (the per-repository overflow). A token
GitHub rejects is marked as needing reconnection there (issue #584).
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, field_serializer
from sqlalchemy import select

from app.crypto import decrypt_credential
from app.db import SessionDep
from app.github_cache import GitHubReadCache
from app.github_source import (
    GitHubIssue,
    GitHubPullRequest,
    GitHubRepository,
    GitHubSource,
    OpenIssues,
    OpenPullRequests,
    RepositoryIssues,
    RepositoryPullRequests,
    TerminalGitHubSourceError,
    TransientGitHubSourceError,
)
from app.models import GitHubToken, WatchedRepository
from app.routers.v1.github import expires_soon
from app.schemas import utc_z
from app.users import current_user_id

router = APIRouter(prefix="/api/v1/github", tags=["github"])

Relationship = Literal["review_requested", "mine", "other"]
# `stale`: GitHub could not be reached, so the token's items are its last
# result from under 10 minutes ago.
TokenReadStatus = Literal["ok", "stale", "unavailable", "needs_reconnect"]


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


class IssueRead(BaseModel):
    watched_repository_id: int
    repository: str
    number: int
    title: str
    url: str
    # Absent for an author whose GitHub account was deleted.
    author: str | None
    author_is_bot: bool
    assignees: list[str]
    created_at: datetime
    updated_at: datetime
    labels: list[GitHubLabelRead]
    comment_count: int

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
    # So the GitHub view can warn before a token expires (issue #584).
    expires_at: datetime | None
    expires_soon: bool

    @field_serializer("expires_at")
    def _serialize_expires_at(self, value: datetime | None) -> str | None:
        return None if value is None else utc_z(value)

    @classmethod
    def of(
        cls, token: GitHubToken, status: TokenReadStatus, now: datetime
    ) -> "TokenReadStatusRead":
        return cls(
            id=token.id,
            owner_login=token.owner_login,
            status=status,
            expires_at=token.expires_at,
            expires_soon=expires_soon(token.expires_at, now),
        )


class _GitHubViewRead(BaseModel):
    """What every GitHub view read carries besides its items."""

    repositories: list[RepositoryReadRead]
    tokens: list[TokenReadStatusRead]
    fetched_at: datetime
    # True when GitHub could not be reached for some GitHub Token and its
    # items are that token's last result, fetched at `fetched_at`.
    stale: bool

    @field_serializer("fetched_at")
    def _serialize_fetched_at(self, value: datetime) -> str:
        return utc_z(value)


class PullRequestsRead(_GitHubViewRead):
    items: list[PullRequestRead]


class IssuesRead(_GitHubViewRead):
    items: list[IssueRead]


async def _watched_by_token(
    session: SessionDep,
) -> list[tuple[GitHubToken, list[WatchedRepository]]]:
    """The User's GitHub Tokens that have Watched Repositories, each with
    the repositories read through it."""
    watched = (await session.scalars(select(WatchedRepository))).all()
    tokens = (await session.scalars(select(GitHubToken).order_by(GitHubToken.id))).all()
    groups = [(token, [w for w in watched if w.github_token_id == token.id]) for token in tokens]
    return [(token, repos) for token, repos in groups if repos]


# One GitHub source operation over a batch of repositories under one token.
type SourceRead[Result] = Callable[[GitHubSource, str, list[GitHubRepository]], Awaitable[Result]]


@dataclass
class _TokenReads[Result]:
    """What one GitHub view read got from each GitHub Token."""

    # Each token's result with its Watched Repositories by GitHub
    # repository id, for every token that has one to show.
    results: list[tuple[dict[int, WatchedRepository], Result]]
    statuses: list[TokenReadStatusRead]
    # When the oldest result shown was fetched from GitHub.
    fetched_at: datetime
    # Whether any result shown is a stale one.
    stale: bool = False


async def _read_each_token[Result](
    request: Request,
    session: SessionDep,
    source_read: SourceRead[Result],
    cache: GitHubReadCache[Result],
    *,
    refresh: bool,
) -> _TokenReads[Result]:
    """Runs `source_read` once per GitHub Token, over the Watched
    Repositories read through it, unless `cache` holds that token's read
    from under a minute ago and this is no Refresh. One token's failure
    never hides another's results."""
    github_source: GitHubSource = request.app.state.github_source
    key = request.app.state.settings.app_master_key
    owner_id = current_user_id(request)
    now = request.app.state.clock()
    reads = _TokenReads[Result](results=[], statuses=[], fetched_at=now)
    for token, watched in await _watched_by_token(session):
        status: TokenReadStatus = "ok"
        shown = None if refresh else cache.fresh(owner_id, token.id)
        if shown is None:
            try:
                result = await source_read(
                    github_source,
                    decrypt_credential(token.encrypted_token, key=key),
                    [
                        GitHubRepository(
                            github_id=w.github_repo_id, full_name=w.full_name, private=w.private
                        )
                        for w in watched
                    ],
                )
            except TransientGitHubSourceError:
                # A blip at GitHub: show the last result if it is recent
                # enough, labelled stale (spec #576).
                shown = cache.stale(owner_id, token.id)
                status = "unavailable" if shown is None else "stale"
            except TerminalGitHubSourceError:
                # GitHub rejected the token itself (issue #584, ADR 0007); a
                # transient failure never touches `connection_state`.
                status = "needs_reconnect"
                token.connection_state = "needs_reconnect"
                await session.commit()
            else:
                shown = cache.store(owner_id, token.id, result)
        if shown is not None:
            reads.results.append(({w.github_repo_id: w for w in watched}, shown.result))
            reads.fetched_at = min(reads.fetched_at, shown.fetched_at)
            reads.stale = reads.stale or status == "stale"
        reads.statuses.append(TokenReadStatusRead.of(token, status, now))
    return reads


def _repository_read(
    row: WatchedRepository,
    repo: RepositoryPullRequests | RepositoryIssues,
    shown: int,
    list_path: Literal["pulls", "issues"],
) -> RepositoryReadRead:
    # The source returns at most 100 per repository (spec #576); the rest
    # are a "N more on GitHub" link to the repository's own list.
    return RepositoryReadRead(
        watched_repository_id=row.id,
        full_name=repo.full_name,
        total_count=repo.total_count,
        overflow_count=max(repo.total_count - shown, 0),
        overflow_url=f"{repo.url}/{list_path}",
    )


def _labels(item: GitHubPullRequest | GitHubIssue) -> list[GitHubLabelRead]:
    return [GitHubLabelRead(name=label.name, color=label.color) for label in item.labels]


def _relationship(pr: GitHubPullRequest, viewer_login: str) -> Relationship:
    # A review requested from the User outranks having written it.
    if pr.review_requested:
        return "review_requested"
    if pr.author_login is not None and pr.author_login.lower() == viewer_login.lower():
        return "mine"
    return "other"


# Refresh: read from GitHub now, bypassing (and replacing) the cache.
RefreshQuery = Annotated[bool, Query()]

_GROUP_ORDER: dict[Relationship, int] = {"review_requested": 0, "mine": 1, "other": 2}


async def _open_pull_requests(
    source: GitHubSource, token: str, repositories: list[GitHubRepository]
) -> OpenPullRequests:
    return await source.list_open_pull_requests(token, repositories)


async def _open_issues(
    source: GitHubSource, token: str, repositories: list[GitHubRepository]
) -> OpenIssues:
    return await source.list_open_issues(token, repositories)


@router.get("/pull-requests")
async def list_pull_requests(
    request: Request, session: SessionDep, refresh: RefreshQuery = False
) -> PullRequestsRead:
    """The open Pull Requests of every Watched Repository, grouped by the
    User's relationship to them (Review requested, then Mine, then Others)
    and most recently updated first within each group."""
    reads = await _read_each_token(
        request,
        session,
        _open_pull_requests,
        request.app.state.github_pull_request_cache,
        refresh=refresh,
    )
    items: list[PullRequestRead] = []
    repositories: list[RepositoryReadRead] = []
    for by_github_id, result in reads.results:
        for repo in result.repositories:
            row = by_github_id.get(repo.github_id)
            if row is None:
                continue
            repositories.append(_repository_read(row, repo, len(repo.pull_requests), "pulls"))
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
                    labels=_labels(pr),
                    is_draft=pr.is_draft,
                    review_decision=pr.review_decision,
                    ci_status=pr.ci_status,
                    relationship=_relationship(pr, result.viewer_login),
                )
                for pr in repo.pull_requests
            )
    items.sort(key=lambda item: item.updated_at, reverse=True)
    items.sort(key=lambda item: _GROUP_ORDER[item.relationship])
    return PullRequestsRead(
        items=items,
        repositories=repositories,
        tokens=reads.statuses,
        fetched_at=reads.fetched_at,
        stale=reads.stale,
    )


@router.get("/issues")
async def list_issues(
    request: Request, session: SessionDep, refresh: RefreshQuery = False
) -> IssuesRead:
    """The open GitHub Issues of every Watched Repository, most recently
    updated first. Pull Requests are never among them."""
    reads = await _read_each_token(
        request,
        session,
        _open_issues,
        request.app.state.github_issue_cache,
        refresh=refresh,
    )
    items: list[IssueRead] = []
    repositories: list[RepositoryReadRead] = []
    for by_github_id, result in reads.results:
        for repo in result.repositories:
            row = by_github_id.get(repo.github_id)
            if row is None:
                continue
            repositories.append(_repository_read(row, repo, len(repo.issues), "issues"))
            items.extend(
                IssueRead(
                    watched_repository_id=row.id,
                    repository=repo.full_name,
                    number=issue.number,
                    title=issue.title,
                    url=issue.url,
                    author=issue.author_login,
                    author_is_bot=issue.author_is_bot,
                    assignees=list(issue.assignees),
                    created_at=issue.created_at,
                    updated_at=issue.updated_at,
                    labels=_labels(issue),
                    comment_count=issue.comment_count,
                )
                for issue in repo.issues
            )
    items.sort(key=lambda item: item.updated_at, reverse=True)
    return IssuesRead(
        items=items,
        repositories=repositories,
        tokens=reads.statuses,
        fetched_at=reads.fetched_at,
        stale=reads.stale,
    )
