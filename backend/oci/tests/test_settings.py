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


class TestActiveHoursSettings:
    """Active hours (issue #210): the Calendar's double-height band. Disabled
    by default so an existing install's grid is unchanged after upgrade."""

    def test_defaults_to_disabled_with_prefill_band(self, client: TestClient) -> None:
        response = client.get("/api/v1/settings/active-hours")

        assert response.status_code == 200
        assert response.json() == {"enabled": False, "start": "09:00", "end": "17:00"}

    def test_get_reflects_the_stored_default(self, client: TestClient) -> None:
        row = app_settings_row(client.app)

        assert row.active_hours_enabled is False
        assert row.active_hours_start == "09:00"
        assert row.active_hours_end == "17:00"

    def test_put_then_get_round_trips(self, client: TestClient) -> None:
        put_response = client.put(
            "/api/v1/settings/active-hours",
            json={"enabled": True, "start": "07:30", "end": "22:00"},
        )
        assert put_response.status_code == 200

        get_response = client.get("/api/v1/settings/active-hours")
        assert get_response.json() == {"enabled": True, "start": "07:30", "end": "22:00"}

    def test_put_persists_to_the_settings_row(self, client: TestClient) -> None:
        client.put(
            "/api/v1/settings/active-hours",
            json={"enabled": True, "start": "08:00", "end": "16:00"},
        )

        row = app_settings_row(client.app)
        assert row.active_hours_enabled is True
        assert row.active_hours_start == "08:00"
        assert row.active_hours_end == "16:00"

    def test_degenerate_full_day_band_is_allowed(self, client: TestClient) -> None:
        response = client.put(
            "/api/v1/settings/active-hours",
            json={"enabled": True, "start": "00:00", "end": "24:00"},
        )

        assert response.status_code == 200

    def test_single_30_minute_band_is_allowed(self, client: TestClient) -> None:
        response = client.put(
            "/api/v1/settings/active-hours",
            json={"enabled": True, "start": "09:00", "end": "09:30"},
        )

        assert response.status_code == 200

    def test_wrapping_band_is_rejected(self, client: TestClient) -> None:
        response = client.put(
            "/api/v1/settings/active-hours",
            json={"enabled": True, "start": "22:00", "end": "06:00"},
        )

        assert response.status_code == 422

    def test_equal_start_and_end_is_rejected(self, client: TestClient) -> None:
        response = client.put(
            "/api/v1/settings/active-hours",
            json={"enabled": True, "start": "09:00", "end": "09:00"},
        )

        assert response.status_code == 422

    def test_misaligned_band_is_rejected(self, client: TestClient) -> None:
        response = client.put(
            "/api/v1/settings/active-hours",
            json={"enabled": True, "start": "09:15", "end": "17:00"},
        )

        assert response.status_code == 422

    def test_is_rejected_without_a_session(self, unauthenticated_client: TestClient) -> None:
        response = unauthenticated_client.get("/api/v1/settings/active-hours")

        assert response.status_code == 401
