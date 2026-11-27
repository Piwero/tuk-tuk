"""Invitations (issue #586): an Admin invites an email address, the
invitation is emailed through SMTP (faked here), and its lifecycle —
pending, accepted, expired, canceled — and delivery outcome are separate.

Driven over the HTTP API with the real app; only SMTP, Google and the
clock are faked.
"""

import re
from collections.abc import Iterator
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import (
    FakeClock,
    FakeGoogleSignIn,
    FakeMailer,
    create_user_row,
    log_in,
    log_in_admin,
)

SHARED_GOOGLE = {
    "google_oauth_client_id": "shared-client-id",
    "google_oauth_client_secret": "shared-client-secret",
    "cors_origins": ["http://localhost:5900"],
}

INVITATIONS = "/api/v1/admin/invitations"


@pytest.fixture
def admin_client(
    database_url: str,
    fake_clock: FakeClock,
    fake_mailer: FakeMailer,
    fake_google_sign_in: FakeGoogleSignIn,
) -> Iterator[TestClient]:
    app = create_app(
        Settings(database_url=database_url, **SHARED_GOOGLE),  # type: ignore[arg-type]
        clock=fake_clock,
        mailer=fake_mailer,
        google_sign_in=fake_google_sign_in,
    )
    with TestClient(app, follow_redirects=False) as test_client:
        log_in_admin(test_client)
        yield test_client


def invite(client: TestClient, email: str = "ana@example.com") -> dict:
    response = client.post(INVITATIONS, json={"email": email})
    assert response.status_code == 201, response.text
    return response.json()


def emailed_token(mailer: FakeMailer, index: int = -1) -> str:
    body = mailer.sent[index].get_content()
    match = re.search(r"/invite#token=([A-Za-z0-9_-]+)", body)
    assert match is not None, body
    return match.group(1)


def users_count(client: TestClient) -> int:
    return int(client.get("/api/v1/admin/users").json()["total"])


class TestInviting:
    def test_an_invitation_is_emailed_and_creates_no_user(
        self, admin_client: TestClient, fake_mailer: FakeMailer
    ) -> None:
        before = users_count(admin_client)

        invitation = invite(admin_client, "  Ana@Example.com ")

        assert invitation["email"] == "Ana@Example.com"
        assert invitation["status"] == "pending"
        assert invitation["delivery"] == "sent"
        assert len(fake_mailer.sent) == 1
        assert fake_mailer.sent[0]["To"] == "Ana@Example.com"
        assert emailed_token(fake_mailer)
        assert users_count(admin_client) == before

    def test_an_email_already_in_use_cannot_be_invited(self, admin_client: TestClient) -> None:
        create_user_row(admin_client, "ben", "ben@example.com")

        response = admin_client.post(INVITATIONS, json={"email": "BEN@example.com"})

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "email_taken"

    def test_an_open_invitation_blocks_a_second_one_for_the_same_email(
        self, admin_client: TestClient, fake_clock: FakeClock
    ) -> None:
        invite(admin_client, "ana@example.com")
        fake_clock.advance(timedelta(days=8))  # expired is still open: resend it

        response = admin_client.post(INVITATIONS, json={"email": "ANA@example.com"})

        assert response.json()["error"]["code"] == "invitation_exists"

    def test_a_canceled_invitation_does_not_block_a_new_one(self, admin_client: TestClient) -> None:
        first = invite(admin_client)
        admin_client.post(f"{INVITATIONS}/{first['id']}/cancel")

        assert invite(admin_client)["status"] == "pending"

    def test_without_google_sign_in_nobody_can_be_invited(
        self, database_url: str, fake_clock: FakeClock, fake_mailer: FakeMailer
    ) -> None:
        app = create_app(Settings(database_url=database_url), clock=fake_clock, mailer=fake_mailer)
        with TestClient(app) as test_client:
            log_in_admin(test_client)
            response = test_client.post(INVITATIONS, json={"email": "ana@example.com"})
            availability = test_client.get(f"{INVITATIONS}/availability").json()

        assert response.json()["error"]["code"] == "google_sign_in_unavailable"
        assert availability == {"google_sign_in": False, "email_delivery": True}
        assert fake_mailer.sent == []

    def test_availability_reports_both_without_disclosing_secrets(
        self, admin_client: TestClient
    ) -> None:
        response = admin_client.get(f"{INVITATIONS}/availability")

        assert response.json() == {"google_sign_in": True, "email_delivery": True}
        assert "shared-client-secret" not in response.text

    def test_only_an_admin_manages_invitations(self, admin_client: TestClient) -> None:
        create_user_row(admin_client, "ben", "ben@example.com")
        log_in(admin_client, "ben")

        assert admin_client.get(INVITATIONS).status_code == 403
        assert admin_client.post(INVITATIONS, json={"email": "x@example.com"}).status_code == 403


