"""Planning window (issue #563): the band of the day a User plans work
into, read by the capacity summary. A per-User, server-backed setting kept
apart from Active hours: Active hours shapes the Calendar grid only, the
planning window decides only what capacity is measured against."""

from fastapi.testclient import TestClient

PATH = "/api/v1/settings/planning-window"
ACTIVE_HOURS = "/api/v1/settings/active-hours"


class TestPlanningWindowSettings:
    def test_defaults_to_off_with_a_working_day_prefilled(self, client: TestClient) -> None:
        response = client.get(PATH)

        assert response.status_code == 200
        assert response.json() == {"enabled": False, "start": "09:00", "end": "17:00"}

    def test_put_then_get_round_trips(self, client: TestClient) -> None:
        body = {"enabled": True, "start": "08:30", "end": "16:00"}

        put_response = client.put(PATH, json=body)

        assert put_response.status_code == 200
        assert put_response.json() == body
        assert client.get(PATH).json() == body

    def test_changing_active_hours_does_not_change_the_planning_window(
        self, client: TestClient
    ) -> None:
        client.put(PATH, json={"enabled": True, "start": "10:00", "end": "15:00"})

        client.put(ACTIVE_HOURS, json={"enabled": True, "start": "07:00", "end": "22:00"})

        assert client.get(PATH).json() == {"enabled": True, "start": "10:00", "end": "15:00"}

    def test_changing_the_planning_window_does_not_change_active_hours(
        self, client: TestClient
    ) -> None:
        client.put(ACTIVE_HOURS, json={"enabled": True, "start": "07:00", "end": "22:00"})

        client.put(PATH, json={"enabled": True, "start": "10:00", "end": "15:00"})

        assert client.get(ACTIVE_HOURS).json() == {
            "enabled": True,
            "start": "07:00",
            "end": "22:00",
        }

    def test_may_end_at_midnight(self, client: TestClient) -> None:
        body = {"enabled": True, "start": "18:00", "end": "24:00"}

        assert client.put(PATH, json=body).status_code == 200

    def test_rejects_a_band_that_does_not_start_before_it_ends(self, client: TestClient) -> None:
        response = client.put(PATH, json={"enabled": True, "start": "17:00", "end": "09:00"})

        assert response.status_code == 422
        # The same shape as Quiet hours, its sibling band setting: a code
        # of its own and a message the User can read.
        assert response.json()["error"] == {
            "code": "invalid_planning_window",
            "message": "The planning window must start before it ends",
        }

    def test_rejects_a_time_off_the_30_minute_grid(self, client: TestClient) -> None:
        response = client.put(PATH, json={"enabled": True, "start": "09:15", "end": "17:00"})

        assert response.status_code == 422
        assert response.json()["error"]["message"] == "'09:15' is not aligned to 30 minutes"

    def test_rejects_a_malformed_time(self, client: TestClient) -> None:
        response = client.put(PATH, json={"enabled": True, "start": "9am", "end": "17:00"})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_planning_window"

    def test_requires_authentication(self, unauthenticated_client: TestClient) -> None:
        assert unauthenticated_client.get(PATH).status_code == 401
