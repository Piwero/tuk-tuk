"""How fresh the GitHub view's reads are (issue #583, spec #576).

Each GitHub Token's Pull Requests and GitHub Issues are cached in process
memory for 60 seconds, Refresh bypasses that cache, and a transient GitHub
failure falls back to the last successful result when it is under 10
minutes old. Driven through the HTTP API with the fake GitHub source and
the fake clock: a test counts the fake's calls to see whether GitHub was
asked.
"""

from datetime import datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from app.github_source import TerminalGitHubSourceError, TransientGitHubSourceError
from tests.conftest import FakeClock, FakeGitHubSource, fake_issue, fake_pull_request
from tests.test_github_pull_requests import watch_through

PULL_REQUESTS = "/api/v1/github/pull-requests"
ISSUES = "/api/v1/github/issues"
PERSONAL = "github_pat_11AAAAAAA0personal"
WORK = "github_pat_11AAAAAAA0work"


def read(client: TestClient, path: str = PULL_REQUESTS, query: str = "") -> dict[str, Any]:
    response = client.get(path + query)
    assert response.status_code == 200, response.text
    return dict(response.json())


def titles(body: dict[str, Any]) -> list[str]:
    return [item["title"] for item in body["items"]]


def fetched_at(body: dict[str, Any]) -> datetime:
    return datetime.fromisoformat(body["fetched_at"])


