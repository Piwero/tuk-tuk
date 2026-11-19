"""API tokens (ADR 0014 amendment, ADR 0018, issue #413): a User's named,
revocable credentials for clients that cannot log in with a password, such
as an in-cluster MCP server. Exercised over HTTP only: create, list and
revoke with the signed-in session, then authenticate with
`Authorization: Bearer <token>`.
"""

import hashlib
import re
from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import TEST_PASSWORD, FakeClock, create_user_row, log_in, run_sql

TOKENS = "/api/v1/auth/me/tokens"


def create_token(client: TestClient, name: str = "laptop") -> dict[str, Any]:
    response = client.post(TOKENS, json={"name": name})
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def iso(moment: datetime) -> str:
    return moment.isoformat().replace("+00:00", "Z")


def as_token(client: TestClient, token: str, method: str, path: str, **kwargs: Any) -> Any:
    """A request carrying only the token: the session cookie is dropped."""
    client.cookies.clear()
    return client.request(method, path, headers=bearer(token), **kwargs)


class TestCreating:
    def test_the_value_is_returned_once_with_a_recognisable_prefix(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        created = create_token(client, "  Claude on laptop  ")

        assert re.fullmatch(r"tuk_pat_1_[0-9a-f]{64}", created["token"])
        assert created["prefix"] == created["token"][: len("tuk_pat_1_") + 8]
        assert created["name"] == "Claude on laptop"
        assert created["last_used_at"] is None
        assert created["created_at"] == iso(fake_clock.now)
        [listed] = client.get(TOKENS).json()["items"]
        assert listed == {k: v for k, v in created.items() if k != "token"}

    def test_only_a_hash_of_the_value_is_stored(
        self, client: TestClient, database_url: str
    ) -> None:
        token = create_token(client)["token"]

        [row] = run_sql(database_url, "SELECT * FROM api_tokens")
        assert token not in [str(column) for column in row]
        assert hashlib.sha256(token.encode()).hexdigest() in row

    def test_every_token_is_different(self, client: TestClient) -> None:
        assert create_token(client)["token"] != create_token(client)["token"]

    @pytest.mark.parametrize("name", ["", "   ", "x" * 101])
    def test_a_token_needs_a_name_of_1_to_100_characters(
        self, client: TestClient, name: str
    ) -> None:
        response = client.post(TOKENS, json={"name": name})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_token_name"


class TestAuthenticating:
    def test_a_token_acts_as_the_user_who_created_it(self, client: TestClient) -> None:
        create_user_row(client, "bea", "bea@example.com")
        client.cookies.clear()
        log_in(client, "bea", TEST_PASSWORD)
        token = create_token(client)["token"]

        response = as_token(client, token, "GET", "/api/v1/auth/me")

        assert response.status_code == 200, response.text
        assert response.json()["username"] == "bea"

    @pytest.mark.parametrize(
        "header",
        [
            "Bearer tuk_pat_1_" + "0" * 64,
            "Bearer tuk_pat_2_" + "0" * 64,
            "Bearer not-a-token",
            "Bearer ",
        ],
    )
    def test_an_unknown_token_gets_401(self, client: TestClient, header: str) -> None:
        create_token(client)
        client.cookies.clear()

        response = client.get("/api/v1/tasks", headers={"Authorization": header})

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"

    def test_another_users_id_in_the_token_matches_nothing(self, client: TestClient) -> None:
        """The id in a token only says whose tokens to search."""
        create_user_row(client, "bea", "bea@example.com")
        token = create_token(client)["token"]
        forged = token.replace("tuk_pat_1_", "tuk_pat_2_", 1)

        assert as_token(client, forged, "GET", "/api/v1/tasks").status_code == 401

    def test_a_bearer_token_decides_even_alongside_a_valid_cookie(self, client: TestClient) -> None:
        response = client.get(
            "/api/v1/tasks", headers={"Authorization": "Bearer tuk_pat_1_" + "0" * 64}
        )

        assert response.status_code == 401


def bea_with_token(client: TestClient) -> tuple[int, str]:
    """A second User, Bea, with a token of hers; `client` is left signed
    in as the admin."""
    bea = create_user_row(client, "bea", "bea@example.com")
    client.cookies.clear()
    log_in(client, "bea", TEST_PASSWORD)
    token = create_token(client)["token"]
    client.cookies.clear()
    log_in(client)
    return bea.id, token


class TestUserChecks:
    """The same checks as the session cookie (an active User with no
    forced step pending), but not the session epoch."""

    def test_a_disabled_users_token_gets_401_account_disabled(self, client: TestClient) -> None:
        bea_id, token = bea_with_token(client)
        client.patch(f"/api/v1/admin/users/{bea_id}", json={"is_active": False})

        response = as_token(client, token, "GET", "/api/v1/tasks")

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "account_disabled"

    def test_a_forced_step_blocks_the_token_until_it_is_completed(self, client: TestClient) -> None:
        bea_id, token = bea_with_token(client)
        new_password = "a-brand-new-password"
        client.post(
            f"/api/v1/admin/users/{bea_id}/reset-password", json={"temp_password": "temporary-pw-1"}
        )

        blocked = as_token(client, token, "GET", "/api/v1/tasks")
        assert blocked.status_code == 403
        assert blocked.json()["error"]["code"] == "password_change_required"

        log_in(client, "bea", "temporary-pw-1")
        client.post("/api/v1/auth/complete", json={"new_password": new_password})
        assert as_token(client, token, "GET", "/api/v1/tasks").status_code == 200

    def test_changing_the_password_does_not_end_a_token(self, client: TestClient) -> None:
        """Logging out every session (the epoch) leaves tokens alone: each
        is revoked on its own (ADR 0018)."""
        token = create_token(client)["token"]
        changed = client.post(
            "/api/v1/auth/password",
            json={"current_password": TEST_PASSWORD, "new_password": "a-brand-new-password"},
        )
        assert changed.status_code == 204

        assert as_token(client, token, "GET", "/api/v1/tasks").status_code == 200


class TestWhatATokenCannotDo:
    """A stolen token must stay a credential its owner can revoke: it
    cannot mint a replacement, take over the password or the account, or
    (for an Admin's token) manage other accounts."""

    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("POST", TOKENS, {"name": "replacement"}),
            (
                "POST",
                "/api/v1/auth/password",
                {"current_password": TEST_PASSWORD, "new_password": "a-brand-new-password"},
            ),
            ("POST", "/api/v1/auth/complete", {"new_password": "a-brand-new-password"}),
            ("PATCH", "/api/v1/auth/me", {"email": "attacker@example.com"}),
            ("GET", "/api/v1/admin/users", None),
            ("POST", "/api/v1/admin/users/1/reset-password", {"temp_password": "x" * 12}),
            ("GET", "/api/v1/settings/database", None),
            (
                "POST",
                "/api/v1/settings/database/test-connection",
                {"connection_url": "postgresql://x/y"},
            ),
        ],
    )
    def test_account_and_credential_changes_need_a_password_session(
        self, client: TestClient, method: str, path: str, body: dict[str, Any] | None
    ) -> None:
        token = create_token(client)["token"]

        response = as_token(client, token, method, path, json=body)

        assert response.status_code == 403, response.text
        assert response.json()["error"]["code"] == "token_not_allowed"
        log_in(client)
        assert len(client.get(TOKENS).json()["items"]) == 1
        assert client.get("/api/v1/auth/me").json()["email"] == "admin@example.com"

    def test_a_token_can_list_tokens_and_revoke_one(self, client: TestClient) -> None:
        """Listing is harmless, and a client can retire its own token."""
        token = create_token(client)
        assert as_token(client, token["token"], "GET", TOKENS).status_code == 200

        revoked = as_token(client, token["token"], "DELETE", f"{TOKENS}/{token['id']}")

        assert revoked.status_code == 204
        assert as_token(client, token["token"], "GET", TOKENS).status_code == 401


