"""Google Calendar through the deployment's shared OAuth client (issue
#586): a User connects Calendar without configuring Google Cloud, as an
optional step separate from signing in. Connections made with a User's own
client keep using it. Calendar trouble never touches app access.
"""

from collections.abc import Iterator
from datetime import date
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.calendar_source import (
    CalendarListEntry,
    GoogleOAuthClient,
    TerminalCalendarSourceError,
)
from app.config import Settings
from app.main import create_app
from tests.conftest import (
    FakeCalendarSource,
    FakeClock,
    FakeGoogleSignIn,
    FakeMailer,
    log_in_admin,
    run_sql,
)
from tests.test_google_sign_in import accepted_user, browser, me, sign_in_with_google
from tests.test_invitations import SHARED_GOOGLE

SHARED = GoogleOAuthClient(client_id="shared-client-id", client_secret="shared-client-secret")
OWN = GoogleOAuthClient(client_id="own-client-id", client_secret="own-client-secret")


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


@pytest.fixture
def ana(
    app: FastAPI,
    admin: TestClient,
    fake_mailer: FakeMailer,
    fake_google_sign_in: FakeGoogleSignIn,
) -> TestClient:
    """A User admitted by invitation and signed in with Google: no
    password, no Google Cloud client of her own."""
    accepted_user(app, admin, fake_mailer, fake_google_sign_in)
    client = browser(app)
    sign_in_with_google(client, fake_google_sign_in)
    return client


def connect(
    client: TestClient,
    source: FakeCalendarSource,
    *,
    google_account_id: str = "sub-ana",
    email: str = "ana@example.com",
    refresh_token: str = "ana-refresh",
) -> httpx.Response:
    redirect = client.get("/api/v1/google/connect", headers={"referer": "http://localhost:5900/"})
    assert redirect.status_code == 302, redirect.text
    state = parse_qs(urlparse(redirect.headers["location"]).query)["state"][0]
    code = f"code-for-{refresh_token}"
    source.register_code(
        code, google_account_id=google_account_id, email=email, refresh_token=refresh_token
    )
    return client.get("/api/v1/google/callback", params={"code": code, "state": state})


def events(client: TestClient) -> httpx.Response:
    today = date.today().isoformat()
    return client.get("/api/v1/events", params={"range_start": today, "range_end": today})


