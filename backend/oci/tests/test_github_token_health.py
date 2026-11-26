"""GitHub Token health (issue #584, spec #576, ADR 0007 and 0020).

A GitHub Token GitHub rejects while the GitHub view is read is marked as
needing reconnection; a transient failure never is. The User reconnects
by pasting a replacement token for the same owner, which keeps the
token's Watched Repositories. Settings warns 7 days before a token expires.

Driven through the HTTP API with the fake GitHub source and the fake clock.
"""

from typing import Any

from fastapi.testclient import TestClient

from app.github_source import TerminalGitHubSourceError, TransientGitHubSourceError
from tests.conftest import FakeGitHubSource

TOKENS = "/api/v1/github/tokens"
WATCHED = "/api/v1/github/watched-repositories"
PULL_REQUESTS = "/api/v1/github/pull-requests"
PERSONAL = "github_pat_11AAAAAAA0personal"
REPLACEMENT = "github_pat_11AAAAAAA0rotated"


def watch_through(
    client: TestClient,
    source: FakeGitHubSource,
    token: str,
    owner: str,
    repositories: list[tuple[int, str]],
    **identity: Any,
) -> int:
    """Adds a GitHub Token for `owner` and watches every repository in
    `repositories` through it. Returns the GitHub Token's id."""
    source.register_token(token, owner_login=owner, **identity)
    source.register_repositories(token, repositories)
    response = client.post(TOKENS, json={"token": token})
    assert response.status_code == 201, response.text
    token_id = int(response.json()["id"])
    for github_repo_id, _ in repositories:
        watched = client.post(
            WATCHED, json={"github_token_id": token_id, "github_repo_id": github_repo_id}
        )
        assert watched.status_code == 201, watched.text
    return token_id


def connection_state(client: TestClient, token_id: int) -> str:
    [token] = [t for t in client.get(TOKENS).json() if t["id"] == token_id]
    return str(token["connection_state"])


def test_a_token_github_rejects_while_reading_needs_reconnection(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    personal = watch_through(
        client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")]
    )
    fake_github_source.register_pull_requests_error(
        PERSONAL, TerminalGitHubSourceError("Bad credentials")
    )

    assert client.get(PULL_REQUESTS).status_code == 200

    assert connection_state(client, personal) == "needs_reconnect"


def test_a_transient_failure_while_reading_leaves_the_token_connected(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    personal = watch_through(
        client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")]
    )
    fake_github_source.register_pull_requests_error(
        PERSONAL, TransientGitHubSourceError("rate limited")
    )

    assert client.get(PULL_REQUESTS).status_code == 200

    assert connection_state(client, personal) == "connected"


def test_reconnecting_with_a_replacement_for_the_same_owner_keeps_its_watched_repositories(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    personal = watch_through(
        client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")]
    )
    fake_github_source.register_pull_requests_error(
        PERSONAL, TerminalGitHubSourceError("Bad credentials")
    )
    client.get(PULL_REQUESTS)
    fake_github_source.register_token(REPLACEMENT, owner_login="octocat")

    response = client.patch(f"{TOKENS}/{personal}", json={"token": REPLACEMENT})

    assert response.status_code == 200, response.text
    assert response.json()["id"] == personal
    assert response.json()["connection_state"] == "connected"
    assert [w["full_name"] for w in client.get(WATCHED).json()] == ["octocat/dotfiles"]
    client.get(PULL_REQUESTS)
    assert fake_github_source.pull_request_calls[-1] == (REPLACEMENT, ["octocat/dotfiles"])
