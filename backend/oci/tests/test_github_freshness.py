"""How fresh the GitHub view's reads are (issue #583, spec #576).

Each GitHub Token's Pull Requests and GitHub Issues are cached in process
memory for 60 seconds, Refresh bypasses that cache, and a transient GitHub
failure falls back to the last successful result when it is under 10
minutes old. Driven through the HTTP API with the fake GitHub source and
the fake clock: a test counts the fake's calls to see whether GitHub was
asked.
"""

from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import FakeClock, FakeGitHubSource, fake_pull_request
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
