"""The admin users API (ADR 0018, issue #412): an Admin lists, creates,
disables, re-enables, promotes, demotes and resets the password of
accounts, and sees nothing of them beyond their account fields."""

import pytest
from fastapi.testclient import TestClient

from app.models import User
from tests.conftest import TEST_EMAIL, TEST_USERNAME, create_user_row, log_in, run_sql

USERS = "/api/v1/admin/users"
MEMBER_PASSWORD = "member-password"
TEMP_PASSWORD = "tulip-orbit-canvas-42"
# Nothing secret (hash, epoch, lockout) and nothing the User owns.
ACCOUNT_FIELDS = {
    "id",
    "username",
    "email",
    "is_admin",
    "is_active",
    "must_change_password",
    "must_complete_profile",
    "created_at",
    "last_active_at",
    # How the account signs in (issue #586): booleans and an email, no secret.
    "has_password",
    "google_email",
}
NEW_USER = {"username": "cy", "email": "cy@example.com", "temp_password": TEMP_PASSWORD}


def log_in_as_member(client: TestClient) -> int:
    """Swaps `client`'s session for a new non-admin User's; returns their id."""
    member = create_user_row(client, "bea", "bea@example.com", password=MEMBER_PASSWORD)
    client.cookies.clear()
    log_in(client, "bea", MEMBER_PASSWORD)
    return member.id


def signed_in_member(client: TestClient) -> tuple[User, TestClient]:
    """A new non-admin User signed in on a client of their own, next to
    `client`'s Admin session on the same app."""
    member = create_user_row(client, "bea", "bea@example.com", password=MEMBER_PASSWORD)
    member_client = TestClient(client.app)
    log_in(member_client, "bea", MEMBER_PASSWORD)
    assert member_client.get("/api/v1/tasks").status_code == 200
    return member, member_client


class TestNonAdmins:
    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("GET", USERS, None),
            ("POST", USERS, NEW_USER),
            ("PATCH", f"{USERS}/1", {"is_active": False}),
            ("DELETE", f"{USERS}/1", {"email": TEST_EMAIL}),
            ("POST", f"{USERS}/1/reset-password", {"temp_password": TEMP_PASSWORD}),
        ],
    )
    def test_are_refused_every_admin_endpoint(
        self, client: TestClient, method: str, path: str, body: dict[str, object] | None
    ) -> None:
        member_id = log_in_as_member(client)

        response = client.request(method, path, json=body)

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "admin_required"
        client.cookies.clear()
        log_in(client)
        assert [u["id"] for u in client.get(USERS).json()["items"]] == [1, member_id]
        assert client.get(USERS).json()["items"][0]["is_active"] is True


class TestOnlyAccountFieldsAreReturned:
    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("POST", USERS, NEW_USER),
            ("PATCH", f"{USERS}/2", {"is_admin": True}),
            ("POST", f"{USERS}/2/reset-password", {"temp_password": TEMP_PASSWORD}),
        ],
    )
    def test_by_every_write(
        self, client: TestClient, method: str, path: str, body: dict[str, object]
    ) -> None:
        create_user_row(client, "bea", "bea@example.com")

        response = client.request(method, path, json=body)

        assert response.status_code in (200, 201), response.text
        assert set(response.json()) == ACCOUNT_FIELDS

    def test_by_the_list(self, client: TestClient) -> None:
        create_user_row(client, "bea", "bea@example.com")

        items = client.get(USERS).json()["items"]

        assert [set(item) for item in items] == [ACCOUNT_FIELDS, ACCOUNT_FIELDS]