class TestDelivery:
    def test_a_refused_email_is_a_visible_failure_not_a_success(
        self, admin_client: TestClient, fake_mailer: FakeMailer
    ) -> None:
        fake_mailer.failing = "The mail server answered 550"

        invitation = invite(admin_client)

        assert invitation["status"] == "pending"
        assert invitation["delivery"] == "failed"
        assert invitation["delivery_error"] == "The mail server answered 550"
        assert invitation["sent_at"] is None

    def test_without_smtp_an_invitation_records_why_it_was_not_emailed(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        app = create_app(
            Settings(database_url=database_url, **SHARED_GOOGLE),  # type: ignore[arg-type]
            clock=fake_clock,
        )
        with TestClient(app) as test_client:
            log_in_admin(test_client)
            invitation = invite(test_client)
            availability = test_client.get(f"{INVITATIONS}/availability").json()

        assert invitation["delivery"] == "failed"
        assert invitation["delivery_error"] == "Email delivery is not configured"
        assert availability["email_delivery"] is False

    def test_a_failed_delivery_can_be_retried_with_the_same_link(
        self, admin_client: TestClient, fake_mailer: FakeMailer
    ) -> None:
        fake_mailer.failing = "Could not connect to the mail server"
        invitation = invite(admin_client)
        link = admin_client.post(f"{INVITATIONS}/{invitation['id']}/link").json()["url"]
        fake_mailer.failing = None

        response = admin_client.post(f"{INVITATIONS}/{invitation['id']}/send")

        assert response.status_code == 200
        assert response.json()["delivery"] == "sent"
        assert response.json()["delivery_error"] is None
        assert link.endswith(f"#token={emailed_token(fake_mailer)}")

    def test_the_copied_link_is_the_emailed_one(
        self, admin_client: TestClient, fake_mailer: FakeMailer
    ) -> None:
        invitation = invite(admin_client)

        link = admin_client.post(f"{INVITATIONS}/{invitation['id']}/link").json()["url"]

        assert link == f"http://localhost:5900/invite#token={emailed_token(fake_mailer)}"

    def test_the_email_never_carries_a_link_for_a_different_origin(
        self, admin_client: TestClient, fake_mailer: FakeMailer
    ) -> None:
        invite(admin_client)

        body = fake_mailer.sent[0].get_content()

        assert "http://localhost:5900/invite#token=" in body
        assert "shared-client-secret" not in body


class TestLifecycle:
    def test_an_invitation_expires_seven_days_after_it_was_sent(
        self, admin_client: TestClient, fake_clock: FakeClock
    ) -> None:
        invitation = invite(admin_client)

        fake_clock.advance(timedelta(days=7) - timedelta(seconds=1))
        assert admin_client.get(INVITATIONS).json()["items"][0]["status"] == "pending"
        fake_clock.advance(timedelta(seconds=1))
        listed = admin_client.get(INVITATIONS).json()["items"][0]

        assert listed["id"] == invitation["id"]
        assert listed["status"] == "expired"

    def test_an_expired_invitation_cannot_be_sent_or_copied(
        self, admin_client: TestClient, fake_clock: FakeClock
    ) -> None:
        invitation = invite(admin_client)
        fake_clock.advance(timedelta(days=7))

        assert admin_client.post(f"{INVITATIONS}/{invitation['id']}/send").status_code == 409
        assert admin_client.post(f"{INVITATIONS}/{invitation['id']}/link").status_code == 409

    def test_resending_renews_seven_days_and_replaces_the_link(
        self, admin_client: TestClient, fake_clock: FakeClock, fake_mailer: FakeMailer
    ) -> None:
        invitation = invite(admin_client)
        first_token = emailed_token(fake_mailer)
        fake_clock.advance(timedelta(days=8))

        response = admin_client.post(f"{INVITATIONS}/{invitation['id']}/resend")

        assert response.status_code == 200
        assert response.json()["status"] == "pending"
        assert response.json()["delivery"] == "sent"
        second_token = emailed_token(fake_mailer)
        assert second_token != first_token
        fake_clock.advance(timedelta(days=7) - timedelta(seconds=1))
        assert admin_client.get(INVITATIONS).json()["items"][0]["status"] == "pending"

    def test_canceling_closes_an_invitation_for_good(self, admin_client: TestClient) -> None:
        invitation = invite(admin_client)

        canceled = admin_client.post(f"{INVITATIONS}/{invitation['id']}/cancel").json()

        assert canceled["status"] == "canceled"
        for action in ("send", "resend", "link"):
            response = admin_client.post(f"{INVITATIONS}/{invitation['id']}/{action}")
            assert response.status_code == 409, action

    def test_the_list_shows_every_invitation_newest_first(self, admin_client: TestClient) -> None:
        invite(admin_client, "ana@example.com")
        invite(admin_client, "ben@example.com")

        page = admin_client.get(INVITATIONS).json()

        assert page["total"] == 2
        assert [item["email"] for item in page["items"]] == ["ben@example.com", "ana@example.com"]

    def test_an_unknown_invitation_is_404(self, admin_client: TestClient) -> None:
        assert admin_client.post(f"{INVITATIONS}/999/cancel").status_code == 404
