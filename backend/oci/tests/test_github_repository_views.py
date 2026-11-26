"""Repository Views (issue #580, spec #576).

A User saves named subsets of their Watched Repositories, each remembering
its filters and active tab. Driven through the HTTP API with the fake GitHub
source, like the Pull Requests and GitHub Issues tabs.
"""

from typing import Any

from fastapi.testclient import TestClient

from app.github_source import TransientGitHubSourceError
from tests.conftest import FakeGitHubSource, fake_issue, fake_pull_request
from tests.test_github_pull_requests import PULL_REQUESTS, TOKENS, WATCHED, watch_through

VIEWS = "/api/v1/github/views"
ISSUES = "/api/v1/github/issues"
PERSONAL = "github_pat_11AAAAAAA0personal"
WORK = "github_pat_11AAAAAAA0work"


def watched_ids(client: TestClient) -> dict[str, int]:
    """The User's Watched Repositories' ids by `owner/name`."""
    response = client.get(WATCHED)
    assert response.status_code == 200, response.text
    return {row["full_name"]: row["id"] for row in response.json()}


def create_view(client: TestClient, name: str, repositories: list[int]) -> dict[str, Any]:
    response = client.post(VIEWS, json={"name": name, "watched_repository_ids": repositories})
    assert response.status_code == 201, response.text
    return dict(response.json())


def list_views(client: TestClient) -> list[dict[str, Any]]:
    response = client.get(VIEWS)
    assert response.status_code == 200, response.text
    return list(response.json())