class TestLastUsed:
    def listed(self, client: TestClient) -> Any:
        log_in(client)
        [token] = client.get(TOKENS).json()["items"]
        return token["last_used_at"]

    def test_is_set_when_the_token_authenticates_a_request(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        token = create_token(client)["token"]
        fake_clock.advance(timedelta(hours=1))

        as_token(client, token, "GET", "/api/v1/tasks")

        assert self.listed(client) == iso(fake_clock.now)

    def test_is_written_at_most_every_few_minutes(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        token = create_token(client)["token"]
        as_token(client, token, "GET", "/api/v1/tasks")
        first_use = fake_clock.now

        fake_clock.advance(timedelta(minutes=4))
        as_token(client, token, "GET", "/api/v1/tasks")
        assert self.listed(client) == iso(first_use)

        fake_clock.advance(timedelta(minutes=2))
        as_token(client, token, "GET", "/api/v1/tasks")
        assert self.listed(client) == iso(fake_clock.now)

    def test_a_refused_request_does_not_count_as_a_use(self, client: TestClient) -> None:
        token = create_token(client)["token"]

        as_token(client, token, "POST", TOKENS, json={"name": "replacement"})

        assert self.listed(client) is None


class TestOwnerActivity:
    """A token's requests are its owner being active (issue #478), under
    the same rules as a session's."""

    def bea_last_active(self, client: TestClient, bea_id: int) -> Any:
        log_in(client)
        users = client.get("/api/v1/admin/users").json()["items"]
        return next(u["last_active_at"] for u in users if u["id"] == bea_id)

    def test_a_served_token_request_marks_the_owner_active(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        bea_id, token = bea_with_token(client)
        fake_clock.advance(timedelta(hours=1))

        as_token(client, token, "GET", "/api/v1/tasks")

        assert self.bea_last_active(client, bea_id) == iso(fake_clock.now)

    def test_a_refused_token_request_does_not(
        self, client: TestClient, fake_clock: FakeClock
    ) -> None:
        bea_id, token = bea_with_token(client)
        signed_in = self.bea_last_active(client, bea_id)
        fake_clock.advance(timedelta(hours=1))

        as_token(client, token, "POST", TOKENS, json={"name": "replacement"})

        assert self.bea_last_active(client, bea_id) == signed_in


class TestRevoking:
    def test_a_revoked_token_gets_401(self, client: TestClient) -> None:
        created = create_token(client)
        assert client.delete(f"{TOKENS}/{created['id']}").status_code == 204

        response = as_token(client, created["token"], "GET", "/api/v1/tasks")

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"

    def test_a_revoked_token_leaves_the_list_and_others_keep_working(
        self, client: TestClient
    ) -> None:
        kept = create_token(client, "kept")
        revoked = create_token(client, "revoked")
        client.delete(f"{TOKENS}/{revoked['id']}")

        assert [t["name"] for t in client.get(TOKENS).json()["items"]] == ["kept"]
        assert as_token(client, kept["token"], "GET", "/api/v1/tasks").status_code == 200

    def test_revoking_an_unknown_or_already_revoked_token_is_404(self, client: TestClient) -> None:
        created = create_token(client)
        client.delete(f"{TOKENS}/{created['id']}")

        for token_id in (created["id"], 9999):
            response = client.delete(f"{TOKENS}/{token_id}")
            assert response.status_code == 404
            assert response.json()["error"]["code"] == "not_found"