def test_a_read_within_60_seconds_is_served_without_asking_github(
    client: TestClient, fake_github_source: FakeGitHubSource, fake_clock: FakeClock
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_pull_requests(
        PERSONAL, "octocat/dotfiles", [fake_pull_request(1, "First look")]
    )
    read(client)
    fake_github_source.register_pull_requests(
        PERSONAL, "octocat/dotfiles", [fake_pull_request(2, "Opened since")]
    )

    fake_clock.advance(timedelta(seconds=59))
    body = read(client)

    assert titles(body) == ["First look"]
    assert len(fake_github_source.pull_request_calls) == 1


def test_a_read_after_60_seconds_asks_github_again(
    client: TestClient, fake_github_source: FakeGitHubSource, fake_clock: FakeClock
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_pull_requests(
        PERSONAL, "octocat/dotfiles", [fake_pull_request(1, "First look")]
    )
    read(client)
    fake_github_source.register_pull_requests(
        PERSONAL, "octocat/dotfiles", [fake_pull_request(2, "Opened since")]
    )

    fake_clock.advance(timedelta(seconds=60))

    assert titles(read(client)) == ["Opened since"]


def test_refresh_asks_github_and_replaces_the_cached_result(
    client: TestClient, fake_github_source: FakeGitHubSource, fake_clock: FakeClock
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_pull_requests(
        PERSONAL, "octocat/dotfiles", [fake_pull_request(1, "First look")]
    )
    read(client)
    fake_github_source.register_pull_requests(
        PERSONAL, "octocat/dotfiles", [fake_pull_request(2, "Opened since")]
    )

    fake_clock.advance(timedelta(seconds=5))
    assert titles(read(client, query="?refresh=true")) == ["Opened since"]

    # The refreshed result is what the next read within a minute serves.
    fake_github_source.register_pull_requests(PERSONAL, "octocat/dotfiles", [])
    fake_clock.advance(timedelta(seconds=30))
    assert titles(read(client)) == ["Opened since"]


def test_a_cached_read_carries_the_time_it_was_fetched_from_github(
    client: TestClient, fake_github_source: FakeGitHubSource, fake_clock: FakeClock
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fetched = fake_clock.now
    assert fetched_at(read(client)) == fetched

    fake_clock.advance(timedelta(seconds=42))

    assert fetched_at(read(client)) == fetched
    assert fetched_at(read(client, query="?refresh=true")) == fake_clock.now


def test_pull_requests_and_github_issues_are_cached_apart(
    client: TestClient, fake_github_source: FakeGitHubSource, fake_clock: FakeClock
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_pull_requests(
        PERSONAL, "octocat/dotfiles", [fake_pull_request(1, "A pull request")]
    )
    fake_github_source.register_issues(
        PERSONAL, "octocat/dotfiles", [fake_issue(2, "A github issue")]
    )
    assert titles(read(client, PULL_REQUESTS)) == ["A pull request"]

    assert titles(read(client, ISSUES)) == ["A github issue"]
    fake_clock.advance(timedelta(seconds=10))
    assert titles(read(client, ISSUES)) == ["A github issue"]
    assert titles(read(client, PULL_REQUESTS)) == ["A pull request"]
    assert len(fake_github_source.issue_calls) == 1
    assert len(fake_github_source.pull_request_calls) == 1


def token_statuses(body: dict[str, Any]) -> list[tuple[str, str]]:
    return [(t["owner_login"], t["status"]) for t in body["tokens"]]


def test_a_transient_failure_serves_the_last_result_under_10_minutes_old_as_stale(
    client: TestClient, fake_github_source: FakeGitHubSource, fake_clock: FakeClock
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_pull_requests(
        PERSONAL, "octocat/dotfiles", [fake_pull_request(1, "Last seen")]
    )
    fetched = fake_clock.now
    assert read(client)["stale"] is False

    fake_clock.advance(timedelta(minutes=9, seconds=59))
    fake_github_source.register_pull_requests_error(
        PERSONAL, TransientGitHubSourceError("rate limited")
    )
    body = read(client)

    assert titles(body) == ["Last seen"]
    assert body["stale"] is True
    assert fetched_at(body) == fetched
    assert token_statuses(body) == [("octocat", "stale")]


def test_a_transient_failure_with_no_result_under_10_minutes_old_shows_no_rows(
    client: TestClient, fake_github_source: FakeGitHubSource, fake_clock: FakeClock
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_pull_requests(
        PERSONAL, "octocat/dotfiles", [fake_pull_request(1, "Long gone")]
    )
    read(client)

    fake_clock.advance(timedelta(minutes=10))
    fake_github_source.register_pull_requests_error(
        PERSONAL, TransientGitHubSourceError("rate limited")
    )
    body = read(client)

    assert titles(body) == []
    assert body["stale"] is False
    assert token_statuses(body) == [("octocat", "unavailable")]


def test_serving_a_stale_result_leaves_the_token_connected(
    client: TestClient, fake_github_source: FakeGitHubSource, fake_clock: FakeClock
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    read(client)
    fake_github_source.register_pull_requests_error(PERSONAL, TransientGitHubSourceError("5xx"))

    assert read(client, query="?refresh=true")["stale"] is True

    [token] = client.get("/api/v1/github/tokens").json()
    assert token["connection_state"] == "connected"


def test_once_github_rejects_a_token_its_earlier_result_is_never_shown_again(
    client: TestClient, fake_github_source: FakeGitHubSource, fake_clock: FakeClock
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_pull_requests(
        PERSONAL, "octocat/dotfiles", [fake_pull_request(1, "Before revocation")]
    )
    read(client)
    fake_github_source.register_pull_requests_error(
        PERSONAL, TerminalGitHubSourceError("Bad credentials")
    )

    rejected = read(client, query="?refresh=true")
    assert titles(rejected) == []
    assert token_statuses(rejected) == [("octocat", "needs_reconnect")]

    # Neither the cache within the minute nor a later blip brings it back.
    assert titles(read(client)) == []
    fake_github_source.register_pull_requests_error(PERSONAL, TransientGitHubSourceError("5xx"))
    fake_clock.advance(timedelta(minutes=1))
    assert titles(read(client)) == []


def test_a_token_rejected_in_settings_is_read_live_rather_than_from_the_cache(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_pull_requests(
        PERSONAL, "octocat/dotfiles", [fake_pull_request(1, "Before revocation")]
    )
    read(client)
    revoked = TerminalGitHubSourceError("Bad credentials")
    fake_github_source.register_repositories_error(PERSONAL, revoked)
    fake_github_source.register_pull_requests_error(PERSONAL, revoked)
    # The repository picker in Settings finds the token rejected.
    client.get("/api/v1/github/repositories")

    body = read(client)

    assert titles(body) == []
    assert token_statuses(body) == [("octocat", "needs_reconnect")]
