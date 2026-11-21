"""MCP tokens and the MCP token exchange (issue #525, ADR 0016's
amendment): a User's credential whose audience is the shared MCP server,
never the API. The MCP server trades one, with the deployment's MCP service
key, for a short-lived access credential that acts as the token's owner.
Exercised over HTTP only.
"""

import re
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import (
    TEST_PASSWORD,
    FakeCalendarSource,
    FakeClock,
    create_user_row,
    log_in,
    make_task,
)

TOKENS = "/api/v1/auth/me/tokens"
EXCHANGE = "/api/v1/auth/mcp/exchange"
SERVICE_KEY = "s" * 48


@pytest.fixture
def client(
    database_url: str, fake_clock: FakeClock, fake_calendar_source: FakeCalendarSource
) -> Iterator[TestClient]:
    """The usual signed-in admin, on a deployment that runs the shared MCP
    server (MCP_SERVICE_KEY set)."""
    app = create_app(
        Settings(database_url=database_url, mcp_service_key=SERVICE_KEY),
        clock=fake_clock,
        calendar_source=fake_calendar_source,
    )
    with TestClient(app) as test_client:
        create_user_row(app, first_admin=True)
        log_in(test_client)
        yield test_client


def create_mcp_token(client: TestClient, name: str = "Claude Code") -> dict[str, Any]:
    response = client.post(TOKENS, json={"name": name, "kind": "mcp"})
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


class TestCreating:
    def test_an_mcp_token_has_its_own_prefix_and_kind(self, client: TestClient) -> None:
        created = create_mcp_token(client)

        assert re.fullmatch(r"tuk_mcp_1_[0-9a-f]{64}", created["token"])
        assert created["kind"] == "mcp"
        assert created["prefix"] == created["token"][: len("tuk_mcp_1_") + 8]
        [listed] = client.get(TOKENS).json()["items"]
        assert listed["kind"] == "mcp"

    def test_a_token_is_an_api_token_unless_asked_otherwise(self, client: TestClient) -> None:
        created = client.post(TOKENS, json={"name": "laptop"}).json()

        assert created["kind"] == "api"
        assert created["token"].startswith("tuk_pat_1_")

    def test_an_unknown_kind_is_rejected(self, client: TestClient) -> None:
        response = client.post(TOKENS, json={"name": "x", "kind": "admin"})

        assert response.status_code == 422


def exchange(client: TestClient, token: str, key: str = SERVICE_KEY) -> Any:
    """The MCP server's call: its service key as the bearer, the User's MCP
    token in the body. No cookie travels with it."""
    client.cookies.clear()
    return client.post(EXCHANGE, json={"token": token}, headers=bearer(key))


