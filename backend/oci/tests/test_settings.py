"""The dedicated Stand-up visibility toggle (issue #140).

Purely a UI flag: enabled by default, and toggling it never touches stored
stand-up data (entries, bullets, the Sprint goal) or blocks the stand-up API
routes — those assertions live with the stand-up feature's own tests. Here
we only cover the settings flag's own read/write round-trip.
"""

from fastapi.testclient import TestClient

from tests.conftest import app_settings_row


class TestStandupSettings:
    def test_defaults_to_enabled(self, client: TestClient) -> None:
        response = client.get("/api/v1/settings/stand-up")

        assert response.status_code == 200
        assert response.json() == {"enabled": True}

    def test_get_reflects_the_stored_default(self, client: TestClient) -> None:
        app = client.app
        row = app_settings_row(app)

        assert row.standup_enabled is True

    def test_put_disables_the_flag(self, client: TestClient) -> None:
        response = client.put("/api/v1/settings/stand-up", json={"enabled": False})

        assert response.status_code == 200
        assert response.json() == {"enabled": False}

    def test_put_then_get_round_trips(self, client: TestClient) -> None:
        put_response = client.put("/api/v1/settings/stand-up", json={"enabled": False})
        assert put_response.status_code == 200

        get_response = client.get("/api/v1/settings/stand-up")
        assert get_response.status_code == 200
        assert get_response.json() == {"enabled": False}

    def test_put_persists_to_the_settings_row(self, client: TestClient) -> None:
        response = client.put("/api/v1/settings/stand-up", json={"enabled": False})
        assert response.status_code == 200

        row = app_settings_row(client.app)
        assert row.standup_enabled is False

    def test_put_can_re_enable(self, client: TestClient) -> None:
        client.put("/api/v1/settings/stand-up", json={"enabled": False})

        response = client.put("/api/v1/settings/stand-up", json={"enabled": True})

        assert response.status_code == 200
        assert response.json() == {"enabled": True}

    def test_is_rejected_without_a_session(self, unauthenticated_client: TestClient) -> None:
        response = unauthenticated_client.get("/api/v1/settings/stand-up")

        assert response.status_code == 401