def test_a_repository_view_is_created_from_a_subset_of_watched_repositories(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_through(
        client,
        fake_github_source,
        PERSONAL,
        "octocat",
        [(1, "octocat/dotfiles"), (2, "octocat/blog")],
    )
    ids = watched_ids(client)

    created = create_view(client, "Side projects", [ids["octocat/blog"]])

    assert list_views(client) == [created]
    assert client.get(f"{VIEWS}/{created['id']}").json() == created
    assert created == {
        "id": created["id"],
        "name": "Side projects",
        "sort_order": created["sort_order"],
        "watched_repository_ids": [ids["octocat/blog"]],
        "author": None,
        "label": None,
        "assignee": None,
        "hide_drafts": False,
        "hide_bots": False,
        "active_tab": "pull_requests",
    }


def patch_view(client: TestClient, view_id: int, changes: dict[str, Any]) -> dict[str, Any]:
    response = client.patch(f"{VIEWS}/{view_id}", json=changes)
    assert response.status_code == 200, response.text
    return dict(response.json())


def test_a_repository_view_can_be_renamed(client: TestClient) -> None:
    view = create_view(client, "Work", [])

    renamed = patch_view(client, view["id"], {"name": "Work repos"})

    assert renamed["name"] == "Work repos"
    assert [v["name"] for v in list_views(client)] == ["Work repos"]


def test_repository_views_are_listed_in_creation_order_until_reordered(
    client: TestClient,
) -> None:
    work = create_view(client, "Work", [])
    side = create_view(client, "Side projects", [])
    oss = create_view(client, "Open source", [])
    assert [v["name"] for v in list_views(client)] == ["Work", "Side projects", "Open source"]

    patch_view(client, oss["id"], {"sort_order": (work["sort_order"] + side["sort_order"]) // 2})

    assert [v["name"] for v in list_views(client)] == ["Work", "Open source", "Side projects"]


def test_a_repository_views_repositories_can_be_chosen_again(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_through(
        client,
        fake_github_source,
        PERSONAL,
        "octocat",
        [(1, "octocat/dotfiles"), (2, "octocat/blog"), (3, "octocat/site")],
    )
    ids = watched_ids(client)
    view = create_view(client, "Side", [ids["octocat/dotfiles"], ids["octocat/blog"]])

    patch_view(
        client, view["id"], {"watched_repository_ids": [ids["octocat/blog"], ids["octocat/site"]]}
    )

    [saved] = list_views(client)
    assert saved["watched_repository_ids"] == sorted([ids["octocat/blog"], ids["octocat/site"]])


def test_a_repository_view_only_takes_the_users_own_watched_repositories(
    client: TestClient,
) -> None:
    response = client.post(VIEWS, json={"name": "Work", "watched_repository_ids": [999_999]})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert list_views(client) == []


def test_a_repository_view_remembers_its_filters_and_active_tab_until_reset(
    client: TestClient,
) -> None:
    view = create_view(client, "Work", [])
    options = {
        "author": "octocat",
        "label": "bug",
        "assignee": "monalisa",
        "hide_drafts": True,
        "hide_bots": True,
        "active_tab": "issues",
    }

    patch_view(client, view["id"], options)

    [saved] = list_views(client)
    assert {key: saved[key] for key in options} == options

    reset = {
        "author": None,
        "label": None,
        "assignee": None,
        "hide_drafts": False,
        "hide_bots": False,
        "active_tab": "pull_requests",
    }
    patch_view(client, view["id"], reset)

    [saved] = list_views(client)
    assert {key: saved[key] for key in reset} == reset


def test_a_repository_view_can_be_deleted(client: TestClient) -> None:
    work = create_view(client, "Work", [])
    create_view(client, "Side projects", [])

    response = client.delete(f"{VIEWS}/{work['id']}")

    assert response.status_code == 204
    assert [v["name"] for v in list_views(client)] == ["Side projects"]


def test_unwatching_a_repository_drops_it_from_every_repository_view(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_through(
        client,
        fake_github_source,
        PERSONAL,
        "octocat",
        [(1, "octocat/dotfiles"), (2, "octocat/blog")],
    )
    ids = watched_ids(client)
    create_view(client, "Both", [ids["octocat/dotfiles"], ids["octocat/blog"]])
    create_view(client, "Blog", [ids["octocat/blog"]])

    assert client.delete(f"{WATCHED}/{ids['octocat/blog']}").status_code == 204

    assert [(v["name"], v["watched_repository_ids"]) for v in list_views(client)] == [
        ("Both", [ids["octocat/dotfiles"]]),
        ("Blog", []),
    ]


def test_removing_a_github_token_drops_its_repositories_from_every_repository_view(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    personal = watch_through(
        client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")]
    )
    watch_through(client, fake_github_source, WORK, "acme", [(2, "acme/api")])
    ids = watched_ids(client)
    create_view(client, "Everything", [ids["octocat/dotfiles"], ids["acme/api"]])

    assert client.delete(f"{TOKENS}/{personal}").status_code == 204

    [view] = list_views(client)
    assert view["watched_repository_ids"] == [ids["acme/api"]]


def watch_three(client: TestClient, source: FakeGitHubSource) -> dict[str, int]:
    """Watches octocat/dotfiles and octocat/blog through a personal GitHub
    Token and acme/api through a work one, each with one open Pull Request
    and one open GitHub Issue named after it."""
    watch_through(
        client, source, PERSONAL, "octocat", [(1, "octocat/dotfiles"), (2, "octocat/blog")]
    )
    watch_through(client, source, WORK, "acme", [(3, "acme/api")])
    for token, full_name in (
        (PERSONAL, "octocat/dotfiles"),
        (PERSONAL, "octocat/blog"),
        (WORK, "acme/api"),
    ):
        source.register_pull_requests(
            token, full_name, [fake_pull_request(1, f"{full_name} PR", repository=full_name)]
        )
        source.register_issues(
            token, full_name, [fake_issue(2, f"{full_name} issue", repository=full_name)]
        )
    return watched_ids(client)


def test_a_repository_view_reads_pull_requests_of_its_repositories_only(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    ids = watch_three(client, fake_github_source)
    view = create_view(client, "Mixed", [ids["octocat/blog"], ids["acme/api"]])

    body = client.get(f"{PULL_REQUESTS}?view={view['id']}").json()

    assert sorted(item["title"] for item in body["items"]) == ["acme/api PR", "octocat/blog PR"]
    assert sorted(r["full_name"] for r in body["repositories"]) == ["acme/api", "octocat/blog"]


def test_a_repository_view_reads_github_issues_of_its_repositories_only(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    ids = watch_three(client, fake_github_source)
    view = create_view(client, "Personal", [ids["octocat/dotfiles"]])

    body = client.get(f"{ISSUES}?view={view['id']}").json()

    assert [item["title"] for item in body["items"]] == ["octocat/dotfiles issue"]
    assert [t["owner_login"] for t in body["tokens"]] == ["octocat"]


def test_a_github_token_with_no_repository_in_the_view_shows_no_banner_there(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    ids = watch_three(client, fake_github_source)
    fake_github_source.register_pull_requests_error(WORK, TransientGitHubSourceError("503"))
    view = create_view(client, "Personal", [ids["octocat/blog"]])

    body = client.get(f"{PULL_REQUESTS}?view={view['id']}").json()

    assert [(t["owner_login"], t["status"]) for t in body["tokens"]] == [("octocat", "ok")]


def test_a_repository_view_with_no_repositories_reads_nothing(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    watch_three(client, fake_github_source)
    view = create_view(client, "Empty", [])

    body = client.get(f"{PULL_REQUESTS}?view={view['id']}").json()

    assert (body["items"], body["repositories"], body["tokens"]) == ([], [], [])


def test_a_repository_view_shares_the_one_minute_cache_with_the_default_view(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    ids = watch_three(client, fake_github_source)
    view = create_view(client, "Blog", [ids["octocat/blog"]])
    client.get(f"{PULL_REQUESTS}?view={view['id']}")
    for full_name in ("octocat/dotfiles", "octocat/blog"):
        fake_github_source.register_pull_requests(
            PERSONAL, full_name, [fake_pull_request(9, f"{full_name} newer", repository=full_name)]
        )

    everything = client.get(PULL_REQUESTS).json()
    again = client.get(f"{PULL_REQUESTS}?view={view['id']}").json()

    # Within the minute neither read asks GitHub again, and the view's
    # read never narrowed what the default view shows.
    assert sorted(item["title"] for item in everything["items"]) == [
        "acme/api PR",
        "octocat/blog PR",
        "octocat/dotfiles PR",
    ]
    assert [item["title"] for item in again["items"]] == ["octocat/blog PR"]


def test_reading_a_repository_view_that_does_not_exist_is_not_found(client: TestClient) -> None:
    for path in (PULL_REQUESTS, ISSUES):
        response = client.get(f"{path}?view=999999")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"
