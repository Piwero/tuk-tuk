"""The real GitHubSource adapter against canned GitHub HTTP responses
(spec #576, seam 3): translation of GitHub's wire format only."""

import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest

from app.github_adapter import GitHubApiSource
from app.github_source import (
    GitHubLabel,
    GitHubRepository,
    TerminalGitHubSourceError,
    TransientGitHubSourceError,
)

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


class TestListAccessibleRepositories:
    async def test_every_page_of_repositories_github_lists_is_read(self) -> None:
        next_page = "https://api.github.com/user/repos?per_page=100&page=2"

        def handle(request: httpx.Request) -> httpx.Response:
            assert request.headers["Authorization"] == f"Bearer {TOKEN}"
            assert request.url.path == "/user/repos"
            if request.url.params.get("page") == "2":
                return httpx.Response(
                    200, json=[{**repo("acme", "Organization", "web"), "id": 2, "private": False}]
                )
            return httpx.Response(
                200,
                json=[repo("acme", "Organization", "api")],
                headers={"Link": f'<{next_page}>; rel="next", <{next_page}>; rel="last"'},
            )

        repositories = await adapter(handle).list_accessible_repositories(TOKEN)

        assert [(r.github_id, r.full_name, r.private) for r in repositories] == [
            (1, "acme/api", True),
            (2, "acme/web", False),
        ]

    async def test_bad_credentials_are_terminal(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"message": "Bad credentials"})

        with pytest.raises(TerminalGitHubSourceError):
            await adapter(handle).list_accessible_repositories(TOKEN)

    async def test_a_rate_limit_is_transient(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(403, json={}, headers={"x-ratelimit-remaining": "0"})

        with pytest.raises(TransientGitHubSourceError):
            await adapter(handle).list_accessible_repositories(TOKEN)

    async def test_a_network_failure_is_transient(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("boom", request=request)

        with pytest.raises(TransientGitHubSourceError):
            await adapter(handle).list_accessible_repositories(TOKEN)


DOTFILES = GitHubRepository(github_id=1, full_name="octocat/dotfiles", private=True)
API = GitHubRepository(github_id=2, full_name="acme/api", private=True)


def pr_node(number: int, **overrides: Any) -> dict[str, Any]:
    """One Pull Request node as GitHub's GraphQL API returns it."""
    node: dict[str, Any] = {
        "number": number,
        "title": f"PR {number}",
        "url": f"https://github.com/octocat/dotfiles/pull/{number}",
        "isDraft": False,
        "createdAt": "2026-11-20T09:00:00Z",
        "updatedAt": "2026-11-21T10:30:00Z",
        "reviewDecision": "REVIEW_REQUIRED",
        "author": {"__typename": "User", "login": "hubot"},
        "labels": {"nodes": []},
        "reviewRequests": {"nodes": []},
        "statusCheckRollup": None,
    }
    return {**node, **overrides}


def repository_node(
    github_id: int, full_name: str, nodes: list[dict[str, Any]], total: int | None = None
) -> dict[str, Any]:
    return {
        "databaseId": github_id,
        "nameWithOwner": full_name,
        "url": f"https://github.com/{full_name}",
        "pullRequests": {"totalCount": len(nodes) if total is None else total, "nodes": nodes},
    }


def graphql(
    data: dict[str, Any], errors: list[dict[str, Any]] | None = None
) -> Callable[[httpx.Request], httpx.Response]:
    """Answers one GraphQL POST with `data`, recording each request."""

    def handle(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/graphql"
        assert request.headers["Authorization"] == f"Bearer {TOKEN}"
        body: dict[str, Any] = {"data": data}
        if errors is not None:
            body["errors"] = errors
        return httpx.Response(200, json=body)

    return handle


def one_pr(node: dict[str, Any]) -> dict[str, Any]:
    return {
        "viewer": {"login": "octocat"},
        "r0": repository_node(1, "octocat/dotfiles", [node]),
    }


class TestListOpenPullRequests:
    async def test_all_repositories_are_read_in_one_query_with_an_alias_each(self) -> None:
        requests: list[dict[str, Any]] = []
        answer = graphql(
            {
                "viewer": {"login": "octocat"},
                "r0": repository_node(1, "octocat/dotfiles", [pr_node(1)]),
                "r1": repository_node(2, "acme/api", [pr_node(2)], total=140),
            }
        )

        def handle(request: httpx.Request) -> httpx.Response:
            requests.append(json.loads(request.content))
            return answer(request)

        result = await adapter(handle).list_open_pull_requests(TOKEN, [DOTFILES, API])

        [sent] = requests
        assert sent["variables"] == {
            "owner0": "octocat",
            "name0": "dotfiles",
            "owner1": "acme",
            "name1": "api",
        }
        assert "first: 100" in sent["query"]
        assert result.viewer_login == "octocat"
        assert [(r.github_id, r.full_name, r.total_count) for r in result.repositories] == [
            (1, "octocat/dotfiles", 1),
            (2, "acme/api", 140),
        ]
        assert result.repositories[1].url == "https://github.com/acme/api"

    async def test_a_pull_request_is_translated(self) -> None:
        node = pr_node(
            7,
            title="Add zsh config",
            isDraft=True,
            labels={"nodes": [{"name": "enhancement", "color": "a2eeef"}]},
        )

        result = await adapter(graphql(one_pr(node))).list_open_pull_requests(TOKEN, [DOTFILES])

        [pr] = result.repositories[0].pull_requests
        assert pr.number == 7
        assert pr.title == "Add zsh config"
        assert pr.url == "https://github.com/octocat/dotfiles/pull/7"
        assert pr.author_login == "hubot"
        assert pr.author_is_bot is False
        assert pr.is_draft is True
        assert pr.created_at == datetime(2026, 11, 20, 9, 0, tzinfo=UTC)
        assert pr.updated_at == datetime(2026, 11, 21, 10, 30, tzinfo=UTC)
        assert pr.labels == (GitHubLabel(name="enhancement", color="a2eeef"),)

    @pytest.mark.parametrize(
        ("decision", "expected"),
        [
            ("APPROVED", "approved"),
            ("CHANGES_REQUESTED", "changes_requested"),
            ("REVIEW_REQUIRED", "pending"),
            (None, "pending"),
        ],
    )
    async def test_the_review_decision_is_read(self, decision: str | None, expected: str) -> None:
        data = one_pr(pr_node(1, reviewDecision=decision))

        result = await adapter(graphql(data)).list_open_pull_requests(TOKEN, [DOTFILES])

        assert result.repositories[0].pull_requests[0].review_decision == expected

    @pytest.mark.parametrize(
        ("rollup", "expected"),
        [
            ({"state": "SUCCESS"}, "pass"),
            ({"state": "FAILURE"}, "fail"),
            ({"state": "ERROR"}, "fail"),
            ({"state": "PENDING"}, "pending"),
            ({"state": "EXPECTED"}, "pending"),
            (None, None),
        ],
    )
    async def test_the_ci_status_is_read(
        self, rollup: dict[str, str] | None, expected: str | None
    ) -> None:
        data = one_pr(pr_node(1, statusCheckRollup=rollup))

        result = await adapter(graphql(data)).list_open_pull_requests(TOKEN, [DOTFILES])

        assert result.repositories[0].pull_requests[0].ci_status == expected

    async def test_a_review_requested_from_the_viewer_in_person_is_flagged(self) -> None:
        requested = pr_node(
            1,
            reviewRequests={
                "nodes": [
                    {"requestedReviewer": {"__typename": "Team", "slug": "core"}},
                    {"requestedReviewer": {"__typename": "User", "login": "OctoCat"}},
                ]
            },
        )
        someone_else = pr_node(
            2,
            reviewRequests={
                "nodes": [
                    {"requestedReviewer": {"__typename": "User", "login": "hubot"}},
                    {"requestedReviewer": {"__typename": "Team", "slug": "core"}},
                ]
            },
        )
        data = {
            "viewer": {"login": "octocat"},
            "r0": repository_node(1, "octocat/dotfiles", [requested, someone_else]),
        }

        result = await adapter(graphql(data)).list_open_pull_requests(TOKEN, [DOTFILES])

        assert [pr.review_requested for pr in result.repositories[0].pull_requests] == [
            True,
            False,
        ]

    @pytest.mark.parametrize(
        ("author", "is_bot"),
        [
            ({"__typename": "Bot", "login": "dependabot"}, True),
            ({"__typename": "User", "login": "renovate[bot]"}, True),
            ({"__typename": "User", "login": "hubot"}, False),
        ],
    )
    async def test_bot_authors_are_detected(self, author: dict[str, str], is_bot: bool) -> None:
        data = one_pr(pr_node(1, author=author))

        result = await adapter(graphql(data)).list_open_pull_requests(TOKEN, [DOTFILES])

        assert result.repositories[0].pull_requests[0].author_is_bot is is_bot

    async def test_a_deleted_author_has_no_login(self) -> None:
        data = one_pr(pr_node(1, author=None))

        result = await adapter(graphql(data)).list_open_pull_requests(TOKEN, [DOTFILES])

        [pr] = result.repositories[0].pull_requests
        assert (pr.author_login, pr.author_is_bot) == (None, False)

    async def test_a_repository_the_token_can_no_longer_read_is_left_out(self) -> None:
        data = {
            "viewer": {"login": "octocat"},
            "r0": None,
            "r1": repository_node(2, "acme/api", [pr_node(2)]),
        }
        errors = [{"type": "NOT_FOUND", "path": ["r0"], "message": "Could not resolve"}]

        result = await adapter(graphql(data, errors)).list_open_pull_requests(
            TOKEN, [DOTFILES, API]
        )

        assert [r.full_name for r in result.repositories] == ["acme/api"]

    async def test_a_graphql_rate_limit_is_transient(self) -> None:
        errors = [{"type": "RATE_LIMITED", "message": "API rate limit exceeded"}]

        with pytest.raises(TransientGitHubSourceError):
            await adapter(graphql({}, errors)).list_open_pull_requests(TOKEN, [DOTFILES])

    async def test_bad_credentials_are_terminal(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"message": "Bad credentials"})

        with pytest.raises(TerminalGitHubSourceError):
            await adapter(handle).list_open_pull_requests(TOKEN, [DOTFILES])

    @pytest.mark.parametrize(
        ("status", "headers"),
        [(403, {"x-ratelimit-remaining": "0"}), (429, {"retry-after": "60"}), (502, {})],
        ids=["rate limit", "secondary rate limit", "server error"],
    )
    async def test_rate_limits_and_server_errors_are_transient(
        self, status: int, headers: dict[str, str]
    ) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(status, json={"message": "nope"}, headers=headers)

        with pytest.raises(TransientGitHubSourceError):
            await adapter(handle).list_open_pull_requests(TOKEN, [DOTFILES])

    async def test_a_network_failure_is_transient(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("slow", request=request)

        with pytest.raises(TransientGitHubSourceError):
            await adapter(handle).list_open_pull_requests(TOKEN, [DOTFILES])
