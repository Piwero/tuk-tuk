"""The Watched Repositories picker (issue #581, spec #576).

Driven through the HTTP API with the fake GitHub source: a test registers
what each pasted token identifies as and which repositories it can read,
then picks from them as a User would.
"""

from typing import Any

from fastapi.testclient import TestClient

from app.github_source import TerminalGitHubSourceError, TransientGitHubSourceError
from tests.conftest import FakeGitHubSource

TOKENS = "/api/v1/github/tokens"
ACCESSIBLE = "/api/v1/github/repositories"
WATCHED = "/api/v1/github/watched-repositories"
PERSONAL = "github_pat_11AAAAAAA0personal"
WORK = "github_pat_11AAAAAAA0work"


def add_token(
    client: TestClient,
    source: FakeGitHubSource,
    token: str,
    owner: str,
    repositories: list[tuple[int, str]],
) -> int:
    source.register_token(token, owner_login=owner)
    source.register_repositories(token, repositories)
    response = client.post(TOKENS, json={"token": token})
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


def picker(client: TestClient) -> dict[str, Any]:
    response = client.get(ACCESSIBLE)
    assert response.status_code == 200, response.text
    return dict(response.json())


def names(body: dict[str, Any]) -> list[str]:
    return [r["full_name"] for r in body["repositories"]]