def bearer(credential: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {credential}"}


def as_access(client: TestClient, access: str, method: str, path: str, **kwargs: Any) -> Any:
    client.cookies.clear()
    return client.request(method, path, headers=bearer(access), **kwargs)


class TestExchanging:
    def test_the_access_credential_acts_as_the_tokens_owner(self, client: TestClient) -> None:
        make_task(client, "admin's task")
        create_user_row(client, "bea", "bea@example.com")
        client.cookies.clear()
        log_in(client, "bea", TEST_PASSWORD)
        make_task(client, "bea's task")
        token = create_mcp_token(client)

        response = exchange(client, token["token"])

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["user_id"] == 2
        assert body["token_id"] == token["id"]
        assert body["expires_in"] == 120
        tasks = as_access(client, body["access_token"], "GET", "/api/v1/tasks").json()
        assert [t["title"] for t in tasks["items"]] == ["bea's task"]

    def test_the_api_never_accepts_an_mcp_token_itself(self, client: TestClient) -> None:
        token = create_mcp_token(client)["token"]

        response = as_access(client, token, "GET", "/api/v1/tasks")

        assert response.status_code == 401


def bea_with_mcp_token(client: TestClient) -> tuple[int, str]:
    """A second User, Bea, with an MCP token of hers; `client` is left
    signed in as the admin."""
    bea = create_user_row(client, "bea", "bea@example.com")
    client.cookies.clear()
    log_in(client, "bea", TEST_PASSWORD)
    token = create_mcp_token(client)["token"]
    client.cookies.clear()
    log_in(client)
    return bea.id, token


def error_code(response: Any) -> str:
    code: str = response.json()["error"]["code"]
    return code


class TestTheServiceKey:
    def test_without_a_configured_key_there_is_no_exchange(
        self, unauthenticated_client: TestClient
    ) -> None:
        log_in(unauthenticated_client)
        token = create_mcp_token(unauthenticated_client)["token"]

        assert exchange(unauthenticated_client, token).status_code == 404

    @pytest.mark.parametrize("key", ["", "s" * 47, "x" * 48, SERVICE_KEY + "s"])
    def test_a_missing_or_wrong_key_gets_401(self, client: TestClient, key: str) -> None:
        token = create_mcp_token(client)["token"]

        response = exchange(client, token, key)

        assert response.status_code == 401
        assert error_code(response) == "unauthorized"
        assert "access_token" not in response.text

    def test_a_users_session_is_not_a_service_key(self, client: TestClient) -> None:
        token = create_mcp_token(client)["token"]

        response = client.post(EXCHANGE, json={"token": token})

        assert response.status_code == 401


class TestTheMcpToken:
    @pytest.mark.parametrize(
        "token", ["", "not-a-token", "tuk_mcp_1_" + "0" * 64, "tuk_mcp_2_" + "0" * 64]
    )
    def test_an_unknown_or_malformed_token_gets_401(self, client: TestClient, token: str) -> None:
        create_mcp_token(client)

        response = exchange(client, token)

        assert response.status_code == 401
        assert error_code(response) == "invalid_mcp_token"

    def test_an_api_token_is_not_an_mcp_token(self, client: TestClient) -> None:
        api_token = client.post(TOKENS, json={"name": "laptop"}).json()["token"]

        assert error_code(exchange(client, api_token)) == "invalid_mcp_token"
        mcp_shaped = api_token.replace("tuk_pat_", "tuk_mcp_", 1)
        assert error_code(exchange(client, mcp_shaped)) == "invalid_mcp_token"

    def test_a_revoked_token_gets_401(self, client: TestClient) -> None:
        created = create_mcp_token(client)
        client.delete(f"{TOKENS}/{created['id']}")

        assert error_code(exchange(client, created["token"])) == "invalid_mcp_token"

    def test_a_disabled_users_token_gets_401_account_disabled(self, client: TestClient) -> None:
        bea_id, token = bea_with_mcp_token(client)
        client.patch(f"/api/v1/admin/users/{bea_id}", json={"is_active": False})

        response = exchange(client, token)

        assert response.status_code == 401
        assert error_code(response) == "account_disabled"

    def test_a_forced_step_blocks_the_exchange(self, client: TestClient) -> None:
        bea_id, token = bea_with_mcp_token(client)
        client.post(
            f"/api/v1/admin/users/{bea_id}/reset-password", json={"temp_password": "temporary-pw-1"}
        )

        response = exchange(client, token)

        assert response.status_code == 403
        assert error_code(response) == "password_change_required"


class TestTheAccessCredential:
    def test_it_expires_after_two_minutes(self, client: TestClient, fake_clock: FakeClock) -> None:
        access = exchange(client, create_mcp_token(client)["token"]).json()["access_token"]

        fake_clock.advance(timedelta(seconds=119))
        assert as_access(client, access, "GET", "/api/v1/tasks").status_code == 200
        fake_clock.advance(timedelta(seconds=1))
        assert as_access(client, access, "GET", "/api/v1/tasks").status_code == 401

    def test_revoking_the_mcp_token_cuts_off_an_issued_credential(self, client: TestClient) -> None:
        created = create_mcp_token(client)
        access = exchange(client, created["token"]).json()["access_token"]
        log_in(client)
        client.delete(f"{TOKENS}/{created['id']}")

        assert as_access(client, access, "GET", "/api/v1/tasks").status_code == 401

    def test_disabling_the_user_cuts_off_an_issued_credential(self, client: TestClient) -> None:
        bea_id, token = bea_with_mcp_token(client)
        access = exchange(client, token).json()["access_token"]
        log_in(client)
        client.patch(f"/api/v1/admin/users/{bea_id}", json={"is_active": False})

        response = as_access(client, access, "GET", "/api/v1/tasks")

        assert response.status_code == 401
        assert error_code(response) == "account_disabled"

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("POST", TOKENS),
            ("POST", "/api/v1/auth/password"),
            ("PATCH", "/api/v1/auth/me"),
            ("GET", "/api/v1/admin/users"),
            ("GET", "/api/v1/settings/database"),
        ],
    )
    def test_it_cannot_do_what_an_api_token_cannot(
        self, client: TestClient, method: str, path: str
    ) -> None:
        access = exchange(client, create_mcp_token(client)["token"]).json()["access_token"]

        response = as_access(client, access, method, path, json={})

        assert response.status_code == 403
        assert error_code(response) == "token_not_allowed"

    def test_a_tampered_credential_gets_401(self, client: TestClient) -> None:
        access = exchange(client, create_mcp_token(client)["token"]).json()["access_token"]
        tampered = access[:-2] + ("AA" if not access.endswith("AA") else "BB")

        assert as_access(client, tampered, "GET", "/api/v1/tasks").status_code == 401

    def test_it_is_not_a_session_cookie(self, client: TestClient) -> None:
        access = exchange(client, create_mcp_token(client)["token"]).json()["access_token"]
        client.cookies.clear()

        response = client.get("/api/v1/tasks", cookies={"tuktuk_session": access})

        assert response.status_code == 401


