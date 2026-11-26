"""The concrete GitHubSource adapter — the only module that knows GitHub's
wire format (spec #576, ADR 0020). github.com only; no Enterprise hosts.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

import httpx

from app.github_source import (
    GitHubOwnerKind,
    GitHubRepository,
    GitHubTokenIdentity,
    GitHubTokenType,
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
