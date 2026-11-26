"""GitHub Token health (issue #584, spec #576, ADR 0007 and 0020).

A GitHub Token GitHub rejects while the GitHub view is read is marked as
needing reconnection; a transient failure never is. The User reconnects
by pasting a replacement token for the same owner, which keeps the
token's Watched Repositories. Settings warns 7 days before a token expires.

Driven through the HTTP API with the fake GitHub source and the fake clock.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.crypto import decrypt_credential
from app.github_source import TerminalGitHubSourceError, TransientGitHubSourceError
from tests.conftest import FakeClock, FakeGitHubSource, run_sql

TOKENS = "/api/v1/github/tokens"
WATCHED = "/api/v1/github/watched-repositories"
PULL_REQUESTS = "/api/v1/github/pull-requests"
ISSUES = "/api/v1/github/issues"
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


def test_a_token_github_rejects_while_reading_github_issues_needs_reconnection(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    personal = watch_through(
        client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")]
    )
    fake_github_source.register_issues_error(PERSONAL, TerminalGitHubSourceError("Bad credentials"))

    assert client.get(ISSUES).status_code == 200

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


def test_a_replacement_for_a_different_owner_is_refused_and_the_token_is_kept(
    client: TestClient, fake_github_source: FakeGitHubSource, database_url: str
) -> None:
    personal = watch_through(
        client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")]
    )
    fake_github_source.register_token(REPLACEMENT, owner_login="acme", owner_kind="organization")

    response = client.patch(f"{TOKENS}/{personal}", json={"token": REPLACEMENT})

    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["code"] == "github_token_owner_mismatch"
    assert "octocat" in error["message"]
    assert "acme" in error["message"]
    [(stored,)] = run_sql(database_url, "SELECT encrypted_token FROM github_tokens")
    assert decrypt_credential(stored, key="test-master-key") == PERSONAL


def test_reconnect_validates_the_replacement_like_a_new_token(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    personal = watch_through(
        client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")]
    )

    not_fine_grained = client.patch(f"{TOKENS}/{personal}", json={"token": "ghp_classic"})
    # Never registered with the fake: GitHub answers 401 Bad credentials.
    rejected = client.patch(f"{TOKENS}/{personal}", json={"token": REPLACEMENT})

    assert not_fine_grained.json()["error"]["code"] == "github_token_not_fine_grained"
    assert rejected.json()["error"]["code"] == "github_token_rejected"


def test_reconnect_updates_the_expiry(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    personal = watch_through(
        client,
        fake_github_source,
        PERSONAL,
        "octocat",
        [(1, "octocat/dotfiles")],
        expires_at=datetime(2026, 12, 1, tzinfo=UTC),
    )
    fake_github_source.register_token(
        REPLACEMENT, owner_login="octocat", expires_at=datetime(2027, 3, 1, tzinfo=UTC)
    )

    response = client.patch(f"{TOKENS}/{personal}", json={"token": REPLACEMENT})

    assert datetime.fromisoformat(response.json()["expires_at"]) == datetime(2027, 3, 1, tzinfo=UTC)


def test_reconnecting_a_token_that_does_not_exist_is_not_found(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    fake_github_source.register_token(REPLACEMENT, owner_login="octocat")

    response = client.patch(f"{TOKENS}/9999", json={"token": REPLACEMENT})

    assert response.status_code == 404, response.text


@pytest.mark.parametrize(
    ("expires_in", "expires_soon"),
    [
        (timedelta(days=8), False),
        (timedelta(days=7), True),
        (timedelta(hours=1), True),
        (-timedelta(days=1), True),
        (None, False),
    ],
)
def test_a_token_expiring_within_7_days_is_flagged(
    client: TestClient,
    fake_github_source: FakeGitHubSource,
    fake_clock: FakeClock,
    expires_in: timedelta | None,
    expires_soon: bool,
) -> None:
    expires_at = None if expires_in is None else fake_clock.now + expires_in
    fake_github_source.register_token(PERSONAL, owner_login="octocat", expires_at=expires_at)
    client.post(TOKENS, json={"token": PERSONAL})

    [token] = client.get(TOKENS).json()

    assert token["expires_soon"] is expires_soon


def test_the_expiry_warning_follows_the_clock(
    client: TestClient, fake_github_source: FakeGitHubSource, fake_clock: FakeClock
) -> None:
    fake_github_source.register_token(
        PERSONAL, owner_login="octocat", expires_at=fake_clock.now + timedelta(days=10)
    )
    client.post(TOKENS, json={"token": PERSONAL})
    assert client.get(TOKENS).json()[0]["expires_soon"] is False

    fake_clock.advance(timedelta(days=3, hours=1))

    assert client.get(TOKENS).json()[0]["expires_soon"] is True


def test_the_github_view_read_carries_each_tokens_expiry(
    client: TestClient, fake_github_source: FakeGitHubSource, fake_clock: FakeClock
) -> None:
    expires_at = fake_clock.now + timedelta(days=2)
    personal = watch_through(
        client,
        fake_github_source,
        PERSONAL,
        "octocat",
        [(1, "octocat/dotfiles")],
        expires_at=expires_at,
    )

    [token] = client.get(PULL_REQUESTS).json()["tokens"]

    assert token["id"] == personal
    assert datetime.fromisoformat(token["expires_at"]) == expires_at
    assert token["expires_soon"] is True