class TestCreatingAUser:
    def test_creates_an_account_holding_a_temporary_password(self, client: TestClient) -> None:
        response = client.post(USERS, json=NEW_USER)

        assert response.status_code == 201, response.text
        created = response.json()
        assert created | {"id": None, "created_at": None} == {
            "id": None,
            "username": "cy",
            "email": "cy@example.com",
            "is_admin": False,
            "is_active": True,
            "must_change_password": True,
            "must_complete_profile": False,
            "created_at": None,
            "last_active_at": None,
            "has_password": True,
            "google_email": None,
        }
        client.cookies.clear()
        log_in(client, "cy@example.com", TEMP_PASSWORD)
        me = client.get("/api/v1/auth/me").json()
        assert (me["id"], me["must_change_password"]) == (created["id"], True)
        assert client.get("/api/v1/tasks").json()["error"]["code"] == "password_change_required"

    def test_the_new_user_starts_with_their_own_settings_and_inbox(
        self, client: TestClient, database_url: str
    ) -> None:
        user_id = client.post(USERS, json=NEW_USER).json()["id"]

        assert run_sql(
            database_url, "SELECT count(*) FROM lists WHERE is_inbox AND owner_id = %s", [user_id]
        ) == [(1,)]
        assert run_sql(
            database_url, "SELECT count(*) FROM user_settings WHERE user_id = %s", [user_id]
        ) == [(1,)]

    def test_can_create_another_admin(self, client: TestClient) -> None:
        response = client.post(USERS, json={**NEW_USER, "is_admin": True})

        assert response.status_code == 201, response.text
        assert response.json()["is_admin"] is True

    @pytest.mark.parametrize(
        ("overrides", "code"),
        [
            ({"username": "ADMIN"}, "username_taken"),
            ({"email": "Admin@Example.com"}, "email_taken"),
        ],
    )
    def test_a_taken_username_or_email_is_reported_by_field(
        self, client: TestClient, overrides: dict[str, str], code: str
    ) -> None:
        response = client.post(USERS, json={**NEW_USER, **overrides})

        assert response.status_code == 409
        assert response.json()["error"]["code"] == code

    @pytest.mark.parametrize(
        ("overrides", "code"),
        [
            ({"username": "  "}, "invalid_username"),
            ({"email": "not-an-email"}, "invalid_email"),
            ({"temp_password": "too-short"}, "invalid_password"),
        ],
    )
    def test_rejects_an_invalid_field(
        self, client: TestClient, overrides: dict[str, str], code: str
    ) -> None:
        response = client.post(USERS, json={**NEW_USER, **overrides})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == code
        assert client.get(USERS).json()["total"] == 1


class TestDeletingAUser:
    def test_requires_matching_email_before_deleting(self, client: TestClient) -> None:
        bea, bea_client = signed_in_member(client)
        path = f"{USERS}/{bea.id}"

        for body in ({}, {"email": ""}, {"email": "wrong@example.com"}):
            response = client.request("DELETE", path, json=body)
            assert response.status_code == 422, response.text
            assert bea_client.get("/api/v1/tasks").status_code == 200

        response = client.request("DELETE", path, json={"email": "bea@example.com"})

        assert response.status_code == 204, response.text
        assert client.get(USERS).json()["total"] == 1
        assert bea_client.get("/api/v1/tasks").status_code == 401
        assert client.request("DELETE", path, json={"email": "bea@example.com"}).status_code == 404

    def test_deleting_last_password_does_not_reopen_setup(
        self, client: TestClient, database_url: str
    ) -> None:
        bea, _ = signed_in_member(client)
        run_sql(
            database_url,
            "UPDATE users SET is_admin = true, password_hash = NULL, "
            "google_subject = 'bea-google', google_email = email WHERE id = %s",
            [bea.id],
        )

        response = client.request("DELETE", f"{USERS}/1", json={"email": TEST_EMAIL})

        assert response.status_code == 204, response.text
        takeover = client.post(
            "/api/v1/auth/setup",
            json={
                "username": "intruder",
                "email": "intruder@example.com",
                "password": TEMP_PASSWORD,
            },
        )
        assert takeover.status_code == 404, takeover.text
        assert takeover.json()["error"]["message"] == "Setup has already been completed"

    def test_removes_invitations_and_receipts_but_preserves_other_peoples_links(
        self, client: TestClient, database_url: str
    ) -> None:
        bea, bea_client = signed_in_member(client)
        task = bea_client.post("/api/v1/tasks", json={"title": "private task"}).json()
        run_sql(
            database_url,
            "INSERT INTO task_creations "
            "(owner_id, request_id, task_id) VALUES (%s, 'private-request', %s)",
            [bea.id, task["id"]],
        )
        run_sql(
            database_url,
            "INSERT INTO invitations "
            "(email, token_hash, encrypted_token, invited_by_id, accepted_user_id, "
            "expires_at, delivery_state, created_at, updated_at) VALUES "
            "('bea@example.com', 'bea-token', 'secret', 1, %s, now(), 'not_sent', now(), now()), "
            "('guest@example.com', 'guest-token', 'secret', %s, NULL, "
            "now() + interval '1 day', 'not_sent', now(), now())",
            [bea.id, bea.id],
        )

        response = client.request("DELETE", f"{USERS}/{bea.id}", json={"email": bea.email})

        assert response.status_code == 204, response.text
        assert run_sql(database_url, "SELECT email, invited_by_id FROM invitations") == [
            ("guest@example.com", None)
        ]
        assert run_sql(
            database_url, "SELECT count(*) FROM task_creations WHERE owner_id = %s", [bea.id]
        ) == [(0,)]
        assert (
            client.post(USERS, json={**NEW_USER, "username": "bea", "email": bea.email}).status_code
            == 201
        )

    @pytest.mark.parametrize("kind", ["api", "mcp"])
    def test_erases_tokens_and_cached_integration_data(self, client: TestClient, kind: str) -> None:
        bea, bea_client = signed_in_member(client)
        token = bea_client.post("/api/v1/auth/me/tokens", json={"name": "client", "kind": kind})
        assert token.status_code == 201, token.text
        app = client.app
        app.state.event_cache.set(bea.id, "primary", "start", "end", [])
        app.state.event_cache.set(1, "primary", "start", "end", [])
        caches = [app.state.github_pull_request_cache, app.state.github_issue_cache]
        for cache in caches:
            cache.store(bea.id, 100, frozenset(), [])
            cache.store(1, 101, frozenset(), [])

        response = client.request("DELETE", f"{USERS}/{bea.id}", json={"email": bea.email})

        assert response.status_code == 204, response.text
        assert app.state.event_cache.get(bea.id, "primary", "start", "end") is None
        assert app.state.event_cache.get(1, "primary", "start", "end") == []
        for cache in caches:
            assert cache.stale(bea.id, 100) is None
            assert cache.stale(1, 101) is not None
        bea_client.cookies.clear()
        refused = bea_client.get(
            "/api/v1/tasks", headers={"Authorization": f"Bearer {token.json()['token']}"}
        )
        assert refused.status_code == 401, refused.text

    def test_cannot_delete_last_active_admin(self, client: TestClient) -> None:
        response = client.request("DELETE", f"{USERS}/1", json={"email": TEST_EMAIL})

        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "last_admin"
        assert client.get(USERS).json()["total"] == 1


