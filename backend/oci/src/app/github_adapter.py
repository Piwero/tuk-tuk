"""The concrete GitHubSource adapter — the only module that knows GitHub's
wire format (spec #576, ADR 0020). github.com only; no Enterprise hosts.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

import httpx

from app.github_source import (
    FINE_GRAINED_PREFIX,
    GitHubCiStatus,
    GitHubIssue,
    GitHubLabel,
    GitHubOwner,
    GitHubOwnerKind,
    GitHubPullRequest,
    GitHubRepository,
    GitHubReviewDecision,
    GitHubTokenIdentity,
    GitHubTokenType,
    OpenIssues,
    OpenPullRequests,
    RepositoryIssues,
    RepositoryPullRequests,
    TerminalGitHubSourceError,
    TransientGitHubSourceError,
)

API_URL = "https://api.github.com"
# Sent by GitHub on every response to a request made with a personal
# access token that expires, e.g. "2027-02-01 08:09:11 UTC" (fine-grained
# tokens have also been seen with a numeric offset).
EXPIRY_HEADER = "github-authentication-token-expiration"
_TIMEOUT = httpx.Timeout(10.0)


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _raise_for_error_response(response: httpx.Response, action: str) -> None:
    """Only a 401 means the token itself is no good. Everything else —
    rate limits (GitHub answers them with 403 or 429), server errors, and
    any other refusal — is treated as transient, so a blip never marks a
    GitHub Token as needing reconnection (spec #576)."""
    if response.status_code == 401:
        raise TerminalGitHubSourceError(f"GitHub rejected the token {action}")
    raise TransientGitHubSourceError(f"GitHub returned {response.status_code} {action}")


def _parse_expiry(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.strip()
    if normalized.endswith(" UTC"):
        normalized = normalized[: -len(" UTC")] + " +0000"
    try:
        return datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S %z").astimezone(UTC)
    except ValueError:
        return None


def _token_type(token: str, response: httpx.Response) -> GitHubTokenType:
    # Classic tokens are granted OAuth scopes, which GitHub echoes back;
    # fine-grained tokens have permissions instead and get no such header.
    if "X-OAuth-Scopes" in response.headers:
        return "classic"
    return "fine_grained" if token.startswith(FINE_GRAINED_PREFIX) else "other"


_OWNER_KINDS: dict[str, GitHubOwnerKind] = {"User": "user", "Organization": "organization"}


def _sole_owner(repos: list[dict[str, Any]]) -> GitHubOwner | None:
    owners = {
        GitHubOwner(login=str(owner["login"]), kind=_OWNER_KINDS[owner["type"]])
        for owner in (repo.get("owner") or {} for repo in repos)
        if owner.get("type") in _OWNER_KINDS and owner.get("login")
    }
    return owners.pop() if len(owners) == 1 else None


def _resource_owner(repos: list[dict[str, Any]]) -> GitHubOwner | None:
    """A fine-grained token has exactly one resource owner, but GitHub
    names it nowhere — not `/user` (the token's creator), not a header. A
    private repository the token reads can only be the owner's, so the one
    owner of those is it; failing any, the one owner of every repository it
    reads. Every token also reads all public repositories, so public ones
    of several owners prove nothing, and a token that reads no repository
    yet (an organisation's, before it allows or approves fine-grained
    tokens) has no owner GitHub will tell (ADR 0020)."""
    private = [repo for repo in repos if repo.get("private")]
    return _sole_owner(private) if private else _sole_owner(repos)


# At most this many items per repository (spec #576); GitHub's own maximum
# page size, so one query per token is enough.
ITEMS_PER_REPOSITORY = 100

# One Pull Request's fields. Inner connections stay small: GitHub limits a
# query to 500,000 nodes, multiplied out across every alias.
_PULL_REQUEST_FIELDS = """
  number title url isDraft createdAt updatedAt reviewDecision
  author { __typename login }
  labels(first: 20) { nodes { name color } }
  reviewRequests(first: 20) {
    nodes { requestedReviewer { __typename ... on User { login } } }
  }
  statusCheckRollup { state }
"""

_REVIEW_DECISIONS: dict[str, GitHubReviewDecision] = {
    "APPROVED": "approved",
    "CHANGES_REQUESTED": "changes_requested",
}

_CI_STATUSES: dict[str, GitHubCiStatus] = {
    "SUCCESS": "pass",
    "FAILURE": "fail",
    "ERROR": "fail",
    "PENDING": "pending",
    "EXPECTED": "pending",
}


# One GitHub Issue's fields. `__typename` lets the adapter prove no Pull
# Request slipped in: GitHub counts Pull Requests as issues in its REST
# listing, though the GraphQL `issues` connection holds Issues only.
_ISSUE_FIELDS = """
  __typename number title url createdAt updatedAt
  author { __typename login }
  assignees(first: 10) { nodes { login } }
  labels(first: 20) { nodes { name color } }
  comments { totalCount }
"""

# The repository connection each read lists, with its node fields.
_PULL_REQUESTS = ("pullRequests", _PULL_REQUEST_FIELDS)
_ISSUES = ("issues", _ISSUE_FIELDS)


def _open_items_query(count: int, connection: str, fields: str) -> str:
    """One alias per repository (`r0`, `r1`, ...) listing the open items of
    `connection`, most recently updated first. Each repository's owner and
    name are passed as variables so no name is spliced into the query."""
    variables = ", ".join(f"$owner{i}: String!, $name{i}: String!" for i in range(count))
    aliases = "\n".join(
        f"""  r{i}: repository(owner: $owner{i}, name: $name{i}) {{
    databaseId nameWithOwner url
    {connection}(
      states: OPEN, first: {ITEMS_PER_REPOSITORY}, orderBy: {{field: UPDATED_AT, direction: DESC}}
    ) {{
      totalCount
      nodes {{ {fields} }}
    }}
  }}"""
        for i in range(count)
    )
    return f"query({variables}) {{\n  viewer {{ login }}\n{aliases}\n}}"


def _instant(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(UTC)


def _is_bot(author: dict[str, Any]) -> bool:
    # GraphQL names an app's account "dependabot" with type Bot; REST and
    # some older accounts show the "[bot]" suffix instead.
    return author.get("__typename") == "Bot" or str(author.get("login", "")).endswith("[bot]")


def _labels(node: dict[str, Any]) -> tuple[GitHubLabel, ...]:
    return tuple(
        GitHubLabel(name=str(label["name"]), color=str(label["color"]))
        for label in (node.get("labels") or {}).get("nodes") or []
    )


def _review_requested_from(node: dict[str, Any], viewer_login: str) -> bool:
    for request in (node.get("reviewRequests") or {}).get("nodes") or []:
        reviewer = (request or {}).get("requestedReviewer") or {}
        if (
            reviewer.get("__typename") == "User"
            and str(reviewer.get("login", "")).lower() == viewer_login.lower()
        ):
            return True
    return False


def _pull_request(node: dict[str, Any], viewer_login: str) -> GitHubPullRequest:
    author = node.get("author")
    rollup = node.get("statusCheckRollup")
    return GitHubPullRequest(
        number=int(node["number"]),
        title=str(node["title"]),
        url=str(node["url"]),
        author_login=str(author["login"]) if author else None,
        author_is_bot=_is_bot(author) if author else False,
        created_at=_instant(node["createdAt"]),
        updated_at=_instant(node["updatedAt"]),
        is_draft=bool(node["isDraft"]),
        labels=_labels(node),
        review_decision=_REVIEW_DECISIONS.get(node.get("reviewDecision") or "", "pending"),
        ci_status=_CI_STATUSES.get(rollup["state"], "pending") if rollup else None,
        review_requested=_review_requested_from(node, viewer_login),
    )


def _issue(node: dict[str, Any]) -> GitHubIssue:
    author = node.get("author")
    return GitHubIssue(
        number=int(node["number"]),
        title=str(node["title"]),
        url=str(node["url"]),
        author_login=str(author["login"]) if author else None,
        author_is_bot=_is_bot(author) if author else False,
        created_at=_instant(node["createdAt"]),
        updated_at=_instant(node["updatedAt"]),
        assignees=tuple(
            str(user["login"]) for user in (node.get("assignees") or {}).get("nodes") or [] if user
        ),
        labels=_labels(node),
        comment_count=int((node.get("comments") or {}).get("totalCount") or 0),
    )


def _raise_for_graphql_errors(body: dict[str, Any], action: str) -> None:
    """GraphQL reports some failures with HTTP 200. A repository the token
    can no longer read comes back as a NOT_FOUND for that alias alone, and
    the other aliases are still good; anything that left no data at all
    (a rate limit among them) is a transient failure of the whole read."""
    errors = body.get("errors") or []
    if any(error.get("type") == "RATE_LIMITED" for error in errors):
        raise TransientGitHubSourceError(f"GitHub rate-limited {action}")
    if errors and not body.get("data"):
        raise TransientGitHubSourceError(f"GitHub returned errors {action}")


class GitHubApiSource:
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        # Test-only seam (httpx.MockTransport); production passes none.
        self._transport = transport

    @asynccontextmanager
    async def _client(self, token: str, action: str) -> AsyncIterator[httpx.AsyncClient]:
        try:
            async with httpx.AsyncClient(
                base_url=API_URL,
                headers=_headers(token),
                timeout=_TIMEOUT,
                transport=self._transport,
            ) as client:
                yield client
        except httpx.HTTPError as exc:  # network-level failure: always transient
            raise TransientGitHubSourceError(f"Network error {action}: {exc}") from exc

    async def identify_token(self, token: str) -> GitHubTokenIdentity:
        action = "identifying the token"
        async with self._client(token, action) as client:
            user = await client.get("/user")
            if user.status_code != 200:
                _raise_for_error_response(user, action)
            repos = await client.get("/user/repos", params={"per_page": 100})
            if repos.status_code != 200:
                _raise_for_error_response(repos, action)
        return GitHubTokenIdentity(
            owner=_resource_owner(repos.json()),
            token_type=_token_type(token, user),
            expires_at=_parse_expiry(user.headers.get(EXPIRY_HEADER)),
        )

    async def list_accessible_repositories(self, token: str) -> list[GitHubRepository]:
        action = "listing repositories"
        repositories: list[GitHubRepository] = []
        async with self._client(token, action) as client:
            url: str | None = "/user/repos"
            params: dict[str, int] | None = {"per_page": 100}
            while url is not None:
                response = await client.get(url, params=params)
                if response.status_code != 200:
                    _raise_for_error_response(response, action)
                repositories.extend(
                    GitHubRepository(
                        github_id=int(r["id"]),
                        full_name=str(r["full_name"]),
                        private=bool(r["private"]),
                    )
                    for r in response.json()
                )
                # GitHub pages with a Link header whose "next" URL already
                # carries the query string.
                url = response.links.get("next", {}).get("url")
                params = None
        return repositories

    async def _read_open_items(
        self,
        token: str,
        repositories: list[GitHubRepository],
        listing: tuple[str, str],
        action: str,
    ) -> tuple[str, list[tuple[dict[str, Any], dict[str, Any]]]]:
        """One GraphQL round trip listing the open items of `listing` (a
        connection and its node fields) in every repository. Returns the
        viewer's login and, for each repository the token can still read,
        its repository node and that connection."""
        connection, fields = listing
        variables: dict[str, str] = {}
        for i, repo in enumerate(repositories):
            owner, _, name = repo.full_name.partition("/")
            variables[f"owner{i}"] = owner
            variables[f"name{i}"] = name
        async with self._client(token, action) as client:
            response = await client.post(
                "/graphql",
                json={
                    "query": _open_items_query(len(repositories), connection, fields),
                    "variables": variables,
                },
            )
        if response.status_code != 200:
            _raise_for_error_response(response, action)
        body: dict[str, Any] = response.json()
        _raise_for_graphql_errors(body, action)
        data: dict[str, Any] = body["data"]
        readable = [
            (node, node[connection])
            for node in (data.get(f"r{i}") for i in range(len(repositories)))
            if node is not None  # no longer readable through this token
        ]
        return str(data["viewer"]["login"]), readable

    async def list_open_pull_requests(
        self, token: str, repositories: list[GitHubRepository]
    ) -> OpenPullRequests:
        viewer_login, readable = await self._read_open_items(
            token, repositories, _PULL_REQUESTS, "listing open pull requests"
        )
        return OpenPullRequests(
            viewer_login=viewer_login,
            repositories=tuple(
                RepositoryPullRequests(
                    github_id=int(node["databaseId"]),
                    full_name=str(node["nameWithOwner"]),
                    url=str(node["url"]),
                    total_count=int(connection["totalCount"]),
                    pull_requests=tuple(
                        _pull_request(pr, viewer_login) for pr in connection["nodes"] or [] if pr
                    ),
                )
                for node, connection in readable
            ),
        )

    async def list_open_issues(
        self, token: str, repositories: list[GitHubRepository]
    ) -> OpenIssues:
        _, readable = await self._read_open_items(
            token, repositories, _ISSUES, "listing open issues"
        )
        return OpenIssues(
            repositories=tuple(
                RepositoryIssues(
                    github_id=int(node["databaseId"]),
                    full_name=str(node["nameWithOwner"]),
                    url=str(node["url"]),
                    total_count=int(connection["totalCount"]),
                    issues=tuple(
                        _issue(issue)
                        for issue in connection["nodes"] or []
                        if issue and issue.get("__typename") == "Issue"
                    ),
                )
                for node, connection in readable
            )
        )
