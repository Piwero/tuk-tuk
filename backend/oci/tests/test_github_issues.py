"""The GitHub view's GitHub Issues tab (issue #582, spec #576).

Driven through the HTTP API with the fake GitHub source, like the Pull
Requests tab: a test registers tokens, their repositories and the open
GitHub Issues GitHub would return, watches some repositories, then reads
them as the GitHub view does.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from app.github_source import TerminalGitHubSourceError, TransientGitHubSourceError
from tests.conftest import FakeGitHubSource, fake_issue, fake_pull_request
from tests.test_github_pull_requests import TOKENS, WATCHED, watch_through

ISSUES = "/api/v1/github/issues"
PERSONAL = "github_pat_11AAAAAAA0personal"
WORK = "github_pat_11AAAAAAA0work"
T0 = datetime(2026, 11, 20, 9, 0, tzinfo=UTC)


def read(client: TestClient, query: str = "") -> dict[str, Any]:
    response = client.get(ISSUES + query)
    assert response.status_code == 200, response.text
    return dict(response.json())


def titles(body: dict[str, Any]) -> list[str]:
    return [item["title"] for item in body["items"]]


def test_an_open_github_issue_in_a_watched_repository_is_listed_with_its_details(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_issues(
        PERSONAL,
        "octocat/dotfiles",
        [
            fake_issue(
                12,
                "Zsh prompt is slow",
                author="hubot",
                assignees=["octocat", "monalisa"],
                created_at=T0,
                updated_at=T0 + timedelta(hours=2),
                labels=[("bug", "d73a4a")],
                comment_count=4,
            )
        ],
    )

    [item] = read(client)["items"]

    assert item == {
        "watched_repository_id": item["watched_repository_id"],
        "repository": "octocat/dotfiles",
        "number": 12,
        "title": "Zsh prompt is slow",
        "url": "https://github.com/octocat/dotfiles/issues/12",
        "author": "hubot",
        "author_is_bot": False,
        "assignees": ["octocat", "monalisa"],
        "created_at": "2026-11-20T09:00:00Z",
        "updated_at": "2026-11-20T11:00:00Z",
        "labels": [{"name": "bug", "color": "d73a4a"}],
        "comment_count": 4,
    }


def test_github_issues_are_sorted_most_recently_updated_first_across_repositories(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    watch_through(client, fake_github_source, WORK, "acme", [(2, "acme/api")])
    fake_github_source.register_issues(
        PERSONAL,
        "octocat/dotfiles",
        [
            fake_issue(1, "dotfiles old", updated_at=T0),
            fake_issue(2, "dotfiles newest", updated_at=T0 + timedelta(hours=5)),
        ],
    )
    fake_github_source.register_issues(
        WORK,
        "acme/api",
        [fake_issue(1, "api middle", repository="acme/api", updated_at=T0 + timedelta(hours=1))],
    )

    assert titles(read(client)) == ["dotfiles newest", "api middle", "dotfiles old"]


def test_a_repository_contributes_at_most_100_github_issues_and_links_to_the_rest(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_issues(
        PERSONAL,
        "octocat/dotfiles",
        [fake_issue(n, f"Issue {n}", updated_at=T0 + timedelta(minutes=n)) for n in range(1, 104)],
    )

    body = read(client)

    assert len(body["items"]) == 100
    # The 100 most recently updated: the three oldest stay on GitHub.
    assert "Issue 3" not in titles(body)
    assert "Issue 4" in titles(body)
    assert body["repositories"] == [
        {
            "watched_repository_id": body["items"][0]["watched_repository_id"],
            "full_name": "octocat/dotfiles",
            "total_count": 103,
            "overflow_count": 3,
            "overflow_url": "https://github.com/octocat/dotfiles/issues",
        }
    ]


def test_pull_requests_never_appear_among_github_issues(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_pull_requests(
        PERSONAL, "octocat/dotfiles", [fake_pull_request(1, "A Pull Request")]
    )
    fake_github_source.register_issues(
        PERSONAL, "octocat/dotfiles", [fake_issue(2, "A GitHub Issue")]
    )

    body = read(client)

    assert titles(body) == ["A GitHub Issue"]
    assert body["repositories"][0]["total_count"] == 1


def test_bot_authors_of_github_issues_are_flagged(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_issues(
        PERSONAL,
        "octocat/dotfiles",
        [
            fake_issue(1, "Dependency dashboard", author="renovate", author_is_bot=True),
            fake_issue(2, "Human report", author="hubot"),
        ],
    )

    flags = {item["title"]: item["author_is_bot"] for item in read(client)["items"]}

    assert flags == {"Dependency dashboard": True, "Human report": False}


def test_only_watched_repositories_are_read_one_call_per_token(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    fake_github_source.register_token(WORK, owner_login="acme")
    fake_github_source.register_repositories(WORK, [(2, "acme/api"), (3, "acme/unwatched")])
    token_id = client.post(TOKENS, json={"token": WORK}).json()["id"]
    client.post(WATCHED, json={"github_token_id": token_id, "github_repo_id": 2})

    read(client)

    assert fake_github_source.issue_calls == [(WORK, ["acme/api"])]


def test_a_failing_token_is_reported_while_other_tokens_github_issues_still_render(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    personal = watch_through(
        client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")]
    )
    work = watch_through(client, fake_github_source, WORK, "acme", [(2, "acme/api")])
    fake_github_source.register_issues(
        WORK, "acme/api", [fake_issue(1, "Still here", repository="acme/api")]
    )
    fake_github_source.register_issues_error(PERSONAL, TransientGitHubSourceError("rate limited"))

    body = read(client)

    assert titles(body) == ["Still here"]
    assert body["tokens"] == [
        {"id": personal, "owner_login": "octocat", "status": "unavailable"},
        {"id": work, "owner_login": "acme", "status": "ok"},
    ]


def test_a_token_github_rejects_is_reported_as_needing_reconnection(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    personal = watch_through(
        client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")]
    )
    fake_github_source.register_issues_error(PERSONAL, TerminalGitHubSourceError("Bad credentials"))

    assert read(client)["tokens"] == [
        {"id": personal, "owner_login": "octocat", "status": "needs_reconnect"}
    ]


def test_github_issues_are_read_live_and_nothing_is_kept_of_them(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_issues(PERSONAL, "octocat/dotfiles", [fake_issue(1, "Open now")])
    assert titles(read(client)) == ["Open now"]

    # Closed on GitHub: gone from the next read, as nothing was stored.
    fake_github_source.register_issues(PERSONAL, "octocat/dotfiles", [])

    assert titles(read(client)) == []