class TestDisablingAUser:
    def test_logs_them_out_at_once(self, client: TestClient) -> None:
        bea, bea_client = signed_in_member(client)

        response = client.patch(f"{USERS}/{bea.id}", json={"is_active": False})

        assert response.status_code == 200, response.text
        assert response.json()["is_active"] is False
        refused = bea_client.get("/api/v1/tasks")
        assert refused.status_code == 401
        assert refused.json()["error"]["code"] == "account_disabled"

    def test_they_can_no_longer_log_in(self, client: TestClient) -> None:
        bea, bea_client = signed_in_member(client)
        client.patch(f"{USERS}/{bea.id}", json={"is_active": False})

        response = bea_client.post(
            "/api/v1/auth/login", json={"login": "bea", "password": MEMBER_PASSWORD}
        )

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "account_disabled"

    def test_re_enabling_does_not_revive_old_sessions(self, client: TestClient) -> None:
        bea, bea_client = signed_in_member(client)
        client.patch(f"{USERS}/{bea.id}", json={"is_active": False})

        response = client.patch(f"{USERS}/{bea.id}", json={"is_active": True})

        assert response.status_code == 200, response.text
        assert response.json()["is_active"] is True
        assert bea_client.get("/api/v1/tasks").status_code == 401
        log_in(bea_client, "bea", MEMBER_PASSWORD)
        assert bea_client.get("/api/v1/tasks").status_code == 200

    def test_an_unknown_user_is_not_found(self, client: TestClient) -> None:
        response = client.patch(f"{USERS}/999", json={"is_active": False})

        assert response.status_code == 404


class TestChangingRoles:
    def test_a_promoted_member_can_manage_accounts_at_once(self, client: TestClient) -> None:
        bea, bea_client = signed_in_member(client)

        response = client.patch(f"{USERS}/{bea.id}", json={"is_admin": True})

        assert response.status_code == 200, response.text
        assert response.json()["is_admin"] is True
        assert bea_client.get(USERS).status_code == 200

    def test_a_demoted_admin_loses_access_at_once(self, client: TestClient) -> None:
        bea, bea_client = signed_in_member(client)
        client.patch(f"{USERS}/{bea.id}", json={"is_admin": True})

        response = client.patch(f"{USERS}/{bea.id}", json={"is_admin": False})

        assert response.status_code == 200, response.text
        assert response.json()["is_admin"] is False
        assert bea_client.get(USERS).status_code == 403


