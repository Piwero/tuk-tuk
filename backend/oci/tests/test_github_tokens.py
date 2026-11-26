"""Adding and removing GitHub Tokens (issue #578, spec #576).

Driven through the HTTP API with the fake GitHub source: a test registers
what a pasted token identifies as, then pastes it as a User would.
"""

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.crypto import decrypt_credential
from app.github_source import TransientGitHubSourceError
from tests.conftest import FakeGitHubSource, run_sql

TOKENS = "/api/v1/github/tokens"
FINE_GRAINED = "github_pat_11AAAAAAA0personal"


def test_a_fine_grained_token_github_accepts_is_saved_and_listed_by_owner(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    fake_github_source.register_token(FINE_GRAINED, owner_login="octocat", owner_kind="user")

    created = client.post(TOKENS, json={"token": FINE_GRAINED})

    assert created.status_code == 201, created.text
    assert created.json()["owner_login"] == "octocat"
    listed = client.get(TOKENS)
    assert listed.status_code == 200
    assert [(t["owner_login"], t["owner_kind"], t["connection_state"]) for t in listed.json()] == [
        ("octocat", "user", "connected")
    ]


def test_a_classic_token_is_refused_with_an_explanation_and_not_saved(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    classic = "ghp_classic_example"
    fake_github_source.register_token(classic, owner_login="octocat", token_type="classic")

    response = client.post(TOKENS, json={"token": classic})

    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["code"] == "github_token_not_fine_grained"
    assert "fine-grained" in error["message"]
    assert client.get(TOKENS).json() == []


def test_something_that_is_not_a_fine_grained_token_is_refused_without_asking_github(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    response = client.post(TOKENS, json={"token": "my password"})

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "github_token_not_fine_grained"
    assert fake_github_source.identify_calls == []
    assert client.get(TOKENS).json() == []


def test_a_token_github_rejects_is_not_saved_and_the_user_is_told_why(
    client: TestClient,
) -> None:
    # Never registered with the fake: GitHub answers 401 Bad credentials.
    response = client.post(TOKENS, json={"token": "github_pat_11AAAAAAA0mistyped"})

    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["code"] == "github_token_rejected"
    assert "GitHub rejected" in error["message"]
    assert client.get(TOKENS).json() == []


def test_a_transient_github_failure_is_reported_as_retryable_and_nothing_is_saved(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    fake_github_source.register_identify_error(
        FINE_GRAINED, TransientGitHubSourceError("rate limited")
    )

    response = client.post(TOKENS, json={"token": FINE_GRAINED})

    assert response.status_code == 502, response.text
    error = response.json()["error"]
    assert error["code"] == "github_unavailable"
    assert "try again" in error["message"]
    assert client.get(TOKENS).json() == []


def test_a_second_token_for_an_owner_already_covered_is_refused(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    second = "github_pat_11AAAAAAA0another"
    fake_github_source.register_token(FINE_GRAINED, owner_login="acme", owner_kind="organization")
    fake_github_source.register_token(second, owner_login="acme", owner_kind="organization")
    assert client.post(TOKENS, json={"token": FINE_GRAINED}).status_code == 201

    response = client.post(TOKENS, json={"token": second})

    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "github_token_owner_exists"
    assert [t["owner_login"] for t in client.get(TOKENS).json()] == ["acme"]


def test_the_token_is_stored_encrypted_and_never_returned(
    client: TestClient, fake_github_source: FakeGitHubSource, database_url: str
) -> None:
    fake_github_source.register_token(FINE_GRAINED, owner_login="octocat")

    created = client.post(TOKENS, json={"token": FINE_GRAINED})

    assert FINE_GRAINED not in created.text
    assert FINE_GRAINED not in client.get(TOKENS).text
    [(stored,)] = run_sql(database_url, "SELECT encrypted_token FROM github_tokens")
    assert FINE_GRAINED not in stored
    assert decrypt_credential(stored, key="test-master-key") == FINE_GRAINED


def test_the_tokens_expiry_is_listed(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    expires = datetime(2027, 2, 1, 8, 0, tzinfo=UTC)
    fake_github_source.register_token(FINE_GRAINED, owner_login="octocat", expires_at=expires)
    client.post(TOKENS, json={"token": FINE_GRAINED})

    [listed] = client.get(TOKENS).json()

    assert datetime.fromisoformat(listed["expires_at"]) == expires


def test_removing_a_github_token_deletes_it(
    client: TestClient, fake_github_source: FakeGitHubSource
) -> None:
    fake_github_source.register_token(FINE_GRAINED, owner_login="octocat")
    token_id = client.post(TOKENS, json={"token": FINE_GRAINED}).json()["id"]

    response = client.delete(f"{TOKENS}/{token_id}")

    assert response.status_code == 204, response.text
    assert client.get(TOKENS).json() == []
    assert client.delete(f"{TOKENS}/{token_id}").status_code == 404
