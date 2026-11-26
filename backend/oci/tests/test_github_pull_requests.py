"""The GitHub view's Pull Requests tab (issue #579, spec #576).

Driven through the HTTP API with the fake GitHub source: a test registers
the tokens, their repositories and the open Pull Requests GitHub would
return, watches some repositories, then reads them as the GitHub view does.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from app.github_source import TerminalGitHubSourceError, TransientGitHubSourceError
from tests.conftest import FakeClock, FakeGitHubSource, fake_pull_request

TOKENS = "/api/v1/github/tokens"
WATCHED = "/api/v1/github/watched-repositories"
PULL_REQUESTS = "/api/v1/github/pull-requests"
PERSONAL = "github_pat_11AAAAAAA0personal"
WORK = "github_pat_11AAAAAAA0work"
T0 = datetime(2026, 11, 20, 9, 0, tzinfo=UTC)


def watch_through(
    client: TestClient,
    source: FakeGitHubSource,
    token: str,
    owner: str,
    repositories: list[tuple[int, str]],
) -> int:
    """Adds a GitHub Token for `owner` and watches every repository in
    `repositories` through it. Returns the GitHub Token's id."""
    source.register_token(token, owner_login=owner)
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


def read(client: TestClient, query: str = "") -> dict[str, Any]:
    response = client.get(PULL_REQUESTS + query)
    assert response.status_code == 200, response.text
    return dict(response.json())


def titles(body: dict[str, Any]) -> list[str]:
    return [item["title"] for item in body["items"]]


def token_statuses(body: dict[str, Any]) -> list[dict[str, Any]]:
    """Each token's id, owner login and read status, leaving out its expiry."""
    return [{k: t[k] for k in ("id", "owner_login", "status")} for t in body["tokens"]]


