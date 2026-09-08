"""Seeds a world, runs one turn against a real provider, scores it (#190).

The app is booted for real, over a throwaway SQLite file, through the same
`create_app` every test uses — and every seed goes in over the HTTP API,
exactly as `tests/conftest.py` does, so a scenario can never construct a
database state a user couldn't. Google is the ordinary `FakeCalendarSource`
fake: Events must be *seeded*, and the alternative (a real Google account
with real meetings on it) would make the suite unrunnable by anyone but its
author.

The provider is the only thing here that is real, which is the point.
"""

import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from fastapi.testclient import TestClient

from app.calendar_source import CalendarEventEntry, CalendarListEntry, ExchangedCredential
from app.config import Settings
from app.db import run_migrations
from app.main import create_app
from evals.scenarios import MONDAY, TIME_ZONE, Result, Scenario, World

_PASSWORD = "eval-password"
_REFRESH_TOKEN = "eval-refresh-token"
_CALENDAR_ID = "eval-calendar"


class _EvalCalendarSource:
    """The `CalendarSource` port, answering from seeded Events. Same shape
    as `tests.conftest.FakeCalendarSource`, kept separate because the suite
    must not import from `tests/` — that package is not installed, and a
    manual script quietly depending on the test suite's internals is how
    both end up hard to change."""

    def __init__(self) -> None:
        self.client_id = ""
        self.client_secret = ""
        self.events: list[CalendarEventEntry] = []

    def configure(self, client_id: str, client_secret: str) -> None:
        self.client_id = client_id
        self.client_secret = client_secret

    async def exchange_code(self, code: str, redirect_uri: str) -> ExchangedCredential:
        return ExchangedCredential(
            google_account_id="eval-account",
            email="eval@example.com",
            refresh_token=_REFRESH_TOKEN,
        )

    async def refresh(self, refresh_token: str) -> object:
        from app.calendar_source import RefreshedAccessToken

        return RefreshedAccessToken(access_token=f"access-for-{refresh_token}")

    async def list_calendars(self, access_token: str) -> list[CalendarListEntry]:
        return [CalendarListEntry(google_calendar_id=_CALENDAR_ID, summary="Eval", selected=True)]

    async def list_events(
        self, access_token: str, google_calendar_id: str, time_min: str, time_max: str
    ) -> list[CalendarEventEntry]:
        return self.events


@dataclass
class ProviderConfig:
    base_url: str
    model: str
    api_key: str


@contextmanager
def booted_app(events: list[CalendarEventEntry]) -> Iterator[TestClient]:
    """A real app on a throwaway database, logged in, with Google wired to
    the seeded Events."""
    from argon2 import PasswordHasher
    from argon2.low_level import Type

    calendar_source = _EvalCalendarSource()
    calendar_source.events = events
    with tempfile.TemporaryDirectory() as tmp_dir:
        db_path = Path(tmp_dir) / "evals.db"
        run_migrations(f"sqlite:///{db_path}")
        settings = Settings(
            database_url=f"sqlite+aiosqlite:///{db_path}",
            app_master_key="eval-master-key",
            auth_password_hash=PasswordHasher(
                time_cost=1, memory_cost=64, parallelism=1, type=Type.ID
            ).hash(_PASSWORD),
            auth_cookie_secure=False,
            auth_login_delay_seconds=0.0,
            google_client_id="eval-client-id",
            google_client_secret="eval-client-secret",
        )
        app = create_app(settings, calendar_source=calendar_source)  # type: ignore[arg-type]
        with TestClient(app, follow_redirects=False) as client:
            response = client.post("/api/v1/auth/login", json={"password": _PASSWORD})
            assert response.status_code == 204, response.text
            yield client


def _seed_google(client: TestClient) -> None:
    """Drives the whole OAuth round trip as a browser would, so today's
    Events reach the snapshot through the real code path rather than a
    hand-written row."""
    from urllib.parse import parse_qs, urlparse

    connect = client.get("/api/v1/google/connect")
    assert connect.status_code == 302, connect.text
    state = parse_qs(urlparse(connect.headers["location"]).query)["state"][0]
    callback = client.get("/api/v1/google/callback", params={"code": "eval-code", "state": state})
    assert callback.status_code == 302, callback.text
    accounts = client.get("/api/v1/google/accounts").json()
    # Lazily seeds the calendar list, which is what marks it enabled.
    client.get(f"/api/v1/google/accounts/{accounts[0]['id']}/calendars")


def seed_world(client: TestClient, world: World) -> dict[str, int]:
    """Creates every List, Tag and Task over the API. Returns task ids by
    title, so an assertion can name a task the way a person would."""
    list_ids = {}
    for name in world.lists:
        response = client.post("/api/v1/lists", json={"name": name})
        assert response.status_code == 201, response.text
        list_ids[name] = response.json()["id"]
    tag_ids = {}
    for name in world.tags:
        response = client.post("/api/v1/tags", json={"name": name})
        assert response.status_code == 201, response.text
        tag_ids[name] = response.json()["id"]
    for name in world.habits:
        response = client.post("/api/v1/habits", json={"name": name})
        assert response.status_code == 201, response.text

    task_ids = {}
    for task in world.tasks:
        payload: dict[str, object] = {
            "title": task.title,
            "priority": task.priority,
            "is_all_day": task.is_all_day,
        }
        if task.due_date:
            payload["due_date"] = task.due_date
        if task.start_date:
            payload["start_date"] = task.start_date
        if task.list_name:
            payload["list_id"] = list_ids[task.list_name]
        if task.tag_names:
            payload["tag_ids"] = [tag_ids[name] for name in task.tag_names]
        response = client.post("/api/v1/tasks", json=payload)
        assert response.status_code == 201, response.text
        task_ids[task.title] = response.json()["id"]
    return task_ids


def configure_assistant(client: TestClient, provider: ProviderConfig, preferences: str) -> None:
    response = client.put(
        "/api/v1/assistant/config",
        json={
            "base_url": provider.base_url,
            "model": provider.model,
            "api_key": provider.api_key,
            "planning_preferences": preferences,
        },
    )
    assert response.status_code == 200, response.text


def run_scenario(scenario: Scenario, provider: ProviderConfig) -> Result:
    """Seeds the scenario's world, asks the real model to plan, and returns
    the turn for scoring."""
    events = [
        CalendarEventEntry(
            google_event_id=f"eval-{index}",
            summary=event.title,
            start=event.start,
            end=event.end,
            is_all_day=event.is_all_day,
        )
        for index, event in enumerate(scenario.world.events)
    ]
    with booted_app(events) as client:
        if events:
            _seed_google(client)
        task_ids = seed_world(client, scenario.world)
        configure_assistant(client, provider, scenario.preferences)
        response = client.post(
            "/api/v1/assistant/chat",
            json={
                "transcript": [{"role": "user", "content": scenario.prompt}],
                "local_date": MONDAY.isoformat(),
                "time_zone": TIME_ZONE,
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
    return Result(
        message=body["message"],
        suggestions=body["suggestions"],
        discarded_count=body["discarded_count"],
        world=scenario.world,
        task_ids=task_ids,
    )


def score(scenario: Scenario, result: Result) -> list[tuple[str, list[str]]]:
    """Every check's name and its failures — empty failures means passed."""
    return [(name, check(result)) for name, check in scenario.checks]
