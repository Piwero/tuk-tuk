"""The concrete GitHubSource adapter — the only module that knows GitHub's
wire format (spec #576, ADR 0020). github.com only; no Enterprise hosts.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

import httpx

from app.github_source import (
    GitHubCiStatus,
    GitHubLabel,
    GitHubOwnerKind,
    GitHubPullRequest,
    GitHubRepository,
    GitHubReviewDecision,
    GitHubTokenIdentity,
    GitHubTokenType,
    OpenPullRequests,
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
    return "fine_grained" if token.startswith("github_pat_") else "other"


def _resource_owner(user_login: str, repos: list[dict[str, Any]]) -> tuple[str, GitHubOwnerKind]:
    """A fine-grained token has exactly one resource owner, but GitHub has
    no endpoint naming it. The repositories it can read all belong to that
    owner, so an organisation among them is the owner; otherwise (including
    a token that can read no repository yet) it is the token's own User."""
    for repo in repos:
        owner = repo.get("owner") or {}
        if owner.get("type") == "Organization" and isinstance(owner.get("login"), str):
            return owner["login"], "organization"
    return user_login, "user"


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


def _pull_requests_query(count: int) -> str:
    """One alias per repository (`r0`, `r1`, ...), its owner and name
    passed as variables so no repository name is spliced into the query."""
    variables = ", ".join(f"$owner{i}: String!, $name{i}: String!" for i in range(count))
    aliases = "\n".join(
        f"""  r{i}: repository(owner: $owner{i}, name: $name{i}) {{
    databaseId nameWithOwner url
    pullRequests(
      states: OPEN, first: {ITEMS_PER_REPOSITORY}, orderBy: {{field: UPDATED_AT, direction: DESC}}
    ) {{
      totalCount
      nodes {{ {_PULL_REQUEST_FIELDS} }}
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
        labels=tuple(
            GitHubLabel(name=str(label["name"]), color=str(label["color"]))
            for label in (node.get("labels") or {}).get("nodes") or []
        ),
        review_decision=_REVIEW_DECISIONS.get(node.get("reviewDecision") or "", "pending"),
        ci_status=_CI_STATUSES.get(rollup["state"], "pending") if rollup else None,
        review_requested=_review_requested_from(node, viewer_login),
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
        owner_login, owner_kind = _resource_owner(user.json()["login"], repos.json())
        return GitHubTokenIdentity(
            owner_login=owner_login,
            owner_kind=owner_kind,
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

    async def list_open_pull_requests(
        self, token: str, repositories: list[GitHubRepository]
    ) -> OpenPullRequests:
        action = "listing open pull requests"
        variables: dict[str, str] = {}
        for i, repo in enumerate(repositories):
            owner, _, name = repo.full_name.partition("/")
            variables[f"owner{i}"] = owner
            variables[f"name{i}"] = name
        async with self._client(token, action) as client:
            response = await client.post(
                "/graphql",
                json={"query": _pull_requests_query(len(repositories)), "variables": variables},
            )
        if response.status_code != 200:
            _raise_for_error_response(response, action)
        body: dict[str, Any] = response.json()
        _raise_for_graphql_errors(body, action)
        data: dict[str, Any] = body["data"]
        viewer_login = str(data["viewer"]["login"])
        results: list[RepositoryPullRequests] = []
        for i in range(len(repositories)):
            node = data.get(f"r{i}")
            if node is None:  # no longer readable through this token
                continue
            connection = node["pullRequests"]
            results.append(
                RepositoryPullRequests(
                    github_id=int(node["databaseId"]),
                    full_name=str(node["nameWithOwner"]),
                    url=str(node["url"]),
                    total_count=int(connection["totalCount"]),
                    pull_requests=tuple(
                        _pull_request(pr, viewer_login) for pr in connection["nodes"] or [] if pr
                    ),
                )
            )
        return OpenPullRequests(viewer_login=viewer_login, repositories=tuple(results))
