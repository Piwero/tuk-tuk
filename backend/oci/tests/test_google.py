"""The Google integration status probe (issue #103).

Google Calendar is entirely optional: a deployment without credentials must
look like an app with no such feature. The status endpoint is how the
frontend asks, once, whether the two required settings are present — never
revealing their values either way.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import TEST_PASSWORD, FakeClock


def make_client(database_url: str, fake_clock: FakeClock, **overrides: object) -> TestClient:
    app = create_app(Settings(database_url=database_url, **overrides), clock=fake_clock)  # type: ignore[arg-type]
    test_client = TestClient(app)
    response = test_client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})
    assert response.status_code == 204, response.text
    return test_client


@pytest.fixture
def configured_client(database_url: str, fake_clock: FakeClock) -> Iterator[TestClient]:
    with make_client(
        database_url,
        fake_clock,
        google_client_id="a-client-id",
        google_client_secret="a-client-secret",
    ) as test_client:
        yield test_client


@pytest.fixture
def unconfigured_client(database_url: str, fake_clock: FakeClock) -> Iterator[TestClient]:
    with make_client(database_url, fake_clock) as test_client:
        yield test_client


class TestGoogleStatus:
    def test_reports_configured_true_when_both_settings_are_present(
        self, configured_client: TestClient
    ) -> None:
        response = configured_client.get("/api/v1/google/status")

        assert response.status_code == 200
        assert response.json() == {"configured": True}

    def test_reports_configured_false_when_credentials_are_absent(
        self, unconfigured_client: TestClient
    ) -> None:
        response = unconfigured_client.get("/api/v1/google/status")

        assert response.status_code == 200
        assert response.json() == {"configured": False}

    def test_never_reveals_the_credential_values(self, configured_client: TestClient) -> None:
        response = configured_client.get("/api/v1/google/status")

        body_text = response.text
        assert "a-client-id" not in body_text
        assert "a-client-secret" not in body_text

    def test_is_rejected_without_a_session(self, database_url: str, fake_clock: FakeClock) -> None:
        app = create_app(Settings(database_url=database_url), clock=fake_clock)
        with TestClient(app) as unauthenticated_client:
            response = unauthenticated_client.get("/api/v1/google/status")

        assert response.status_code == 401
