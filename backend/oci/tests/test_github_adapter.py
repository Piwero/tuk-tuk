"""The real GitHubSource adapter against canned GitHub HTTP responses
(spec #576, seam 3): translation of GitHub's wire format only."""

from collections.abc import Callable
from datetime import UTC, datetime

import httpx
import pytest

from app.github_adapter import GitHubApiSource
from app.github_source import TerminalGitHubSourceError, TransientGitHubSourceError

TOKEN = "github_pat_11AAAAAAA0canned"
EXPIRY_HEADER = "github-authentication-token-expiration"


def adapter(handle: Callable[[httpx.Request], httpx.Response]) -> GitHubApiSource:
    return GitHubApiSource(transport=httpx.MockTransport(handle))


def repo(owner: str, owner_type: str, name: str = "repo") -> dict[str, object]:
    return {
        "id": 1,
        "full_name": f"{owner}/{name}",
        "private": True,
        "owner": {"login": owner, "type": owner_type},
    }


def github(
    *, login: str = "octocat", repos: list[dict[str, object]], headers: dict[str, str] | None = None
) -> Callable[[httpx.Request], httpx.Response]:
    """Answers /user and /user/repos as GitHub would for one token."""

    def handle(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == f"Bearer {TOKEN}"
        if request.url.path == "/user":
            return httpx.Response(200, json={"login": login, "type": "User"}, headers=headers)
        if request.url.path == "/user/repos":
            return httpx.Response(200, json=repos, headers=headers)
        return httpx.Response(404, json={"message": "Not Found"})

    return handle


class TestIdentifyToken:
    async def test_a_token_for_the_users_own_repositories_names_the_user(self) -> None:
        handle = github(repos=[repo("octocat", "User")])

        identity = await adapter(handle).identify_token(TOKEN)

        assert (identity.owner_login, identity.owner_kind) == ("octocat", "user")
        assert identity.token_type == "fine_grained"

    async def test_a_token_for_an_organisations_repositories_names_the_organisation(
        self,
    ) -> None:
        handle = github(repos=[repo("acme", "Organization")])

        identity = await adapter(handle).identify_token(TOKEN)

        assert (identity.owner_login, identity.owner_kind) == ("acme", "organization")

    async def test_a_token_that_reads_no_repositories_yet_names_the_user(self) -> None:
        identity = await adapter(github(repos=[])).identify_token(TOKEN)

        assert (identity.owner_login, identity.owner_kind) == ("octocat", "user")

    async def test_the_expiry_github_reports_is_read(self) -> None:
        handle = github(repos=[], headers={EXPIRY_HEADER: "2027-02-01 08:09:11 UTC"})

        identity = await adapter(handle).identify_token(TOKEN)

        assert identity.expires_at == datetime(2027, 2, 1, 8, 9, 11, tzinfo=UTC)

    async def test_an_expiry_with_an_offset_is_read(self) -> None:
        handle = github(repos=[], headers={EXPIRY_HEADER: "2027-02-01 13:09:11 +0500"})

        identity = await adapter(handle).identify_token(TOKEN)

        assert identity.expires_at == datetime(2027, 2, 1, 8, 9, 11, tzinfo=UTC)

    async def test_a_token_without_an_expiry_has_none(self) -> None:
        identity = await adapter(github(repos=[])).identify_token(TOKEN)

        assert identity.expires_at is None

    async def test_a_token_github_grants_oauth_scopes_to_is_classic(self) -> None:
        handle = github(repos=[], headers={"X-OAuth-Scopes": "repo"})

        identity = await adapter(handle).identify_token(TOKEN)

        assert identity.token_type == "classic"

    async def test_bad_credentials_are_terminal(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"message": "Bad credentials"})

        with pytest.raises(TerminalGitHubSourceError):
            await adapter(handle).identify_token(TOKEN)

    @pytest.mark.parametrize(
        ("status", "headers"),
        [
            (403, {"x-ratelimit-remaining": "0"}),
            (429, {"retry-after": "60"}),
            (500, {}),
            (503, {}),
        ],
        ids=["rate limit", "secondary rate limit", "server error", "unavailable"],
    )
    async def test_rate_limits_and_server_errors_are_transient(
        self, status: int, headers: dict[str, str]
    ) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(status, json={"message": "nope"}, headers=headers)

        with pytest.raises(TransientGitHubSourceError):
            await adapter(handle).identify_token(TOKEN)

    async def test_a_network_failure_is_transient(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("boom", request=request)

        with pytest.raises(TransientGitHubSourceError):
            await adapter(handle).identify_token(TOKEN)
