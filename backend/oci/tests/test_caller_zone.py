"""Every read that takes the caller's IANA timezone (`tz`) parses it the same
way: an unknown zone is a 422 `validation_error`, never a 500. Directory
names under the tz database (`America`, `Etc`) are not zones, and some
Python builds open them as files and raise `IsADirectoryError` instead of
`ZoneInfoNotFoundError`, so they are pinned here too.
"""

import pytest
from fastapi.testclient import TestClient

from tests.test_habits import make_habit

NOT_ZONES = ["America", "Etc", "Mars/Olympus", "", "../etc/passwd", "America/"]


def habit_stats_url(client: TestClient) -> tuple[str, dict[str, str]]:
    habit = make_habit(client, "Meditate")
    return f"/api/v1/habits/{habit['id']}/stats", {"today": "2026-07-03"}


def focus_stats_url(client: TestClient) -> tuple[str, dict[str, str]]:
    return "/api/v1/focus-stats", {"start": "2026-07-01", "end": "2026-07-07"}


def stand_up_today_url(client: TestClient) -> tuple[str, dict[str, str]]:
    return "/api/v1/stand-up/suggestions/today", {"date": "2026-08-10"}


def stand_up_yesterday_url(client: TestClient) -> tuple[str, dict[str, str]]:
    return "/api/v1/stand-up/suggestions/yesterday", {"date": "2026-08-10"}


ENDPOINTS = [habit_stats_url, focus_stats_url, stand_up_today_url, stand_up_yesterday_url]


@pytest.mark.parametrize("endpoint", ENDPOINTS, ids=lambda endpoint: endpoint.__name__)
@pytest.mark.parametrize("tz", NOT_ZONES)
def test_a_tz_that_is_not_a_zone_is_422(client: TestClient, endpoint, tz: str) -> None:
    url, params = endpoint(client)

    response = client.get(url, params={**params, "tz": tz})

    assert response.status_code == 422, response.text
    body = response.json()["error"]
    assert body["code"] == "validation_error"
    assert body["message"] == f"Unknown IANA timezone {tz!r}"


@pytest.mark.parametrize("endpoint", ENDPOINTS, ids=lambda endpoint: endpoint.__name__)
def test_a_real_zone_is_accepted(client: TestClient, endpoint) -> None:
    url, params = endpoint(client)

    response = client.get(url, params={**params, "tz": "America/New_York"})

    assert response.status_code == 200, response.text