class TestConnectingThroughTheSharedClient:
    def test_calendar_is_offered_without_any_google_cloud_setup(self, ana: TestClient) -> None:
        status = ana.get("/api/v1/google/status").json()

        assert status["configured"] is True
        assert status["shared_client"] is True
        assert status["client_secret_set"] is False
        assert ana.get("/api/v1/google/accounts").json() == []

    def test_connect_asks_for_read_only_calendar_offline_and_hints_the_sign_in_account(
        self, ana: TestClient
    ) -> None:
        redirect = ana.get("/api/v1/google/connect", headers={"referer": "http://localhost:5900/"})
        params = {
            k: v[0] for k, v in parse_qs(urlparse(redirect.headers["location"]).query).items()
        }

        assert params["client_id"] == "shared-client-id"
        assert params["login_hint"] == "ana@example.com"
        assert "https://www.googleapis.com/auth/calendar.readonly" in params["scope"].split()
        assert not any(
            "calendar.events" in s or s.endswith("/calendar") for s in params["scope"].split()
        )
        assert params["access_type"] == "offline"
        assert "select_account" in params["prompt"].split()

    def test_a_connection_uses_the_shared_client_for_every_read(
        self, ana: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        fake_calendar_source.register_calendars(
            "ana-refresh", [CalendarListEntry("primary", "Ana", selected=True)]
        )

        landed = connect(ana, fake_calendar_source)
        [account] = ana.get("/api/v1/google/accounts").json()
        ana.get(f"/api/v1/google/accounts/{account['id']}/calendars")
        events(ana)

        assert landed.headers["location"] == "http://localhost:5900?googleConnected=1"
        assert fake_calendar_source.exchanged_with == [SHARED]
        assert set(fake_calendar_source.refreshed_with) == {SHARED}

    def test_a_different_and_a_second_google_account_can_be_connected(
        self, ana: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        connect(ana, fake_calendar_source)
        connect(
            ana,
            fake_calendar_source,
            google_account_id="sub-family",
            email="family@example.com",
            refresh_token="family-refresh",
        )

        emails = [account["email"] for account in ana.get("/api/v1/google/accounts").json()]

        assert emails == ["ana@example.com", "family@example.com"]
        assert me(ana).json()["google_email"] == "ana@example.com"  # admission unchanged

    def test_declining_calendar_consent_leaves_the_app_usable(self, ana: TestClient) -> None:
        redirect = ana.get("/api/v1/google/connect", headers={"referer": "http://localhost:5900/"})
        state = parse_qs(urlparse(redirect.headers["location"]).query)["state"][0]

        declined = ana.get(
            "/api/v1/google/callback", params={"state": state, "error": "access_denied"}
        )

        assert declined.headers["location"] == "http://localhost:5900?googleError=1"
        assert ana.get("/api/v1/google/accounts").json() == []
        assert me(ana).status_code == 200

    def test_revoked_calendar_consent_affects_calendar_only(
        self, ana: TestClient, fake_calendar_source: FakeCalendarSource
    ) -> None:
        fake_calendar_source.register_calendars(
            "ana-refresh", [CalendarListEntry("primary", "Ana", selected=True)]
        )
        connect(ana, fake_calendar_source)
        [account] = ana.get("/api/v1/google/accounts").json()
        ana.get(f"/api/v1/google/accounts/{account['id']}/calendars")
        fake_calendar_source.register_refresh_error(
            "ana-refresh", TerminalCalendarSourceError("invalid_grant")
        )

        read = events(ana).json()

        assert [failure["kind"] for failure in read["failures"]] == ["terminal"]
        assert me(ana).status_code == 200
        assert ana.get("/api/v1/lists").status_code == 200

    def test_disconnecting_calendar_keeps_google_sign_in(
        self,
        app: FastAPI,
        ana: TestClient,
        fake_calendar_source: FakeCalendarSource,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        connect(ana, fake_calendar_source)
        [account] = ana.get("/api/v1/google/accounts").json()

        assert ana.delete(f"/api/v1/google/accounts/{account['id']}").status_code == 204

        again = browser(app)
        sign_in_with_google(again, fake_google_sign_in)
        assert me(again).json()["google_email"] == "ana@example.com"


class TestExistingConnectionsSurviveTheRollout:
    @pytest.fixture
    def own_client_account(
        self,
        admin: TestClient,
        app: FastAPI,
        fake_calendar_source: FakeCalendarSource,
        database_url: str,
    ) -> int:
        """The admin's own client and a connection made with it before the
        shared client existed."""
        admin.put(
            "/api/v1/google/credentials",
            json={"client_id": OWN.client_id, "client_secret": OWN.client_secret},
        )
        # Connected with their own client: the shared one did not exist yet.
        run_sql(database_url, "UPDATE google_accounts SET uses_shared_client = false")
        fake_calendar_source.register_calendars(
            "old-refresh", [CalendarListEntry("primary", "Admin", selected=True)]
        )
        response = admin.get(
            "/api/v1/google/connect", headers={"referer": "http://localhost:5900/"}
        )
        params = parse_qs(urlparse(response.headers["location"]).query)
        assert params["client_id"] == ["shared-client-id"]  # new connections: shared
        state = params["state"][0]
        fake_calendar_source.register_code(
            "old",
            google_account_id="sub-admin",
            email="admin@example.com",
            refresh_token="old-refresh",
        )
        admin.get("/api/v1/google/callback", params={"code": "old", "state": state})
        run_sql(database_url, "UPDATE google_accounts SET uses_shared_client = false")
        fake_calendar_source.refreshed_with.clear()
        [account] = admin.get("/api/v1/google/accounts").json()
        return int(account["id"])

    def test_an_existing_connection_keeps_its_originating_client(
        self,
        admin: TestClient,
        own_client_account: int,
        fake_calendar_source: FakeCalendarSource,
    ) -> None:
        admin.get(f"/api/v1/google/accounts/{own_client_account}/calendars")
        events(admin)

        assert set(fake_calendar_source.refreshed_with) == {OWN}
        assert admin.get("/api/v1/google/accounts").json()[0]["connection_state"] == "connected"

    def test_editing_the_own_client_leaves_shared_client_connections_alone(
        self,
        admin: TestClient,
        own_client_account: int,
        fake_calendar_source: FakeCalendarSource,
    ) -> None:
        connect(
            admin,
            fake_calendar_source,
            google_account_id="sub-work",
            email="work@example.com",
            refresh_token="work-refresh",
        )

        admin.put("/api/v1/google/credentials", json={"client_id": "own-client-id-2"})

        states = {
            a["email"]: a["connection_state"] for a in admin.get("/api/v1/google/accounts").json()
        }
        assert states == {"admin@example.com": "needs_reconnect", "work@example.com": "connected"}

    def test_removing_the_own_client_drops_only_its_connections(
        self,
        admin: TestClient,
        own_client_account: int,
        fake_calendar_source: FakeCalendarSource,
    ) -> None:
        connect(
            admin,
            fake_calendar_source,
            google_account_id="sub-work",
            email="work@example.com",
            refresh_token="work-refresh",
        )

        admin.delete("/api/v1/google/credentials")

        emails = [a["email"] for a in admin.get("/api/v1/google/accounts").json()]
        assert emails == ["work@example.com"]
        assert admin.get("/api/v1/google/status").json()["configured"] is True

    def test_an_existing_connection_never_signs_anyone_in(
        self,
        app: FastAPI,
        own_client_account: int,
        fake_google_sign_in: FakeGoogleSignIn,
    ) -> None:
        guest = browser(app)

        response = sign_in_with_google(
            guest, fake_google_sign_in, subject="sub-admin", email="admin@example.com"
        )

        assert "signInError=not_recognized" in response.headers["location"]