def test_the_picker_lists_every_repository_the_users_tokens_can_read(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    add_token(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    add_token(client, fake_github_source, WORK, "acme", [(2, "acme/api"), (3, "acme/web")])

    body = picker(client)

    assert sorted(names(body)) == ["acme/api", "acme/web", "octocat/dotfiles"]
    assert all(r["watched_repository_id"] is None for r in body["repositories"])


def test_a_repository_readable_through_two_tokens_appears_once(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    # octocat is a collaborator on acme/api, so the personal token reads it too.
    add_token(
        client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles"), (2, "acme/api")]
    )
    add_token(client, fake_github_source, WORK, "acme", [(2, "acme/api")])

    assert sorted(names(picker(client))) == ["acme/api", "octocat/dotfiles"]


def watch(client: TestClient, token_id: int, github_repo_id: int) -> Any:
    return client.post(
        WATCHED, json={"github_token_id": token_id, "github_repo_id": github_repo_id}
    )


def test_watching_a_repository_stores_it_against_the_token_it_was_picked_through(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    add_token(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    work = add_token(client, fake_github_source, WORK, "acme", [(2, "acme/api"), (3, "acme/web")])

    response = watch(client, work, 2)

    assert response.status_code == 201, response.text
    watched = response.json()
    assert (watched["full_name"], watched["github_token_id"], watched["private"]) == (
        "acme/api",
        work,
        True,
    )
    assert client.get(WATCHED).json() == [watched]
    marked = {r["full_name"]: r["watched_repository_id"] for r in picker(client)["repositories"]}
    assert marked == {"octocat/dotfiles": None, "acme/api": watched["id"], "acme/web": None}


def test_watching_a_repository_twice_is_refused_even_through_another_token(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    personal = add_token(client, fake_github_source, PERSONAL, "octocat", [(2, "acme/api")])
    work = add_token(client, fake_github_source, WORK, "acme", [(2, "acme/api")])
    assert watch(client, work, 2).status_code == 201

    for token_id in (work, personal):
        response = watch(client, token_id, 2)
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "github_repository_already_watched"
    assert [w["github_token_id"] for w in client.get(WATCHED).json()] == [work]


def test_unwatching_a_repository_deletes_the_watched_repository(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    work = add_token(client, fake_github_source, WORK, "acme", [(2, "acme/api")])
    watched_id = watch(client, work, 2).json()["id"]

    response = client.delete(f"{WATCHED}/{watched_id}")

    assert response.status_code == 204, response.text
    assert client.get(WATCHED).json() == []
    assert [r["watched_repository_id"] for r in picker(client)["repositories"]] == [None]
    assert client.delete(f"{WATCHED}/{watched_id}").status_code == 404


def test_removing_a_token_deletes_its_watched_repositories_and_reoffers_them_through_another(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    personal = add_token(
        client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles"), (2, "acme/api")]
    )
    work = add_token(client, fake_github_source, WORK, "acme", [(2, "acme/api"), (3, "acme/web")])
    assert watch(client, personal, 1).status_code == 201
    assert watch(client, work, 2).status_code == 201
    assert watch(client, work, 3).status_code == 201

    assert client.delete(f"{TOKENS}/{work}").status_code == 204

    assert [w["full_name"] for w in client.get(WATCHED).json()] == ["octocat/dotfiles"]
    offered = {
        r["full_name"]: (r["github_token_id"], r["watched_repository_id"] is None)
        for r in picker(client)["repositories"]
    }
    # acme/web went with the work token; acme/api is still readable.
    assert offered == {"octocat/dotfiles": (personal, False), "acme/api": (personal, True)}


def test_a_repository_the_token_cannot_read_is_not_watched(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    personal = add_token(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    add_token(client, fake_github_source, WORK, "acme", [(2, "acme/api")])

    response = watch(client, personal, 2)

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "github_repository_not_readable"
    assert client.get(WATCHED).json() == []


def test_watching_while_github_is_unavailable_is_retryable_and_saves_nothing(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    work = add_token(client, fake_github_source, WORK, "acme", [(2, "acme/api")])
    fake_github_source.register_repositories_error(WORK, TransientGitHubSourceError("503"))

    response = watch(client, work, 2)

    assert response.status_code == 502, response.text
    assert response.json()["error"]["code"] == "github_unavailable"
    assert client.get(WATCHED).json() == []
    assert [t["connection_state"] for t in client.get(TOKENS).json()] == ["connected"]


def test_watching_through_a_token_github_rejects_marks_it_as_needing_reconnection(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    work = add_token(client, fake_github_source, WORK, "acme", [(2, "acme/api")])
    fake_github_source.register_repositories_error(WORK, TerminalGitHubSourceError("revoked"))

    response = watch(client, work, 2)

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "github_token_rejected"
    assert client.get(WATCHED).json() == []
    assert [t["connection_state"] for t in client.get(TOKENS).json()] == ["needs_reconnect"]


def test_the_picker_says_which_tokens_read_no_repositories(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    # An organisation that has not yet approved the token: it validates,
    # but GitHub lists no repositories for it.
    add_token(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    work = add_token(client, fake_github_source, WORK, "acme", [])

    tokens = picker(client)["tokens"]

    assert [(t["id"], t["owner_login"], t["repository_count"]) for t in tokens] == [
        (tokens[0]["id"], "octocat", 1),
        (work, "acme", 0),
    ]


def test_a_token_github_is_briefly_unavailable_for_leaves_the_other_tokens_repositories(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    add_token(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    add_token(client, fake_github_source, WORK, "acme", [(2, "acme/api")])
    fake_github_source.register_repositories_error(WORK, TransientGitHubSourceError("rate limited"))

    body = picker(client)

    assert names(body) == ["octocat/dotfiles"]
    assert [(t["owner_login"], t["status"]) for t in body["tokens"]] == [
        ("octocat", "ok"),
        ("acme", "unavailable"),
    ]
    assert [t["connection_state"] for t in client.get(TOKENS).json()] == ["connected"] * 2


def test_a_token_github_rejects_is_marked_as_needing_reconnection(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    add_token(client, fake_github_source, PERSONAL, "octocat", [(1, "octocat/dotfiles")])
    add_token(client, fake_github_source, WORK, "acme", [(2, "acme/api")])
    fake_github_source.register_repositories_error(WORK, TerminalGitHubSourceError("revoked"))

    body = picker(client)

    assert names(body) == ["octocat/dotfiles"]
    assert [t["status"] for t in body["tokens"]] == ["ok", "needs_reconnect"]
    assert [t["connection_state"] for t in client.get(TOKENS).json()] == [
        "connected",
        "needs_reconnect",
    ]
