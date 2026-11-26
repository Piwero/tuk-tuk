"""GitHubSource — the single boundary to GitHub (spec #576, ADR 0020).

The GitHub counterpart of app.calendar_source: injected through the
application factory (see app.main.create_app), with the real adapter
(app.github_adapter) as the default, so every backend test can run against
a fake and never touch the network. Issue #578 added *identify token* and
issue #581 *list accessible repositories*; later tickets add the open Pull
Request and GitHub Issue reads.
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
