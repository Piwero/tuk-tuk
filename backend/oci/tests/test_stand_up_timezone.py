"""Stand-up suggestions bucket completions by the caller's calendar day
(issue #285): the `date` param is the user's *local* day, so the `tz` IANA
timezone decides which side of midnight a `completed_at` instant falls on.
Without `tz` the behaviour is UTC, unchanged.

Both suggestion endpoints share `tasks_completed_on`, so Yesterday (which
queries `date - 1`) and Today agree on the boundary by construction — the
tests below pin that agreement at both edges of the day, for one-off Tasks
and Completed Occurrences alike.
"""

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from tests.test_stand_up_suggestions import seed_completed_occurrence, seed_completed_task

BERLIN = "Europe/Berlin"  # UTC+2 in August
NEW_YORK = "America/New_York"  # UTC-4 in August


def _at(year: int, month: int, day: int, hour: int, minute: int) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=UTC)


def today_titles(client: TestClient, day: str, tz: str | None = None) -> list[str]:
    params = {"date": day}
    if tz is not None:
        params["tz"] = tz
    response = client.get("/api/v1/stand-up/suggestions/today", params=params)
    assert response.status_code == 200, response.text
    return [item["title"] for item in response.json()]


def yesterday_titles(client: TestClient, day: str, tz: str | None = None) -> list[str]:
    params = {"date": day}
    if tz is not None:
        params["tz"] = tz
    response = client.get("/api/v1/stand-up/suggestions/yesterday", params=params)
    assert response.status_code == 200, response.text
    return [item["title"] for item in response.json()]


class TestCompletionDayBoundaryEast:
    def test_late_evening_utc_is_already_the_local_day(self, client: TestClient) -> None:
        # 23:30 UTC on the 9th is 01:30 on the 10th in Berlin.
        seed_completed_task(client, "Late deploy", _at(2026, 8, 9, 23, 30))

        assert "Late deploy" in today_titles(client, "2026-08-10", tz=BERLIN)
        assert "Late deploy" not in today_titles(client, "2026-08-10")

    def test_just_past_midnight_utc_is_already_the_next_local_day(self, client: TestClient) -> None:
        # 22:30 UTC on the 10th is 00:30 on the 11th in Berlin.
        seed_completed_task(client, "Night owl fix", _at(2026, 8, 10, 22, 30))

        assert "Night owl fix" not in today_titles(client, "2026-08-10", tz=BERLIN)
        assert "Night owl fix" in today_titles(client, "2026-08-11", tz=BERLIN)

    def test_yesterday_agrees_with_today_on_the_boundary(self, client: TestClient) -> None:
        seed_completed_task(client, "Late deploy", _at(2026, 8, 9, 23, 30))

        assert "Late deploy" in yesterday_titles(client, "2026-08-11", tz=BERLIN)
        assert "Late deploy" not in yesterday_titles(client, "2026-08-10", tz=BERLIN)


class TestCompletionDayBoundaryWest:
    def test_early_morning_utc_is_still_the_prior_local_day(self, client: TestClient) -> None:
        # 02:30 UTC on the 10th is 22:30 on the 9th in New York.
        seed_completed_task(client, "Early review", _at(2026, 8, 10, 2, 30))

        assert "Early review" not in today_titles(client, "2026-08-10", tz=NEW_YORK)
        assert "Early review" in today_titles(client, "2026-08-09", tz=NEW_YORK)

    def test_yesterday_agrees_with_today_on_the_boundary(self, client: TestClient) -> None:
        seed_completed_task(client, "Early review", _at(2026, 8, 10, 2, 30))

        assert "Early review" in yesterday_titles(client, "2026-08-10", tz=NEW_YORK)
        assert "Early review" not in yesterday_titles(client, "2026-08-11", tz=NEW_YORK)


class TestOccurrencesShareTheBoundary:
    def test_occurrences_bucket_like_one_off_tasks(self, client: TestClient) -> None:
        seed_completed_occurrence(client, "Evening water", _at(2026, 8, 9, 23, 30))
        seed_completed_occurrence(client, "Night water", _at(2026, 8, 10, 22, 30))
        seed_completed_occurrence(client, "Morning water", _at(2026, 8, 10, 2, 30))
        seed_completed_occurrence(client, "Dawn water", _at(2026, 8, 10, 4, 30))

        berlin = today_titles(client, "2026-08-10", tz=BERLIN)
        assert "Evening water" in berlin
        assert "Morning water" in berlin
        assert "Night water" not in berlin

        new_york = today_titles(client, "2026-08-09", tz=NEW_YORK)
        assert "Morning water" in new_york
        assert "Evening water" in new_york
        assert "Dawn water" not in new_york

    def test_occurrences_agree_between_yesterday_and_today(self, client: TestClient) -> None:
        seed_completed_occurrence(client, "Evening water", _at(2026, 8, 9, 23, 30))

        assert "Evening water" in yesterday_titles(client, "2026-08-11", tz=BERLIN)
        assert "Evening water" not in yesterday_titles(client, "2026-08-10", tz=BERLIN)


class TestSuggestionTimezoneValidation:
    def test_unknown_timezone_is_422_on_both_endpoints(self, client: TestClient) -> None:
        today = client.get(
            "/api/v1/stand-up/suggestions/today",
            params={"date": "2026-08-10", "tz": "Mars/Olympus"},
        )
        yesterday = client.get(
            "/api/v1/stand-up/suggestions/yesterday",
            params={"date": "2026-08-10", "tz": "Mars/Olympus"},
        )

        assert today.status_code == 422
        assert yesterday.status_code == 422
