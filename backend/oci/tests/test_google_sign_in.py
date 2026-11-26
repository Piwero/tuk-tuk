"""Invite-only Google sign-in (issue #586): accepting an invitation with
the invited Google account, signing in with Google afterwards, linking
Google to an existing account, and an Admin's recovery.

Every OAuth round trip is driven as a browser would: a POST to start it
(the app answers Google's authorization URL and sets the transaction
cookie), then the callback with the code and state Google would send. The
fake Google checks the PKCE verifier against the challenge in that URL and
signs a real ID token carrying its nonce, so nothing reaches into the
router to forge either.
"""

import asyncio
from collections.abc import Iterator
from datetime import timedelta
from itertools import count
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import (
    TEST_PASSWORD,
    FakeCalendarSource,
    FakeClock,
    FakeGoogleSignIn,
    FakeMailer,
    create_user_row,
    log_in,
    log_in_admin,
    user_row,
)
from tests.test_invitations import INVITATIONS, SHARED_GOOGLE, emailed_token

ORIGIN = "http://localhost:5900"
FROM_APP = {"origin": ORIGIN}
CALLBACK = "/api/v1/auth/google/callback"
LINK_CALLBACK = "/api/v1/auth/google/link/callback"

_codes = count(1)


@pytest.fixture
def app(
    database_url: str,
    fake_clock: FakeClock,
    fake_mailer: FakeMailer,
    fake_google_sign_in: FakeGoogleSignIn,
    fake_calendar_source: FakeCalendarSource,
) -> Iterator[FastAPI]:
    application = create_app(
        Settings(database_url=database_url, **SHARED_GOOGLE),  # type: ignore[arg-type]
        clock=fake_clock,
        mailer=fake_mailer,
        google_sign_in=fake_google_sign_in,
        calendar_source=fake_calendar_source,
    )
    with TestClient(application, follow_redirects=False) as admin:
        log_in_admin(admin)
        application.state.admin_client = admin
        yield application


@pytest.fixture
def admin(app: FastAPI) -> TestClient:
    client: TestClient = app.state.admin_client
    return client


def browser(app: FastAPI) -> TestClient:
    """A fresh browser with its own cookie jar."""
    return TestClient(app, follow_redirects=False)


@pytest.fixture
def guest(app: FastAPI) -> TestClient:
    return browser(app)


def invite(admin: TestClient, fake_mailer: FakeMailer, email: str = "ana@example.com") -> str:
    response = admin.post(INVITATIONS, json={"email": email})
    assert response.status_code == 201, response.text
    return emailed_token(fake_mailer)


def authorization_params(response: httpx.Response) -> dict[str, str]:
    assert response.status_code == 200, response.text
    url = response.json()["authorization_url"]
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    return {key: values[0] for key, values in parse_qs(urlparse(url).query).items()}


def google_answers(
    client: TestClient,
    google: FakeGoogleSignIn,
    params: dict[str, str],
    *,
    subject: str,
    email: str,
    callback: str = CALLBACK,
    nonce: str | None = None,
    challenge: str | None = None,
    **claims: object,
) -> httpx.Response:
    """Google's redirect back after the person consents as `email`."""
    code = f"code-{next(_codes)}"
    id_token = google.sign(
        google.claims(
            subject=subject,
            email=email,
            nonce=params["nonce"] if nonce is None else nonce,
            **claims,  # type: ignore[arg-type]
        )
    )
    google.register_code(
        code, params["code_challenge"] if challenge is None else challenge, id_token
    )
    return client.get(callback, params={"code": code, "state": params["state"]})


def redirected_to(response: httpx.Response) -> tuple[str, dict[str, str]]:
    assert response.status_code == 302, response.text
    location = urlparse(response.headers["location"])
    query = {key: values[0] for key, values in parse_qs(location.query).items()}
    return f"{location.scheme}://{location.netloc}{location.path}", query


def start_invitation(client: TestClient, token: str) -> dict[str, str]:
    return authorization_params(
        client.post("/api/v1/auth/google/invitation", json={"token": token}, headers=FROM_APP)
    )


def accept_with_google(
    client: TestClient,
    google: FakeGoogleSignIn,
    token: str,
    *,
    subject: str = "sub-ana",
    email: str = "ana@example.com",
    **claims: object,
) -> httpx.Response:
    params = start_invitation(client, token)
    return google_answers(client, google, params, subject=subject, email=email, **claims)


def choose_username(client: TestClient, username: str = "ana") -> httpx.Response:
    return client.post("/api/v1/auth/invitations/accept", json={"username": username})


def sign_in_with_google(
    client: TestClient,
    google: FakeGoogleSignIn,
    *,
    subject: str = "sub-ana",
    email: str = "ana@example.com",
    next_path: str | None = None,
) -> httpx.Response:
    body = {} if next_path is None else {"next": next_path}
    params = authorization_params(
        client.post("/api/v1/auth/google/login", json=body, headers=FROM_APP)
    )
    return google_answers(client, google, params, subject=subject, email=email)