class TestTheAccessCredentialReachesOnlyTheMcpTools:
    """It is a bearer for its two minutes, so it reaches no further than
    the MCP server's tools need: no delete, no tokens, no settings."""

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("DELETE", "/api/v1/tasks/{task}"),
            ("DELETE", f"{TOKENS}/1"),
            ("GET", TOKENS),
            ("GET", "/api/v1/auth/me"),
            ("POST", "/api/v1/lists"),
            ("GET", "/api/v1/settings"),
            ("DELETE", "/api/v1/habits/1/check-ins/2026-01-01"),
        ],
    )
    def test_anything_else_is_refused(self, client: TestClient, method: str, path: str) -> None:
        task = make_task(client, "keep me")
        access = exchange(client, create_mcp_token(client)["token"]).json()["access_token"]

        response = as_access(client, access, method, path.format(task=task["id"]), json={})

        assert response.status_code == 403
        assert error_code(response) == "token_not_allowed"
        log_in(client)
        assert client.get(f"/api/v1/tasks/{task['id']}").status_code == 200

    def test_the_tool_routes_are_open(self, client: TestClient) -> None:
        task = make_task(client, "plan")
        access = exchange(client, create_mcp_token(client)["token"]).json()["access_token"]

        for method, path, body in [
            ("GET", "/api/v1/tasks", None),
            ("GET", f"/api/v1/tasks/{task['id']}", None),
            ("PATCH", f"/api/v1/tasks/{task['id']}", {"priority": "high"}),
            ("POST", "/api/v1/tasks", {"title": "new"}),
            ("POST", f"/api/v1/tasks/{task['id']}/check-items", {"title": "step"}),
            ("GET", "/api/v1/lists", None),
            ("GET", "/api/v1/tags", None),
            ("GET", "/api/v1/habits?due=2026-01-01", None),
            ("GET", "/api/v1/goals", None),
            ("GET", "/api/v1/focus-stats?start=2026-01-01&end=2026-01-07&tz=UTC", None),
            ("GET", "/api/v1/events?start=2026-01-01&end=2026-01-07", None),
        ]:
            response = as_access(client, access, method, path, json=body)
            assert response.status_code != 403, (method, path, response.text)
            assert response.status_code != 401, (method, path, response.text)
