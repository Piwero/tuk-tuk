"""GitHubSource — the single boundary to GitHub (spec #576, ADR 0020).

The GitHub counterpart of app.calendar_source: injected through the
application factory (see app.main.create_app), with the real adapter
(app.github_adapter) as the default, so every backend test can run against
a fake and never touch the network. Issue #578 added *identify token* and
issue #581 *list accessible repositories*, issue #579 *list open pull
requests*; a later ticket adds the open GitHub Issue read.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

GitHubOwnerKind = Literal["user", "organization"]
# Only fine-grained personal access tokens are accepted (ADR 0020); the
# other kinds exist so a caller can say *why* a token was refused.
GitHubTokenType = Literal["fine_grained", "classic", "other"]


@dataclass(frozen=True)
class GitHubTokenIdentity:
    """What GitHub says a token is. `owner_login`/`owner_kind` name the one
    resource owner a fine-grained token grants access to: the User
    themselves or one organisation. `expires_at` is absent for a token
    created without an expiry."""

    owner_login: str
    owner_kind: GitHubOwnerKind
    token_type: GitHubTokenType
    expires_at: datetime | None


@dataclass(frozen=True)
class GitHubRepository:
    """A repository a GitHub Token can read. `github_id` is GitHub's own,
    stable repository id; `full_name` (`owner/name`) changes on a rename
    or transfer, so it is cosmetic."""

    github_id: int
    full_name: str
    private: bool


@dataclass(frozen=True)
class GitHubLabel:
    name: str
    # GitHub's six-digit hex colour, without the leading "#".
    color: str


# The review decision of a Pull Request: "pending" covers both a review
# GitHub still requires and a repository that requires none yet has none.
GitHubReviewDecision = Literal["approved", "changes_requested", "pending"]
# The latest CI rollup on a Pull Request's head commit, absent when the
# repository runs no checks.
GitHubCiStatus = Literal["pass", "fail", "pending"]


@dataclass(frozen=True)
class GitHubPullRequest:
    """One open Pull Request as GitHub reports it. `author_login` is absent
    for an author whose GitHub account was deleted. `review_requested` is
    whether a review is currently requested from the viewer (the GitHub
    user the token acts as) in person; a request to one of their teams does
    not count."""

    number: int
    title: str
    url: str
    author_login: str | None
    author_is_bot: bool
    created_at: datetime
    updated_at: datetime
    is_draft: bool
    labels: tuple[GitHubLabel, ...]
    review_decision: GitHubReviewDecision
    ci_status: GitHubCiStatus | None
    review_requested: bool


@dataclass(frozen=True)
class RepositoryPullRequests:
    """The open Pull Requests of one repository, most recently updated
    first. `pull_requests` holds at most 100 of them; `total_count` is how
    many are open in all. `full_name` and `url` are as GitHub reports them
    now, after any rename."""

    github_id: int
    full_name: str
    url: str
    total_count: int
    pull_requests: tuple[GitHubPullRequest, ...]


@dataclass(frozen=True)
class OpenPullRequests:
    """One token's answer to *list open pull requests*. `viewer_login` is
    the GitHub user the token acts as — its creator, also for a token whose
    resource owner is an organisation. A repository the token can no longer
    read is absent from `repositories`."""

    viewer_login: str
    repositories: tuple[RepositoryPullRequests, ...]


class GitHubSourceError(Exception):
    """Base for any failure talking to GitHub. Never raised directly —
    callers catch one of the two subclasses below, which is deliberately
    exhaustive (as for the calendar source, ADR 0007)."""


class TransientGitHubSourceError(GitHubSourceError):
    """A rate limit, a server error or network trouble: GitHub is
    temporarily unavailable but the token is still good. Safe to retry; a
    GitHub Token stays connected."""


class TerminalGitHubSourceError(GitHubSourceError):
    """GitHub rejected the token itself (401): it is revoked, expired or
    was never valid. Retrying can never succeed on its own."""


class GitHubSource(Protocol):
    async def identify_token(self, token: str) -> GitHubTokenIdentity:
        """Ask GitHub who `token` belongs to, what kind of token it is and
        when it expires."""
        ...

    async def list_accessible_repositories(self, token: str) -> list[GitHubRepository]:
        """Every repository `token` can read, for the Watched Repositories
        picker."""
        ...

    async def list_open_pull_requests(
        self, token: str, repositories: list[GitHubRepository]
    ) -> OpenPullRequests:
        """The open Pull Requests of each of `repositories`, all read
        through `token` in one round trip: at most 100 most recently updated
        per repository, plus each repository's total open count."""
        ...