def me(client: TestClient) -> httpx.Response:
    return client.get("/api/v1/auth/me")


def users_total(admin: TestClient) -> int:
    return int(admin.get("/api/v1/admin/users").json()["total"])


class TestAcceptingAnInvitation:
    def test_the_invited_google_account_creates_one_regular_user_with_its_inbox(
        self,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        token = invite(admin, fake_mailer)
        before = users_total(admin)

        landed, query = redirected_to(accept_with_google(guest, fake_google_sign_in, token))
        assert (landed, query) == (f"{ORIGIN}/invite", {"step": "username"})
        assert users_total(admin) == before  # nothing yet: the username comes first

        assert choose_username(guest, "ana").status_code == 204

        account = me(guest).json()
        assert account["username"] == "ana"
        assert account["email"] == "ana@example.com"
        assert account["is_admin"] is False
        assert account["has_password"] is False
        assert account["google_email"] == "ana@example.com"
        assert account["must_change_password"] is False
        assert users_total(admin) == before + 1
        lists = guest.get("/api/v1/lists").json()["items"]
        assert [item["name"] for item in lists if item["is_inbox"]] == ["Inbox"]
        listed = admin.get(INVITATIONS).json()["items"][0]
        assert listed["status"] == "accepted"
        assert listed["accepted_user_id"] == account["id"]

    def test_a_forwarded_link_is_refused_for_a_different_google_email(
        self,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        token = invite(admin, fake_mailer)
        before = users_total(admin)

        response = accept_with_google(guest, fake_google_sign_in, token, email="eve@example.com")

        assert redirected_to(response) == (f"{ORIGIN}/invite", {"error": "email_mismatch"})
        assert choose_username(guest).json()["error"]["code"] == "acceptance_not_started"
        assert users_total(admin) == before
        assert admin.get(INVITATIONS).json()["items"][0]["status"] == "pending"

    def test_the_invited_email_matches_ignoring_case_and_spaces_only(
        self,
        admin: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
        app: FastAPI,
    ) -> None:
        token = invite(admin, fake_mailer, "ana.b@example.com")

        dotless = accept_with_google(
            browser(app), fake_google_sign_in, token, email="anab@example.com"
        )
        plus = accept_with_google(
            browser(app), fake_google_sign_in, token, email="ana.b+x@example.com"
        )
        cased = accept_with_google(
            browser(app), fake_google_sign_in, token, email="Ana.B@Example.COM"
        )

        assert redirected_to(dotless)[1] == {"error": "email_mismatch"}
        assert redirected_to(plus)[1] == {"error": "email_mismatch"}
        assert redirected_to(cased)[1] == {"step": "username"}

    def test_an_unverified_google_email_is_refused(
        self,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        token = invite(admin, fake_mailer)

        response = accept_with_google(guest, fake_google_sign_in, token, email_verified=False)

        assert redirected_to(response)[1] == {"error": "google_email_unverified"}

    def test_a_taken_username_consumes_nothing_and_another_can_be_chosen(
        self,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        create_user_row(admin, "ana", "someone@example.com")
        token = invite(admin, fake_mailer)
        accept_with_google(guest, fake_google_sign_in, token)

        taken = choose_username(guest, "ANA")
        blank = choose_username(guest, "   ")

        assert taken.status_code == 409
        assert taken.json()["error"]["code"] == "username_taken"
        assert blank.json()["error"]["code"] == "invalid_username"
        assert admin.get(INVITATIONS).json()["items"][0]["status"] == "pending"
        assert choose_username(guest, "ana2").status_code == 204
        assert me(guest).json()["username"] == "ana2"

    def test_an_accepted_invitation_cannot_be_used_again(
        self,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
        app: FastAPI,
    ) -> None:
        token = invite(admin, fake_mailer)
        accept_with_google(guest, fake_google_sign_in, token)
        choose_username(guest, "ana")
        before = users_total(admin)

        replayed = choose_username(guest, "ana-again")
        restarted = browser(app).post(
            "/api/v1/auth/google/invitation", json={"token": token}, headers=FROM_APP
        )
        looked_up = browser(app).post("/api/v1/auth/invitations/lookup", json={"token": token})

        assert replayed.status_code == 400  # the pending identity was used up
        assert restarted.status_code == 409
        assert restarted.json()["error"]["details"] == {"status": "accepted"}
        assert looked_up.json() == {"email": "ana@example.com", "status": "accepted"}
        assert users_total(admin) == before

    def test_a_second_browser_that_verified_the_same_invitation_is_refused(
        self,
        admin: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
        app: FastAPI,
    ) -> None:
        token = invite(admin, fake_mailer)
        first, second = browser(app), browser(app)
        accept_with_google(first, fake_google_sign_in, token)
        accept_with_google(second, fake_google_sign_in, token)
        before = users_total(admin)

        assert choose_username(first, "ana").status_code == 204
        refused = choose_username(second, "ana-two")

        assert refused.status_code == 409
        assert refused.json()["error"]["code"] == "invitation_unavailable"
        assert users_total(admin) == before + 1

    def test_resending_invalidates_the_old_link_and_its_round_trips(
        self,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
        app: FastAPI,
    ) -> None:
        old_token = invite(admin, fake_mailer)
        accept_with_google(guest, fake_google_sign_in, old_token)  # verified with the old link
        invitation_id = admin.get(INVITATIONS).json()["items"][0]["id"]
        admin.post(f"{INVITATIONS}/{invitation_id}/resend")
        new_token = emailed_token(fake_mailer)

        old_lookup = browser(app).post("/api/v1/auth/invitations/lookup", json={"token": old_token})

        assert old_lookup.status_code == 404
        assert choose_username(guest).json()["error"]["code"] == "invitation_unavailable"
        fresh = browser(app)
        assert redirected_to(accept_with_google(fresh, fake_google_sign_in, new_token))[1] == {
            "step": "username"
        }
        assert choose_username(fresh).status_code == 204

    def test_a_canceled_invitation_cannot_be_completed(
        self,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        token = invite(admin, fake_mailer)
        accept_with_google(guest, fake_google_sign_in, token)
        invitation_id = admin.get(INVITATIONS).json()["items"][0]["id"]
        admin.post(f"{INVITATIONS}/{invitation_id}/cancel")

        assert choose_username(guest).json()["error"]["code"] == "invitation_unavailable"
        started = guest.post(
            "/api/v1/auth/google/invitation", json={"token": token}, headers=FROM_APP
        )
        assert started.json()["error"]["details"] == {"status": "canceled"}

    def test_an_invitation_that_expires_mid_acceptance_is_refused(
        self,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
        fake_clock: FakeClock,
    ) -> None:
        token = invite(admin, fake_mailer)
        fake_clock.advance(timedelta(days=7) - timedelta(minutes=1))
        accept_with_google(guest, fake_google_sign_in, token)
        fake_clock.advance(timedelta(minutes=1))

        assert choose_username(guest).json()["error"]["code"] == "invitation_unavailable"

    def test_an_invitation_cannot_bypass_an_existing_account(
        self,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        token = invite(admin, fake_mailer)
        # The address was given to an account after the invitation went out.
        create_user_row(admin, "ana-old", "ana@example.com", is_active=False)

        response = accept_with_google(guest, fake_google_sign_in, token)

        assert redirected_to(response)[1] == {"error": "email_in_use"}

    def test_a_google_account_already_signing_in_elsewhere_cannot_accept(
        self,
        admin: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
        app: FastAPI,
    ) -> None:
        first = browser(app)
        accept_with_google(first, fake_google_sign_in, invite(admin, fake_mailer))
        choose_username(first, "ana")
        token = invite(admin, fake_mailer, "ana.work@example.com")

        response = accept_with_google(
            browser(app),
            fake_google_sign_in,
            token,
            subject="sub-ana",
            email="ana.work@example.com",
        )

        assert redirected_to(response)[1] == {"error": "identity_in_use"}

    def test_an_unknown_link_is_not_found(self, guest: TestClient) -> None:
        response = guest.post("/api/v1/auth/invitations/lookup", json={"token": "nope"})

        assert response.status_code == 404


async def test_concurrent_acceptances_create_exactly_one_user(
    app: FastAPI,
    admin: TestClient,
    fake_mailer: FakeMailer,
    fake_google_sign_in: FakeGoogleSignIn,
) -> None:
    """Two browsers that both verified the invitation submit at once: the
    lock on the invitation lets one through and refuses the other."""
    token = invite(admin, fake_mailer)
    first, second = browser(app), browser(app)
    accept_with_google(first, fake_google_sign_in, token)
    accept_with_google(second, fake_google_sign_in, token)
    before = users_total(admin)

    async def submit(client: TestClient, username: str) -> int:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver", cookies=client.cookies
        ) as async_client:
            response = await async_client.post(
                "/api/v1/auth/invitations/accept", json={"username": username}
            )
            return response.status_code

    statuses = await asyncio.gather(submit(first, "ana"), submit(second, "ana-two"))

    assert sorted(statuses) == [204, 409]
    assert users_total(admin) == before + 1


def accepted_user(
    app: FastAPI,
    admin: TestClient,
    fake_mailer: FakeMailer,
    google: FakeGoogleSignIn,
    *,
    username: str = "ana",
    email: str = "ana@example.com",
    subject: str = "sub-ana",
) -> int:
    """A User admitted by invitation, signed in on a throwaway browser."""
    client = browser(app)
    accept_with_google(
        client, google, invite(admin, fake_mailer, email), subject=subject, email=email
    )
    assert choose_username(client, username).status_code == 204
    return int(me(client).json()["id"])


class TestSigningInWithGoogle:
    def test_an_admitted_user_signs_in_with_google_without_a_password(
        self,
        app: FastAPI,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        user_id = accepted_user(app, admin, fake_mailer, fake_google_sign_in)

        response = sign_in_with_google(guest, fake_google_sign_in, next_path="/today")

        assert redirected_to(response) == (f"{ORIGIN}/today", {})
        assert me(guest).json()["id"] == user_id
        assert guest.get("/api/v1/lists").status_code == 200

    def test_sign_in_asks_google_for_identity_only(
        self, guest: TestClient, fake_google_sign_in: FakeGoogleSignIn
    ) -> None:
        params = authorization_params(
            guest.post("/api/v1/auth/google/login", json={}, headers=FROM_APP)
        )

        assert params["scope"] == "openid email"
        assert "access_type" not in params
        assert params["client_id"] == "shared-client-id"
        assert params["redirect_uri"] == f"{ORIGIN}/api/v1/auth/google/callback"
        assert params["code_challenge_method"] == "S256"
        assert params["nonce"]
        assert params["state"]

    def test_the_email_never_identifies_a_google_sign_in(
        self, admin: TestClient, guest: TestClient, fake_google_sign_in: FakeGoogleSignIn
    ) -> None:
        create_user_row(admin, "ben", "ben@example.com")

        response = sign_in_with_google(
            guest, fake_google_sign_in, subject="sub-ben", email="ben@example.com"
        )

        assert redirected_to(response) == (f"{ORIGIN}/", {"signInError": "not_recognized"})
        assert me(guest).status_code == 401

    def test_an_uninvited_person_gets_access_denied_and_no_account(
        self, admin: TestClient, guest: TestClient, fake_google_sign_in: FakeGoogleSignIn
    ) -> None:
        before = users_total(admin)

        response = sign_in_with_google(
            guest, fake_google_sign_in, subject="sub-eve", email="eve@example.com"
        )

        assert redirected_to(response)[1] == {"signInError": "not_recognized"}
        assert users_total(admin) == before

    def test_a_calendar_connection_never_becomes_a_login_identity(
        self,
        admin: TestClient,
        guest: TestClient,
        fake_calendar_source: FakeCalendarSource,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        fake_calendar_source.register_code(
            "cal-code", google_account_id="sub-admin", email="admin@example.com", refresh_token="r"
        )
        connect = admin.get("/api/v1/google/connect", headers={"referer": f"{ORIGIN}/"})
        state = parse_qs(urlparse(connect.headers["location"]).query)["state"][0]
        admin.get("/api/v1/google/callback", params={"code": "cal-code", "state": state})
        assert len(admin.get("/api/v1/google/accounts").json()) == 1

        response = sign_in_with_google(
            guest, fake_google_sign_in, subject="sub-admin", email="admin@example.com"
        )

        assert redirected_to(response)[1] == {"signInError": "not_recognized"}

    def test_a_disabled_user_cannot_sign_in_with_google(
        self,
        app: FastAPI,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        user_id = accepted_user(app, admin, fake_mailer, fake_google_sign_in)
        admin.patch(f"/api/v1/admin/users/{user_id}", json={"is_active": False})

        response = sign_in_with_google(guest, fake_google_sign_in)

        assert redirected_to(response)[1] == {"signInError": "account_disabled"}
        assert me(guest).status_code == 401

    def test_disabling_ends_an_existing_google_session(
        self,
        app: FastAPI,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        user_id = accepted_user(app, admin, fake_mailer, fake_google_sign_in)
        sign_in_with_google(guest, fake_google_sign_in)

        admin.patch(f"/api/v1/admin/users/{user_id}", json={"is_active": False})
        admin.patch(f"/api/v1/admin/users/{user_id}", json={"is_active": True})

        assert me(guest).status_code == 401  # a fresh sign-in is needed
        sign_in_with_google(guest, fake_google_sign_in)
        assert me(guest).json()["id"] == user_id

    def test_a_google_only_user_cannot_sign_in_with_a_password(
        self,
        app: FastAPI,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        accepted_user(app, admin, fake_mailer, fake_google_sign_in)

        response = guest.post("/api/v1/auth/login", json={"login": "ana", "password": ""})

        assert response.status_code == 401

    def test_password_login_and_google_coexist(self, admin: TestClient, guest: TestClient) -> None:
        log_in(guest)

        assert me(guest).json()["has_password"] is True
        assert me(guest).json()["google_email"] is None

    def test_providers_say_whether_google_sign_in_is_offered(
        self, guest: TestClient, database_url: str, fake_clock: FakeClock
    ) -> None:
        assert guest.get("/api/v1/auth/providers").json() == {"google": True}
        unconfigured = create_app(Settings(database_url=database_url), clock=fake_clock)
        with TestClient(unconfigured) as other:
            assert other.get("/api/v1/auth/providers").json() == {"google": False}
            assert other.post("/api/v1/auth/google/login", json={}).status_code == 404


class TestOAuthGuards:
    @pytest.mark.parametrize(
        "next_path",
        ["//evil.example", "https://evil.example/", "evil", "/\\evil.example", "/a\nb"],
    )
    def test_an_unsafe_return_address_is_refused(self, guest: TestClient, next_path: str) -> None:
        response = guest.post(
            "/api/v1/auth/google/login", json={"next": next_path}, headers=FROM_APP
        )

        assert response.status_code == 400
        assert response.json()["error"]["code"] == "unsafe_return_url"

    def test_a_foreign_origin_never_becomes_the_landing_origin(self, guest: TestClient) -> None:
        params = authorization_params(
            guest.post(
                "/api/v1/auth/google/login", json={}, headers={"origin": "https://evil.example"}
            )
        )

        assert params["redirect_uri"].startswith(ORIGIN)

    def test_a_callback_without_this_browsers_transaction_is_refused(
        self,
        app: FastAPI,
        guest: TestClient,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        """Login CSRF: an attacker's own code and state, replayed into the
        victim's browser."""
        attacker = browser(app)
        params = authorization_params(
            attacker.post("/api/v1/auth/google/login", json={}, headers=FROM_APP)
        )

        response = google_answers(
            guest, fake_google_sign_in, params, subject="sub-eve", email="eve@example.com"
        )

        assert response.status_code == 400
        assert response.json()["error"]["code"] == "invalid_oauth_state"

    def test_a_mismatched_state_is_refused(
        self, guest: TestClient, fake_google_sign_in: FakeGoogleSignIn
    ) -> None:
        params = authorization_params(
            guest.post("/api/v1/auth/google/login", json={}, headers=FROM_APP)
        )

        response = guest.get(CALLBACK, params={"code": "x", "state": params["state"] + "x"})

        assert response.json()["error"]["code"] == "invalid_oauth_state"

    def test_a_callback_cannot_be_replayed(
        self,
        app: FastAPI,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        accepted_user(app, admin, fake_mailer, fake_google_sign_in)
        params = authorization_params(
            guest.post("/api/v1/auth/google/login", json={}, headers=FROM_APP)
        )
        google_answers(
            guest, fake_google_sign_in, params, subject="sub-ana", email="ana@example.com"
        )
        guest.cookies.delete("tuktuk_session")

        replay = google_answers(
            guest, fake_google_sign_in, params, subject="sub-ana", email="ana@example.com"
        )

        assert replay.status_code == 400
        assert me(guest).status_code == 401

    def test_a_transaction_expires_after_ten_minutes(
        self,
        guest: TestClient,
        fake_google_sign_in: FakeGoogleSignIn,
        fake_clock: FakeClock,
    ) -> None:
        params = authorization_params(
            guest.post("/api/v1/auth/google/login", json={}, headers=FROM_APP)
        )
        fake_clock.advance(timedelta(minutes=11))

        response = google_answers(
            guest, fake_google_sign_in, params, subject="sub-ana", email="ana@example.com"
        )

        assert response.status_code == 400

    @pytest.mark.parametrize(
        ("tamper", "kwargs"),
        [
            ("a code bound to another PKCE challenge", {"challenge": "another-challenge"}),
            ("an ID token minted for another sign-in", {"nonce": "another-nonce"}),
            ("an ID token for another client", {"audience": "another-client"}),
            ("an ID token from another issuer", {"iss": "https://evil.example"}),
            ("an expired ID token", {"exp": 1}),
        ],
    )
    def test_an_identity_that_fails_verification_signs_nobody_in(
        self,
        app: FastAPI,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
        tamper: str,
        kwargs: dict[str, object],
    ) -> None:
        accepted_user(app, admin, fake_mailer, fake_google_sign_in)
        params = authorization_params(
            guest.post("/api/v1/auth/google/login", json={}, headers=FROM_APP)
        )

        response = google_answers(
            guest, fake_google_sign_in, params, subject="sub-ana", email="ana@example.com", **kwargs
        )

        assert redirected_to(response)[1] == {"signInError": "google_failed"}, tamper
        assert me(guest).status_code == 401

    def test_an_id_token_signed_by_another_key_signs_nobody_in(
        self,
        app: FastAPI,
        admin: TestClient,
        guest: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        from cryptography.hazmat.primitives.asymmetric import rsa

        accepted_user(app, admin, fake_mailer, fake_google_sign_in)
        params = authorization_params(
            guest.post("/api/v1/auth/google/login", json={}, headers=FROM_APP)
        )
        forged = fake_google_sign_in.sign(
            fake_google_sign_in.claims(
                subject="sub-ana", email="ana@example.com", nonce=params["nonce"]
            ),
            key=rsa.generate_private_key(public_exponent=65537, key_size=2048),
        )
        fake_google_sign_in.register_code("forged", params["code_challenge"], forged)

        response = guest.get(CALLBACK, params={"code": "forged", "state": params["state"]})

        assert redirected_to(response)[1] == {"signInError": "google_failed"}

    def test_declining_at_google_lands_back_on_sign_in(self, guest: TestClient) -> None:
        params = authorization_params(
            guest.post("/api/v1/auth/google/login", json={}, headers=FROM_APP)
        )

        response = guest.get(CALLBACK, params={"error": "access_denied", "state": params["state"]})

        assert redirected_to(response) == (f"{ORIGIN}/", {"signInError": "google_cancelled"})

    def test_the_link_callback_refuses_a_login_transaction(
        self, admin: TestClient, fake_google_sign_in: FakeGoogleSignIn
    ) -> None:
        params = authorization_params(
            admin.post("/api/v1/auth/google/login", json={}, headers=FROM_APP)
        )

        response = google_answers(
            admin,
            fake_google_sign_in,
            params,
            subject="sub-admin",
            email="admin@example.com",
            callback=LINK_CALLBACK,
        )

        assert response.json()["error"]["code"] == "invalid_oauth_state"


def start_link(client: TestClient, password: str = TEST_PASSWORD, **body: object) -> httpx.Response:
    return client.post(
        "/api/v1/auth/google/link", json={"password": password, **body}, headers=FROM_APP
    )


def link_with_google(
    client: TestClient,
    google: FakeGoogleSignIn,
    *,
    subject: str = "sub-ben",
    email: str = "ben@example.com",
    next_path: str = "/settings/account",
) -> httpx.Response:
    params = authorization_params(start_link(client, next=next_path))
    return google_answers(
        client, google, params, subject=subject, email=email, callback=LINK_CALLBACK
    )


@pytest.fixture
def ben(app: FastAPI, admin: TestClient) -> TestClient:
    """An existing password User, signed in on their own browser."""
    create_user_row(admin, "ben", "ben@example.com")
    client = browser(app)
    log_in(client, "ben")
    return client


class TestLinkingAnExistingAccount:
    def test_linking_keeps_the_same_user_and_adds_google_sign_in(
        self, app: FastAPI, ben: TestClient, fake_google_sign_in: FakeGoogleSignIn
    ) -> None:
        before = me(ben).json()
        ben.post("/api/v1/tasks", json={"title": "Mine"})

        response = link_with_google(ben, fake_google_sign_in)

        assert redirected_to(response) == (f"{ORIGIN}/settings/account", {"googleLink": "linked"})
        assert me(ben).json()["google_email"] == "ben@example.com"
        other = browser(app)
        sign_in_with_google(other, fake_google_sign_in, subject="sub-ben", email="ben@example.com")
        assert me(other).json()["id"] == before["id"]
        titles = [task["title"] for task in other.get("/api/v1/tasks").json()["items"]]
        assert titles == ["Mine"]
        log_in(browser(app), "ben")  # the password still works

    def test_linking_needs_the_password_and_counts_toward_lockout(self, ben: TestClient) -> None:
        wrong = start_link(ben, "not-the-password")

        assert wrong.status_code == 400
        assert wrong.json()["error"]["code"] == "invalid_current_password"
        for _ in range(4):
            start_link(ben, "not-the-password")
        assert start_link(ben).status_code == 429

    def test_a_different_google_email_is_not_linked(
        self, ben: TestClient, fake_google_sign_in: FakeGoogleSignIn
    ) -> None:
        response = link_with_google(ben, fake_google_sign_in, email="ben.personal@example.com")

        assert redirected_to(response)[1] == {"googleLink": "email_mismatch"}
        assert me(ben).json()["google_email"] is None

    def test_an_unverified_google_email_is_not_linked(
        self, ben: TestClient, fake_google_sign_in: FakeGoogleSignIn
    ) -> None:
        params = authorization_params(start_link(ben))

        response = google_answers(
            ben,
            fake_google_sign_in,
            params,
            subject="sub-ben",
            email="ben@example.com",
            callback=LINK_CALLBACK,
            email_verified=False,
        )

        assert redirected_to(response)[1] == {"googleLink": "google_email_unverified"}

    def test_a_google_account_linked_to_another_user_is_refused(
        self,
        app: FastAPI,
        admin: TestClient,
        ben: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        accepted_user(app, admin, fake_mailer, fake_google_sign_in, subject="sub-shared")

        response = link_with_google(ben, fake_google_sign_in, subject="sub-shared")

        assert redirected_to(response)[1] == {"googleLink": "identity_in_use"}

    def test_a_linked_account_cannot_link_a_second_google_account(
        self, ben: TestClient, fake_google_sign_in: FakeGoogleSignIn
    ) -> None:
        link_with_google(ben, fake_google_sign_in)

        response = start_link(ben)

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "google_already_linked"

    def test_another_users_link_round_trip_cannot_be_finished_here(
        self,
        app: FastAPI,
        admin: TestClient,
        ben: TestClient,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        params = authorization_params(start_link(ben))
        hijacker = browser(app)
        log_in(hijacker)
        hijacker.cookies.set(
            "tuktuk_google_oauth",
            ben.cookies.get("tuktuk_google_oauth", path="/api/v1/auth/google") or "",
            path="/api/v1/auth/google",
        )

        response = google_answers(
            hijacker,
            fake_google_sign_in,
            params,
            subject="sub-ben",
            email="ben@example.com",
            callback=LINK_CALLBACK,
        )

        assert response.json()["error"]["code"] == "invalid_oauth_state"

    def test_linking_is_refused_to_an_api_token(self, ben: TestClient) -> None:
        token = ben.post("/api/v1/auth/me/tokens", json={"name": "cli"}).json()["token"]
        anonymous = TestClient(ben.app)

        response = anonymous.post(
            "/api/v1/auth/google/link",
            json={"password": TEST_PASSWORD},
            headers={"authorization": f"Bearer {token}"},
        )

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "token_not_allowed"

    def test_a_linked_user_cannot_change_their_own_email(
        self, ben: TestClient, fake_google_sign_in: FakeGoogleSignIn
    ) -> None:
        link_with_google(ben, fake_google_sign_in)

        response = ben.patch("/api/v1/auth/me", json={"email": "ben.new@example.com"})

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "email_managed_by_admin"
        assert ben.patch("/api/v1/auth/me", json={"username": "benjamin"}).status_code == 200


class TestRecovery:
    def test_a_google_only_user_recovers_with_an_admins_temporary_password(
        self,
        app: FastAPI,
        admin: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        user_id = accepted_user(app, admin, fake_mailer, fake_google_sign_in)

        reset = admin.post(
            f"/api/v1/admin/users/{user_id}/reset-password",
            json={"temp_password": "a-temporary-password"},
        )
        assert reset.status_code == 200

        recovering = browser(app)
        log_in(recovering, "ana", "a-temporary-password")
        assert me(recovering).json()["must_change_password"] is True
        assert recovering.get("/api/v1/lists").json()["error"]["code"] == (
            "password_change_required"
        )
        # Signing in with Google never asks for that password.
        google = browser(app)
        sign_in_with_google(google, fake_google_sign_in)
        assert google.get("/api/v1/lists").status_code == 200

    def test_recovery_leaves_a_disabled_user_disabled(
        self,
        app: FastAPI,
        admin: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        user_id = accepted_user(app, admin, fake_mailer, fake_google_sign_in)
        admin.patch(f"/api/v1/admin/users/{user_id}", json={"is_active": False})

        reset = admin.post(
            f"/api/v1/admin/users/{user_id}/reset-password",
            json={"temp_password": "a-temporary-password"},
        )

        assert reset.json()["is_active"] is False
        attempt = browser(app).post(
            "/api/v1/auth/login", json={"login": "ana", "password": "a-temporary-password"}
        )
        assert attempt.json()["error"]["code"] == "account_disabled"

    def test_an_admin_replaces_a_lost_google_identity_on_the_same_user(
        self,
        app: FastAPI,
        admin: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        user_id = accepted_user(app, admin, fake_mailer, fake_google_sign_in)
        old_session = browser(app)
        sign_in_with_google(old_session, fake_google_sign_in)
        old_session.post("/api/v1/tasks", json={"title": "Kept"})

        unlinked = admin.delete(f"/api/v1/admin/users/{user_id}/google-identity")
        assert unlinked.status_code == 200
        assert unlinked.json()["google_email"] is None
        assert me(old_session).status_code == 401  # sessions end with the identity
        lost = sign_in_with_google(browser(app), fake_google_sign_in)
        assert redirected_to(lost)[1] == {"signInError": "not_recognized"}

        # Out-of-band verified: the Admin reconciles the new address and
        # issues a recovery password; the User links their new account.
        admin.patch(f"/api/v1/admin/users/{user_id}", json={"email": "ana.new@example.com"})
        admin.post(
            f"/api/v1/admin/users/{user_id}/reset-password",
            json={"temp_password": "a-temporary-password"},
        )
        client = browser(app)
        log_in(client, "ana", "a-temporary-password")
        client.post("/api/v1/auth/complete", json={"new_password": "a-brand-new-password"})
        params = authorization_params(start_link(client, "a-brand-new-password"))
        linked = google_answers(
            client,
            fake_google_sign_in,
            params,
            subject="sub-ana-new",
            email="ana.new@example.com",
            callback=LINK_CALLBACK,
        )
        assert redirected_to(linked)[1] == {"googleLink": "linked"}

        fresh = browser(app)
        sign_in_with_google(
            fresh, fake_google_sign_in, subject="sub-ana-new", email="ana.new@example.com"
        )
        assert me(fresh).json()["id"] == user_id
        assert [t["title"] for t in fresh.get("/api/v1/tasks").json()["items"]] == ["Kept"]

    def test_an_admin_email_change_does_not_move_the_login_identity(
        self,
        app: FastAPI,
        admin: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        user_id = accepted_user(app, admin, fake_mailer, fake_google_sign_in)

        changed = admin.patch(f"/api/v1/admin/users/{user_id}", json={"email": "Ana2@example.com"})

        assert changed.json()["email"] == "Ana2@example.com"
        client = browser(app)
        sign_in_with_google(client, fake_google_sign_in)  # still sub-ana
        assert me(client).json()["id"] == user_id
        assert user_row(app, user_id).google_subject == "sub-ana"

    def test_the_admin_list_shows_how_each_user_signs_in(
        self,
        app: FastAPI,
        admin: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        user_id = accepted_user(app, admin, fake_mailer, fake_google_sign_in)

        rows = {row["id"]: row for row in admin.get("/api/v1/admin/users").json()["items"]}

        assert rows[user_id]["has_password"] is False
        assert rows[user_id]["google_email"] == "ana@example.com"

    def test_unlinking_a_user_without_google_is_a_conflict(
        self, admin: TestClient, ben: TestClient
    ) -> None:
        ben_id = me(ben).json()["id"]

        response = admin.delete(f"/api/v1/admin/users/{ben_id}/google-identity")

        assert response.status_code == 409

    def test_an_admin_cannot_take_an_email_another_user_has(
        self, admin: TestClient, ben: TestClient
    ) -> None:
        ben_id = me(ben).json()["id"]

        response = admin.patch(f"/api/v1/admin/users/{ben_id}", json={"email": "ADMIN@example.com"})

        assert response.json()["error"]["code"] == "email_taken"


class TestReviewGuards:
    """Guards found missing in review of #586."""

    def test_an_admin_cannot_remove_their_own_google_sign_in(
        self, admin: TestClient, fake_google_sign_in: FakeGoogleSignIn
    ) -> None:
        link_with_google(admin, fake_google_sign_in, subject="sub-admin", email="admin@example.com")
        own_id = me(admin).json()["id"]

        response = admin.delete(f"/api/v1/admin/users/{own_id}/google-identity")

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "cannot_unlink_self"
        assert me(admin).json()["google_email"] == "admin@example.com"

    def test_removing_the_last_active_admins_only_way_in_is_refused(
        self,
        app: FastAPI,
        admin: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
        database_url: str,
    ) -> None:
        """A Google-only Admin left as the last active one: removing their
        Google sign-in would leave nobody able to administer the instance."""
        from tests.conftest import run_sql

        ana_id = accepted_user(app, admin, fake_mailer, fake_google_sign_in)
        admin.patch(f"/api/v1/admin/users/{ana_id}", json={"is_admin": True})
        ana = browser(app)
        sign_in_with_google(ana, fake_google_sign_in)
        own_id = me(admin).json()["id"]
        run_sql(database_url, "UPDATE users SET is_admin = false WHERE id = %s", (own_id,))
        # ana is now the only active Admin, and signs in with Google alone.

        response = ana.delete(f"/api/v1/admin/users/{ana_id}/google-identity")

        assert response.status_code == 409
        assert me(ana).status_code == 200

    def test_an_invited_email_cannot_be_taken_by_a_profile_edit(
        self, admin: TestClient, ben: TestClient, fake_mailer: FakeMailer
    ) -> None:
        invite(admin, fake_mailer, "ana@example.com")

        response = ben.patch("/api/v1/auth/me", json={"email": "ANA@example.com"})

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "email_invited"

    def test_an_admin_cannot_create_an_account_for_an_invited_email(
        self, admin: TestClient, fake_mailer: FakeMailer
    ) -> None:
        invite(admin, fake_mailer, "ana@example.com")

        response = admin.post(
            "/api/v1/admin/users",
            json={"username": "ana", "email": "ana@example.com", "temp_password": "x" * 12},
        )

        assert response.json()["error"]["code"] == "email_invited"

    def test_a_canceled_invitation_frees_its_email(
        self, admin: TestClient, ben: TestClient, fake_mailer: FakeMailer
    ) -> None:
        invite(admin, fake_mailer, "ana@example.com")
        invitation_id = admin.get(INVITATIONS).json()["items"][0]["id"]
        admin.post(f"{INVITATIONS}/{invitation_id}/cancel")

        assert ben.patch("/api/v1/auth/me", json={"email": "ana@example.com"}).status_code == 200

    def test_api_tokens_of_a_google_user_survive_a_recovery_reset(
        self,
        app: FastAPI,
        admin: TestClient,
        fake_mailer: FakeMailer,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        """A temporary password is replaced at the next password login; a
        User who signs in with Google is never forced to, so neither are
        their tokens."""
        ana_id = accepted_user(app, admin, fake_mailer, fake_google_sign_in)
        ana = browser(app)
        sign_in_with_google(ana, fake_google_sign_in)
        token = ana.post("/api/v1/auth/me/tokens", json={"name": "cli"}).json()["token"]

        admin.post(
            f"/api/v1/admin/users/{ana_id}/reset-password",
            json={"temp_password": "a-temporary-password"},
        )

        response = browser(app).get("/api/v1/tasks", headers={"authorization": f"Bearer {token}"})
        assert response.status_code == 200