def test_an_open_pull_request_in_a_watched_repository_is_listed_with_its_details(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_pull_requests(
        PERSONAL,
        "octocat/dotfiles",
        [
            fake_pull_request(
                7,
                "Add zsh config",
                author="hubot",
                created_at=T0,
                updated_at=T0 + timedelta(hours=2),
                labels=[("enhancement", "a2eeef")],
                is_draft=True,
                review_decision="changes_requested",
                ci_status="fail",
            )
        ],
    )

    [item] = read(client)["items"]

    assert item == {
        "watched_repository_id": item["watched_repository_id"],
        "repository": "octocat/dotfiles",
        "number": 7,
        "title": "Add zsh config",
        "url": "https://github.com/octocat/dotfiles/pull/7",
        "author": "hubot",
        "author_is_bot": False,
        "created_at": "2026-11-20T09:00:00Z",
        "updated_at": "2026-11-20T11:00:00Z",
        "labels": [{"name": "enhancement", "color": "a2eeef"}],
        "is_draft": True,
        "review_decision": "changes_requested",
        "ci_status": "fail",
        "relationship": "other",
    }


def test_pull_requests_are_grouped_review_requested_then_mine_then_others(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_pull_requests(
        PERSONAL,
        "octocat/dotfiles",
        [
            fake_pull_request(1, "Someone else's", author="hubot", updated_at=T0 + timedelta(3)),
            fake_pull_request(2, "My own", author="octocat", updated_at=T0 + timedelta(2)),
            fake_pull_request(
                3, "Asks for my review", author="hubot", review_requested=True, updated_at=T0
            ),
            # Asked to review a Pull Request they wrote: the request wins.
            fake_pull_request(
                4,
                "Mine, review requested",
                author="octocat",
                review_requested=True,
                updated_at=T0 - timedelta(1),
            ),
        ],
    )

    items = read(client)["items"]

    assert [(item["number"], item["relationship"]) for item in items] == [
        (3, "review_requested"),
        (4, "review_requested"),
        (2, "mine"),
        (1, "other"),
    ]


def test_mine_means_authored_by_the_github_user_the_token_acts_as(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    # An organisation's token is still created by, and acts as, one person.
    fake_github_source.register_viewer(WORK, "octocat")
    watch_through(client, fake_github_source, WORK, "acme", [(2, "acme/api")])
    fake_github_source.register_pull_requests(
        WORK,
        "acme/api",
        [
            fake_pull_request(1, "Written by octocat", repository="acme/api", author="Octocat"),
            fake_pull_request(2, "Written by hubot", repository="acme/api", author="hubot"),
        ],
    )

    relationships = {item["title"]: item["relationship"] for item in read(client)["items"]}

    assert relationships == {"Written by octocat": "mine", "Written by hubot": "other"}


def test_each_group_is_sorted_most_recently_updated_first_across_repositories(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    watch_through(client, fake_github_source, WORK, "acme", [(2, "acme/api")])
    fake_github_source.register_pull_requests(
        PERSONAL,
        "octocat/dotfiles",
        [
            fake_pull_request(1, "dotfiles old", updated_at=T0),
            fake_pull_request(2, "dotfiles newest", updated_at=T0 + timedelta(hours=5)),
        ],
    )
    fake_github_source.register_pull_requests(
        WORK,
        "acme/api",
        [fake_pull_request(1, "api middle", repository="acme/api", updated_at=T0 + timedelta(1))],
    )

    assert titles(read(client)) == ["api middle", "dotfiles newest", "dotfiles old"]


def test_a_repository_contributes_at_most_100_pull_requests_and_links_to_the_rest(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_pull_requests(
        PERSONAL,
        "octocat/dotfiles",
        [
            fake_pull_request(n, f"PR {n}", updated_at=T0 + timedelta(minutes=n))
            for n in range(1, 106)
        ],
    )

    body = read(client)

    assert len(body["items"]) == 100
    # The 100 most recently updated: the five oldest stay on GitHub.
    assert "PR 5" not in titles(body)
    assert "PR 6" in titles(body)
    assert body["repositories"] == [
        {
            "watched_repository_id": body["items"][0]["watched_repository_id"],
            "full_name": "octocat/dotfiles",
            "total_count": 105,
            "overflow_count": 5,
            "overflow_url": "https://github.com/octocat/dotfiles/pulls",
        }
    ]


def test_a_repository_under_the_cap_has_no_overflow(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_pull_requests(
        PERSONAL, "octocat/dotfiles", [fake_pull_request(1, "Only one")]
    )

    [repository] = read(client)["repositories"]

    assert (repository["total_count"], repository["overflow_count"]) == (1, 0)


def test_bot_authors_are_flagged(client: TestClient, fake_github_source: FakeGitHubSource) -> None:
    watch_through(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    fake_github_source.register_pull_requests(
        PERSONAL,
        "octocat/dotfiles",
        [
            fake_pull_request(1, "Bump lodash", author="dependabot", author_is_bot=True),
            fake_pull_request(2, "Human work", author="hubot"),
        ],
    )

    flags = {item["title"]: item["author_is_bot"] for item in read(client)["items"]}

    assert flags == {"Bump lodash": True, "Human work": False}


def test_only_watched_repositories_are_read_one_call_per_token(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    fake_github_source.register_token(WORK, owner_login="acme")
    fake_github_source.register_repositories(
        WORK, [(2, "acme/api"), (3, "acme/web"), (4, "acme/unwatched")]
    )
    token_id = client.post(TOKENS, json={"token": WORK}).json()["id"]
    for github_repo_id in (2, 3):
        client.post(WATCHED, json={"github_token_id": token_id, "github_repo_id": github_repo_id})

    read(client)

    assert fake_github_source.pull_request_calls == [(WORK, ["acme/api", "acme/web"])]


def test_with_no_watched_repositories_the_read_is_empty(
    client: TestClient, fake_github_source: FakeGitHubSource, fake_clock: FakeClock
) -> None:
    body = read(client)

    assert body == {
        "items": [],
        "repositories": [],
        "tokens": [],
        "fetched_at": fake_clock.now.isoformat().replace("+00:00", "Z"),
        "stale": False,
    }
    assert fake_github_source.pull_request_calls == []


def test_each_token_read_reports_its_status(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    personal = watch_through(
        client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")]
    )

    assert token_statuses(read(client)) == [
        {"id": personal, "owner_login": "octocat", "status": "ok"}
    ]


def test_a_token_github_cannot_reach_is_reported_while_other_tokens_still_render(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    personal = watch_through(
        client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")]
    )
    work = watch_through(client, fake_github_source, WORK, "acme", [(2, "acme/api")])
    fake_github_source.register_pull_requests(
        WORK, "acme/api", [fake_pull_request(1, "Still here", repository="acme/api")]
    )
    fake_github_source.register_pull_requests_error(
        PERSONAL, TransientGitHubSourceError("rate limited")
    )

    body = read(client)

    assert titles(body) == ["Still here"]
    assert token_statuses(body) == [
        {"id": personal, "owner_login": "octocat", "status": "unavailable"},
        {"id": work, "owner_login": "acme", "status": "ok"},
    ]


def test_a_token_github_rejects_is_reported_as_needing_reconnection(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    personal = watch_through(
        client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")]
    )
    fake_github_source.register_pull_requests_error(
        PERSONAL, TerminalGitHubSourceError("Bad credentials")
    )

    assert token_statuses(read(client)) == [
        {"id": personal, "owner_login": "octocat", "status": "needs_reconnect"}
    ]