class TestTheLastActiveAdmin:
    @pytest.mark.parametrize("change", [{"is_admin": False}, {"is_active": False}])
    def test_cannot_be_demoted_or_disabled(
        self, client: TestClient, change: dict[str, bool]
    ) -> None:
        create_user_row(client, "bea", "bea@example.com")

        response = client.patch(f"{USERS}/1", json=change)

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "last_admin"
        me = client.get(USERS).json()["items"][0]
        assert (me["is_admin"], me["is_active"]) == (True, True)

    def test_a_disabled_admin_does_not_count(self, client: TestClient) -> None:
        create_user_row(client, "bea", "bea@example.com", is_admin=True, is_active=False)

        response = client.patch(f"{USERS}/1", json={"is_admin": False})

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "last_admin"

    @pytest.mark.parametrize("change", [{"is_admin": False}, {"is_active": False}])
    def test_with_another_active_admin_either_can_step_down(
        self, client: TestClient, change: dict[str, bool]
    ) -> None:
        create_user_row(client, "bea", "bea@example.com", is_admin=True)

        response = client.patch(f"{USERS}/1", json=change)

        assert response.status_code == 200, response.text


class TestResettingAPassword:
    def test_logs_them_out_and_requires_a_new_password(self, client: TestClient) -> None:
        bea, bea_client = signed_in_member(client)

        response = client.post(
            f"{USERS}/{bea.id}/reset-password", json={"temp_password": TEMP_PASSWORD}
        )

        assert response.status_code == 200, response.text
        assert response.json()["must_change_password"] is True
        refused = bea_client.get("/api/v1/tasks")
        assert (refused.status_code, refused.json()["error"]["code"]) == (401, "unauthorized")
        old = bea_client.post(
            "/api/v1/auth/login", json={"login": "bea", "password": MEMBER_PASSWORD}
        )
        assert old.status_code == 401
        log_in(bea_client, "bea", TEMP_PASSWORD)
        blocked = bea_client.get("/api/v1/tasks")
        assert (blocked.status_code, blocked.json()["error"]["code"]) == (
            403,
            "password_change_required",
        )

    def test_unlocks_a_locked_out_user(self, client: TestClient) -> None:
        bea, bea_client = signed_in_member(client)
        for _ in range(5):
            bea_client.post("/api/v1/auth/login", json={"login": "bea", "password": "wrong"})
        locked = bea_client.post(
            "/api/v1/auth/login", json={"login": "bea", "password": MEMBER_PASSWORD}
        )
        assert locked.status_code == 429

        client.post(f"{USERS}/{bea.id}/reset-password", json={"temp_password": TEMP_PASSWORD})

        log_in(bea_client, "bea", TEMP_PASSWORD)

    def test_rejects_a_short_temporary_password(self, client: TestClient) -> None:
        bea, bea_client = signed_in_member(client)

        response = client.post(
            f"{USERS}/{bea.id}/reset-password", json={"temp_password": "too-short"}
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_password"
        assert bea_client.get("/api/v1/tasks").status_code == 200

    def test_an_unknown_user_is_not_found(self, client: TestClient) -> None:
        response = client.post(f"{USERS}/999/reset-password", json={"temp_password": TEMP_PASSWORD})

        assert response.status_code == 404


class TestListingUsers:
    def test_an_admin_sees_every_account(self, client: TestClient) -> None:
        bea = create_user_row(client, "bea", "bea@example.com", must_change_password=True)

        response = client.get(USERS)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["total"] == 2
        assert [(u["id"], u["username"], u["email"]) for u in body["items"]] == [
            (1, TEST_USERNAME, TEST_EMAIL),
            (bea.id, "bea", "bea@example.com"),
        ]
        assert body["items"][1] | {"created_at": None} == {
            "id": bea.id,
            "username": "bea",
            "email": "bea@example.com",
            "is_admin": False,
            "is_active": True,
            "must_change_password": True,
            "must_complete_profile": False,
            "created_at": None,
            "last_active_at": None,
            "has_password": True,
            "google_email": None,
        }
