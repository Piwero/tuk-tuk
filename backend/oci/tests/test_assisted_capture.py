"""Assisted Capture's parse endpoint (ADR 0005; issue #43).

Assist only ever adds value, never subtracts it: every failure mode here —
unset/unreachable Ollama, a malformed extraction, an empty extraction, an
empty residual title, or an unresolvable date phrase — degrades to the text
exactly as typed, never a blocking error.
"""

import datetime as dt
import json
import socket
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.date_phrase import resolve_date_phrase
from app.main import create_app
from app.priority_phrase import resolve_priority_phrase
from app.recurrence_phrase import resolve_recurrence_phrase
from app.reminder_phrase import resolve_reminder_phrase
from tests.conftest import TEST_PASSWORD, FakeClock


class _OllamaHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/api/tags":
            self.send_response(404)
            self.end_headers()
            return
        self._reply({"models": [{"name": "qwen3:14b"}]})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/generate":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        extraction = self.server.extraction  # type: ignore[attr-defined]
        if extraction is _RAISE:
            self.send_response(500)
            self.end_headers()
            return
        self._reply({"response": json.dumps(extraction)})

    def _reply(self, payload: object) -> None:
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass


_RAISE = object()


class StubOllama:
    def __init__(self) -> None:
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _OllamaHandler)
        self._server.extraction = {  # type: ignore[attr-defined]
            "title": "dentist",
            "date_phrase": "tuesday 3pm",
            "recurrence_phrase": None,
            "reminder_phrase": None,
            "list_phrase": None,
            "tag_phrases": [],
            "priority_phrase": None,
        }
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    @property
    def base_url(self) -> str:
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    def set_extraction(
        self,
        title: str,
        date_phrase: str | None,
        recurrence_phrase: str | None = None,
        reminder_phrase: str | None = None,
        list_phrase: str | None = None,
        tag_phrases: list[str] | None = None,
        priority_phrase: str | None = None,
    ) -> None:
        self._server.extraction = {  # type: ignore[attr-defined]
            "title": title,
            "date_phrase": date_phrase,
            "recurrence_phrase": recurrence_phrase,
            "reminder_phrase": reminder_phrase,
            "list_phrase": list_phrase,
            "tag_phrases": tag_phrases or [],
            "priority_phrase": priority_phrase,
        }

    def set_malformed_extraction(self) -> None:
        self._server.extraction = "not an object"  # type: ignore[attr-defined]

    def set_failing(self) -> None:
        self._server.extraction = _RAISE  # type: ignore[attr-defined]

    def stop(self) -> None:
        self._server.shutdown()
        self._thread.join()


@pytest.fixture
def stub_ollama() -> Iterator[StubOllama]:
    stub = StubOllama()
    yield stub
    stub.stop()


def _closed_port_url() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return f"http://127.0.0.1:{port}"


@contextmanager
def make_client(
    database_url: str, fake_clock: FakeClock, **overrides: object
) -> Iterator[TestClient]:
    app = create_app(Settings(database_url=database_url, **overrides), clock=fake_clock)  # type: ignore[arg-type]
    with TestClient(app) as test_client:
        response = test_client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})
        assert response.status_code == 204, response.text
        yield test_client


def _configure(client: TestClient, base_url: str, model: str = "qwen3:14b") -> None:
    response = client.put(
        "/api/v1/assist/config", json={"ollama_base_url": base_url, "model": model}
    )
    assert response.status_code == 200, response.text


class TestParseCapture:
    def test_falls_back_to_plain_capture_when_assist_is_unconfigured(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(database_url, fake_clock) as client:
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentist tuesday 3pm",
                    "local_date": "2026-08-17",
                    "time_zone": "America/New_York",
                },
            )

        assert response.status_code == 200
        assert response.json() == {
            "title": "dentist tuesday 3pm",
            "due_date": None,
            "is_all_day": False,
            "time_zone": None,
            "recurrence": None,
            "reminders": [],
            "list_name": None,
            "tag_names": [],
            "priority": None,
        }

    def test_falls_back_when_ollama_is_unreachable(
        self, database_url: str, fake_clock: FakeClock
    ) -> None:
        with make_client(
            database_url,
            fake_clock,
            assist_ollama_base_url=_closed_port_url(),
            assist_model="qwen3:14b",
        ) as client:
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentist tuesday 3pm",
                    "local_date": "2026-08-17",
                    "time_zone": "America/New_York",
                },
            )

        assert response.status_code == 200
        assert response.json()["due_date"] is None
        assert response.json()["title"] == "dentist tuesday 3pm"

    def test_falls_back_on_a_malformed_extraction(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_malformed_extraction()
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentist tuesday 3pm",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        assert response.json() == {
            "title": "dentist tuesday 3pm",
            "due_date": None,
            "is_all_day": False,
            "time_zone": None,
            "recurrence": None,
            "reminders": [],
            "list_name": None,
            "tag_names": [],
            "priority": None,
        }

    def test_falls_back_when_ollama_errors(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_failing()
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentist tuesday 3pm",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        assert response.json()["due_date"] is None

    def test_empty_extraction_degrades_to_plain_capture(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction("call mom", None)
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={"text": "call mom", "local_date": "2026-08-17", "time_zone": "UTC"},
            )

        assert response.status_code == 200
        assert response.json() == {
            "title": "call mom",
            "due_date": None,
            "is_all_day": False,
            "time_zone": None,
            "recurrence": None,
            "reminders": [],
            "list_name": None,
            "tag_names": [],
            "priority": None,
        }

    def test_empty_residual_title_falls_back_to_the_full_typed_text(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction("", None)
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={"text": "tomorrow", "local_date": "2026-08-17", "time_zone": "UTC"},
            )

        assert response.status_code == 200
        assert response.json()["title"] == "tomorrow"

    def test_an_unresolvable_date_phrase_still_saves_the_stripped_title_with_no_date(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction("dentist", "sometime soon")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentist sometime soon",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        assert response.json() == {
            "title": "dentist",
            "due_date": None,
            "is_all_day": False,
            "time_zone": None,
            "recurrence": None,
            "reminders": [],
            "list_name": None,
            "tag_names": [],
            "priority": None,
        }

    def test_resolves_a_weekday_and_time_phrase_against_the_client_local_date(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        # 2026-08-17 is a Monday; "tuesday 3pm" should resolve to 2026-08-18.
        stub_ollama.set_extraction("dentist", "tuesday 3pm")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentist tuesday 3pm",
                    "local_date": "2026-08-17",
                    "time_zone": "America/New_York",
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "dentist"
        assert body["due_date"] == "2026-08-18T15:00:00-04:00"
        assert body["is_all_day"] is False
        assert body["time_zone"] == "America/New_York"

    def test_resolves_tomorrow_as_all_day(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction("call mom", "tomorrow")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={"text": "call mom tomorrow", "local_date": "2026-08-17", "time_zone": "UTC"},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["due_date"] == "2026-08-18T00:00:00Z"
        assert body["is_all_day"] is True

    def test_the_created_task_can_be_confirmed_through_the_existing_task_endpoint(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        """The confirmation beat's own write path — this endpoint returns a
        draft only; confirming a Suggestion always goes through the same
        POST /api/v1/tasks every other Task creation uses (ADR 0005: no
        Suggestion entity, no separate persistence path)."""
        stub_ollama.set_extraction("dentist", "tomorrow")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            draft = client.post(
                "/api/v1/assist/parse-capture",
                json={"text": "dentist tomorrow", "local_date": "2026-08-17", "time_zone": "UTC"},
            ).json()

            created = client.post(
                "/api/v1/tasks",
                json={
                    "title": draft["title"],
                    "due_date": draft["due_date"],
                    "is_all_day": draft["is_all_day"],
                    "time_zone": draft["time_zone"],
                },
            )

        assert created.status_code == 201, created.text
        assert created.json()["title"] == "dentist"
        assert created.json()["due_date"] == "2026-08-18T00:00:00Z"


class TestParseCaptureRecurrenceAndReminders:
    """Recurrence and reminder resolution through the parse endpoint
    (issue #44). Both require a resolved date to attach to — a Task
    without one can't recur or hold reminders — so both are gated on
    `date_phrase` also resolving.
    """

    @pytest.mark.parametrize(
        ("recurrence_phrase", "rrule"),
        [
            ("daily", "FREQ=DAILY"),
            ("weekly", "FREQ=WEEKLY"),
            ("monthly", "FREQ=MONTHLY"),
            ("yearly", "FREQ=YEARLY"),
            ("every 2 weeks", "FREQ=WEEKLY;INTERVAL=2"),
            ("every monday and thursday", "FREQ=WEEKLY;BYDAY=MO,TH"),
            ("every month on the 1st", "FREQ=MONTHLY;BYMONTHDAY=1"),
        ],
    )
    def test_recurrence_resolution_matrix_through_the_parse_endpoint(
        self,
        database_url: str,
        fake_clock: FakeClock,
        stub_ollama: StubOllama,
        recurrence_phrase: str,
        rrule: str,
    ) -> None:
        stub_ollama.set_extraction(
            f"pay rent {recurrence_phrase}", "tomorrow", recurrence_phrase=recurrence_phrase
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": f"pay rent {recurrence_phrase} tomorrow",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        assert response.json()["recurrence"] == rrule

    @pytest.mark.parametrize(
        ("reminder_phrase", "offset"),
        [
            ("at the time", "PT0S"),
            ("the day before", "-P1D"),
            ("1 hour before", "-PT1H"),
            ("30 minutes before", "-PT30M"),
        ],
    )
    def test_reminder_resolution_matrix_through_the_parse_endpoint(
        self,
        database_url: str,
        fake_clock: FakeClock,
        stub_ollama: StubOllama,
        reminder_phrase: str,
        offset: str,
    ) -> None:
        stub_ollama.set_extraction(
            f"dentist {reminder_phrase}", "tomorrow", reminder_phrase=reminder_phrase
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": f"dentist {reminder_phrase} tomorrow",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        assert response.json()["reminders"] == [offset]

    def test_recurrence_phrase_resolves_to_rrule_and_is_stripped_from_the_title(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction(
            "pay rent every month on the 1st",
            "tomorrow",
            recurrence_phrase="every month on the 1st",
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "pay rent every month on the 1st tomorrow",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "pay rent"
        assert body["recurrence"] == "FREQ=MONTHLY;BYMONTHDAY=1"
        assert body["reminders"] == []

    def test_reminder_phrase_resolves_to_an_offset_and_is_stripped_from_the_title(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction(
            "dentist remind me the day before",
            "tuesday 3pm",
            reminder_phrase="remind me the day before",
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentist tuesday 3pm remind me the day before",
                    "local_date": "2026-08-17",
                    "time_zone": "America/New_York",
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "dentist"
        assert body["reminders"] == ["-P1D"]
        assert body["recurrence"] is None

    def test_recurrence_and_reminder_phrases_both_resolve_in_one_parse(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction(
            "pay rent every month on the 1st remind me 1 hour before",
            "tomorrow",
            recurrence_phrase="every month on the 1st",
            reminder_phrase="1 hour before",
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "pay rent every month on the 1st tomorrow remind me 1 hour before",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "pay rent remind me"
        assert body["recurrence"] == "FREQ=MONTHLY;BYMONTHDAY=1"
        assert body["reminders"] == ["-PT1H"]

    def test_unresolvable_recurrence_phrase_is_omitted_and_left_in_the_title(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction(
            "pay rent whenever I feel like it",
            "tomorrow",
            recurrence_phrase="whenever I feel like it",
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "pay rent whenever I feel like it tomorrow",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "pay rent whenever I feel like it"
        assert body["recurrence"] is None

    def test_unresolvable_reminder_phrase_is_omitted_and_left_in_the_title(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction(
            "dentist ping me eventually", "tomorrow", reminder_phrase="ping me eventually"
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentist ping me eventually tomorrow",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "dentist ping me eventually"
        assert body["reminders"] == []

    def test_recurrence_and_reminder_phrases_are_ignored_without_a_resolved_date(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction(
            "pay rent every month on the 1st",
            None,
            recurrence_phrase="every month on the 1st",
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "pay rent every month on the 1st",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["due_date"] is None
        assert body["recurrence"] is None
        assert body["reminders"] == []

    def test_the_created_task_can_be_confirmed_with_recurrence_and_reminders(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction(
            "pay rent every month on the 1st",
            "tomorrow",
            recurrence_phrase="every month on the 1st",
            reminder_phrase="the day before",
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            draft = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "pay rent every month on the 1st tomorrow the day before",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            ).json()

            created = client.post(
                "/api/v1/tasks",
                json={
                    "title": draft["title"],
                    "due_date": draft["due_date"],
                    "is_all_day": draft["is_all_day"],
                    "time_zone": draft["time_zone"],
                    "recurrence": draft["recurrence"],
                    "reminders": draft["reminders"],
                },
            )

        assert created.status_code == 201, created.text
        assert created.json()["recurrence"] == "FREQ=MONTHLY;BYMONTHDAY=1"
        assert created.json()["reminders"] == ["-P1D"]


class TestParseCaptureListTagPriority:
    """List/Tag/Priority suggestions through the parse endpoint (issue #45).
    Match-existing-only: a name the model claims but that isn't in the
    request's `list_names`/`tag_names` candidates is silently dropped,
    never invented — the same posture as an unresolvable date/recurrence/
    reminder phrase, and independent of whether a date phrase resolves.
    """

    def test_a_list_phrase_matching_an_existing_list_proposes_a_list_name(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction("buy milk", None, list_phrase="errands")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "buy milk in my errands list",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                    "list_names": ["Errands", "Work"],
                },
            )

        assert response.status_code == 200
        assert response.json()["list_name"] == "Errands"

    def test_a_hallucinated_list_name_is_dropped(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction("buy milk in my groceries list", None, list_phrase="groceries")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "buy milk in my groceries list",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                    "list_names": ["Errands", "Work"],
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["list_name"] is None
        assert body["title"] == "buy milk in my groceries list"

    def test_tag_like_phrases_propose_tag_chips_only_for_existing_tags(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction(
            "call the plumber urgent shopping", None, tag_phrases=["urgent", "shopping"]
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "call the plumber urgent shopping",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                    "tag_names": ["Urgent", "Home"],
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["tag_names"] == ["Urgent"]
        assert body["title"] == "call the plumber shopping"

    @pytest.mark.parametrize(
        ("priority_phrase", "priority"),
        [("high priority", "high"), ("urgent", "high"), ("low", "low")],
    )
    def test_priority_phrases_map_to_the_existing_four_priority_levels(
        self,
        database_url: str,
        fake_clock: FakeClock,
        stub_ollama: StubOllama,
        priority_phrase: str,
        priority: str,
    ) -> None:
        stub_ollama.set_extraction(
            f"call mom {priority_phrase}", None, priority_phrase=priority_phrase
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": f"call mom {priority_phrase}",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        assert response.json()["priority"] == priority

    def test_list_tag_priority_resolve_without_a_resolved_date(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction(
            "buy milk",
            None,
            list_phrase="errands",
            tag_phrases=["urgent"],
            priority_phrase="high priority",
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "buy milk in my errands list urgent high priority",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                    "list_names": ["Errands"],
                    "tag_names": ["Urgent"],
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["due_date"] is None
        assert body["list_name"] == "Errands"
        assert body["tag_names"] == ["Urgent"]
        assert body["priority"] == "high"

    def test_the_created_task_can_be_confirmed_with_list_tags_and_priority(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction(
            "buy milk",
            None,
            list_phrase="errands",
            tag_phrases=["urgent"],
            priority_phrase="high priority",
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            list_response = client.post("/api/v1/lists", json={"name": "Errands"})
            assert list_response.status_code == 201, list_response.text
            list_id = list_response.json()["id"]
            tag_response = client.post("/api/v1/tags", json={"name": "Urgent"})
            assert tag_response.status_code == 201, tag_response.text
            tag_id = tag_response.json()["id"]

            draft = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "buy milk in my errands list urgent high priority",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                    "list_names": ["Errands"],
                    "tag_names": ["Urgent"],
                },
            ).json()
            assert draft["list_name"] == "Errands"
            assert draft["tag_names"] == ["Urgent"]
            assert draft["priority"] == "high"

            created = client.post(
                "/api/v1/tasks",
                json={
                    "title": draft["title"],
                    "list_id": list_id,
                    "tag_ids": [tag_id],
                    "priority": draft["priority"],
                },
            )

        assert created.status_code == 201, created.text
        assert created.json()["priority"] == "high"
        assert created.json()["tags"][0]["name"] == "Urgent"


class TestParseCaptureSpanish:
    """Spanish input through the parse endpoint (issue #46): the same
    resolution matrix as the English tests above, driven by Spanish
    date/recurrence/reminder/priority phrases, mirroring the EN behavior
    end to end through the HTTP seam with canned extractions.
    """

    def test_manana_resolves_as_all_day_tomorrow(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction("dentista", "mañana")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={"text": "dentista mañana", "local_date": "2026-08-17", "time_zone": "UTC"},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "dentista"
        assert body["due_date"] == "2026-08-18T00:00:00Z"
        assert body["is_all_day"] is True

    def test_weekday_and_time_phrase_resolves_against_the_client_local_date(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        # 2026-08-17 is a Monday; "martes a las 3" should resolve to 2026-08-18.
        stub_ollama.set_extraction("dentista", "martes a las 3")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentista martes a las 3",
                    "local_date": "2026-08-17",
                    "time_zone": "America/New_York",
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "dentista"
        assert body["due_date"] == "2026-08-18T03:00:00-04:00"
        assert body["is_all_day"] is False
        assert body["time_zone"] == "America/New_York"

    def test_el_weekday_que_viene_forces_the_next_occurrence(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        # 2026-08-17 is a Monday; "el lunes que viene" should skip today's
        # occurrence and land on 2026-08-24, mirroring "next monday".
        stub_ollama.set_extraction("pagar renta", "el lunes que viene")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "pagar renta el lunes que viene",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        assert response.json()["due_date"] == "2026-08-24T00:00:00Z"

    @pytest.mark.parametrize(
        ("recurrence_phrase", "rrule"),
        [
            ("diario", "FREQ=DAILY"),
            ("semanal", "FREQ=WEEKLY"),
            ("cada lunes", "FREQ=WEEKLY;BYDAY=MO"),
            ("cada lunes y jueves", "FREQ=WEEKLY;BYDAY=MO,TH"),
            ("cada 2 semanas", "FREQ=WEEKLY;INTERVAL=2"),
            ("todos los meses", "FREQ=MONTHLY"),
            ("cada mes el dia 1", "FREQ=MONTHLY;BYMONTHDAY=1"),
        ],
    )
    def test_recurrence_resolution_matrix_through_the_parse_endpoint(
        self,
        database_url: str,
        fake_clock: FakeClock,
        stub_ollama: StubOllama,
        recurrence_phrase: str,
        rrule: str,
    ) -> None:
        stub_ollama.set_extraction(
            f"pagar renta {recurrence_phrase}", "mañana", recurrence_phrase=recurrence_phrase
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": f"pagar renta {recurrence_phrase} mañana",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        assert response.json()["recurrence"] == rrule

    @pytest.mark.parametrize(
        ("reminder_phrase", "offset"),
        [
            ("a tiempo", "PT0S"),
            ("recuérdame el día antes", "-P1D"),
            ("1 hora antes", "-PT1H"),
            ("30 minutos antes", "-PT30M"),
        ],
    )
    def test_reminder_resolution_matrix_through_the_parse_endpoint(
        self,
        database_url: str,
        fake_clock: FakeClock,
        stub_ollama: StubOllama,
        reminder_phrase: str,
        offset: str,
    ) -> None:
        stub_ollama.set_extraction(
            f"dentista {reminder_phrase}", "mañana", reminder_phrase=reminder_phrase
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": f"dentista {reminder_phrase} mañana",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        assert response.json()["reminders"] == [offset]

    @pytest.mark.parametrize(
        ("priority_phrase", "priority"),
        [("prioridad alta", "high"), ("urgente", "high"), ("baja", "low")],
    )
    def test_priority_phrases_map_to_the_existing_four_priority_levels(
        self,
        database_url: str,
        fake_clock: FakeClock,
        stub_ollama: StubOllama,
        priority_phrase: str,
        priority: str,
    ) -> None:
        stub_ollama.set_extraction(
            f"llamar a mamá {priority_phrase}", None, priority_phrase=priority_phrase
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": f"llamar a mamá {priority_phrase}",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        assert response.json()["priority"] == priority

    def test_a_spanish_list_phrase_matching_an_existing_list_proposes_a_list_name(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        """List/Tag matching (app.name_phrase) is a literal case-insensitive
        match against the user's own List/Tag names, not a fixed-vocabulary
        resolver — so it needs no separate Spanish phrase set, only a
        Spanish extraction feeding it, exercised here end to end."""
        stub_ollama.set_extraction("comprar leche", None, list_phrase="mandados")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "comprar leche en mi lista de mandados",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                    "list_names": ["Mandados", "Trabajo"],
                },
            )

        assert response.status_code == 200
        assert response.json()["list_name"] == "Mandados"

    def test_mixed_language_recurrence_and_reminder_phrases_degrade_gracefully(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        """Unresolvable recurrence/reminder phrases never block the draft —
        same fallback posture as an unresolvable date phrase, exercised
        here with mixed EN/ES text."""
        stub_ollama.set_extraction(
            "pay rent cuando pueda avísame en algún momento",
            "mañana",
            recurrence_phrase="cuando pueda",
            reminder_phrase="avísame en algún momento",
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "pay rent cuando pueda mañana avísame en algún momento",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["due_date"] is not None
        assert body["recurrence"] is None
        assert body["reminders"] == []
        assert "cuando pueda" in body["title"]
        assert "avísame en algún momento" in body["title"]

    def test_mixed_language_input_degrades_gracefully_when_the_date_phrase_is_unresolvable(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        """Mixed EN/ES text never blocks capture: a phrase this resolver
        doesn't recognize just leaves the title untouched with no error,
        the same fallback as an unresolvable English phrase."""
        stub_ollama.set_extraction("dentista", "pronto")
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            response = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "dentista pronto next week maybe",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "dentista"
        assert body["due_date"] is None

    def test_the_created_task_can_be_confirmed_through_the_existing_task_endpoint(
        self, database_url: str, fake_clock: FakeClock, stub_ollama: StubOllama
    ) -> None:
        stub_ollama.set_extraction(
            "pagar renta",
            "mañana",
            recurrence_phrase="cada mes el dia 1",
            reminder_phrase="recuérdame el día antes",
        )
        with make_client(database_url, fake_clock) as client:
            _configure(client, stub_ollama.base_url)
            draft = client.post(
                "/api/v1/assist/parse-capture",
                json={
                    "text": "pagar renta cada mes el dia 1 mañana recuérdame el día antes",
                    "local_date": "2026-08-17",
                    "time_zone": "UTC",
                },
            ).json()

            created = client.post(
                "/api/v1/tasks",
                json={
                    "title": draft["title"],
                    "due_date": draft["due_date"],
                    "is_all_day": draft["is_all_day"],
                    "time_zone": draft["time_zone"],
                    "recurrence": draft["recurrence"],
                    "reminders": draft["reminders"],
                },
            )

        assert created.status_code == 201, created.text
        assert created.json()["recurrence"] == "FREQ=MONTHLY;BYMONTHDAY=1"
        assert created.json()["reminders"] == ["-P1D"]


class TestResolveDatePhrase:
    def test_tomorrow_is_all_day(self) -> None:
        result = resolve_date_phrase("tomorrow", dt.date(2026, 8, 17), "UTC")
        assert result is not None
        due_date, is_all_day = result
        assert is_all_day is True
        assert due_date.date().isoformat() == "2026-08-18"

    def test_next_weekday_skips_todays_occurrence(self) -> None:
        # 2026-08-18 is a Tuesday; "next tuesday" should be a week later.
        result = resolve_date_phrase("next tuesday", dt.date(2026, 8, 18), "UTC")
        assert result is not None
        assert result[0].date().isoformat() == "2026-08-25"

    def test_bare_weekday_can_resolve_to_today(self) -> None:
        result = resolve_date_phrase("tuesday", dt.date(2026, 8, 18), "UTC")
        assert result is not None
        assert result[0].date().isoformat() == "2026-08-18"

    def test_unrecognized_phrase_returns_none(self) -> None:
        assert resolve_date_phrase("sometime soon", dt.date(2026, 8, 17), "UTC") is None

    def test_unrecognized_time_returns_none(self) -> None:
        assert resolve_date_phrase("tomorrow 25:99", dt.date(2026, 8, 17), "UTC") is None

    def test_unknown_timezone_returns_none(self) -> None:
        assert resolve_date_phrase("tomorrow", dt.date(2026, 8, 17), "Not/AZone") is None

    def test_manana_is_all_day(self) -> None:
        result = resolve_date_phrase("mañana", dt.date(2026, 8, 17), "UTC")
        assert result is not None
        due_date, is_all_day = result
        assert is_all_day is True
        assert due_date.date().isoformat() == "2026-08-18"

    def test_hoy_resolves_to_the_local_date(self) -> None:
        result = resolve_date_phrase("hoy", dt.date(2026, 8, 17), "UTC")
        assert result is not None
        assert result[0].date().isoformat() == "2026-08-17"

    def test_bare_spanish_weekday_can_resolve_to_today(self) -> None:
        # 2026-08-18 is a Tuesday.
        result = resolve_date_phrase("martes", dt.date(2026, 8, 18), "UTC")
        assert result is not None
        assert result[0].date().isoformat() == "2026-08-18"

    def test_proximo_weekday_skips_todays_occurrence(self) -> None:
        # 2026-08-18 is a Tuesday; "próximo martes" should be a week later.
        result = resolve_date_phrase("próximo martes", dt.date(2026, 8, 18), "UTC")
        assert result is not None
        assert result[0].date().isoformat() == "2026-08-25"

    def test_weekday_que_viene_skips_todays_occurrence(self) -> None:
        result = resolve_date_phrase("martes que viene", dt.date(2026, 8, 18), "UTC")
        assert result is not None
        assert result[0].date().isoformat() == "2026-08-25"

    def test_weekday_and_time_phrase_with_a_las(self) -> None:
        result = resolve_date_phrase("martes a las 15", dt.date(2026, 8, 17), "UTC")
        assert result is not None
        due_date, is_all_day = result
        assert is_all_day is False
        assert due_date.time().isoformat() == "15:00:00"

    def test_unrecognized_spanish_phrase_returns_none(self) -> None:
        assert resolve_date_phrase("pronto", dt.date(2026, 8, 17), "UTC") is None


class TestResolveRecurrencePhrase:
    @pytest.mark.parametrize(
        ("phrase", "rrule"),
        [
            ("daily", "FREQ=DAILY"),
            ("weekly", "FREQ=WEEKLY"),
            ("monthly", "FREQ=MONTHLY"),
            ("yearly", "FREQ=YEARLY"),
            ("annually", "FREQ=YEARLY"),
            ("every day", "FREQ=DAILY"),
            ("every week", "FREQ=WEEKLY"),
            ("every month", "FREQ=MONTHLY"),
            ("every year", "FREQ=YEARLY"),
            ("every 2 weeks", "FREQ=WEEKLY;INTERVAL=2"),
            ("every 3 days", "FREQ=DAILY;INTERVAL=3"),
            ("every monday", "FREQ=WEEKLY;BYDAY=MO"),
            ("every monday and thursday", "FREQ=WEEKLY;BYDAY=MO,TH"),
            ("every month on the 1st", "FREQ=MONTHLY;BYMONTHDAY=1"),
            ("every month on the 15th", "FREQ=MONTHLY;BYMONTHDAY=15"),
        ],
    )
    def test_common_recurrence_phrases_resolve(self, phrase: str, rrule: str) -> None:
        assert resolve_recurrence_phrase(phrase) == rrule

    def test_unrecognized_phrase_returns_none(self) -> None:
        assert resolve_recurrence_phrase("whenever I feel like it") is None

    def test_every_with_no_unit_returns_none(self) -> None:
        assert resolve_recurrence_phrase("every") is None

    def test_out_of_range_month_day_returns_none(self) -> None:
        assert resolve_recurrence_phrase("every month on the 32nd") is None

    @pytest.mark.parametrize(
        ("phrase", "rrule"),
        [
            ("diario", "FREQ=DAILY"),
            ("diariamente", "FREQ=DAILY"),
            ("semanal", "FREQ=WEEKLY"),
            ("mensual", "FREQ=MONTHLY"),
            ("anual", "FREQ=YEARLY"),
            ("cada dia", "FREQ=DAILY"),
            ("cada semana", "FREQ=WEEKLY"),
            ("cada mes", "FREQ=MONTHLY"),
            ("cada año", "FREQ=YEARLY"),
            ("cada 2 semanas", "FREQ=WEEKLY;INTERVAL=2"),
            ("cada 3 dias", "FREQ=DAILY;INTERVAL=3"),
            ("cada lunes", "FREQ=WEEKLY;BYDAY=MO"),
            ("cada lunes y jueves", "FREQ=WEEKLY;BYDAY=MO,TH"),
            ("cada mes el dia 1", "FREQ=MONTHLY;BYMONTHDAY=1"),
            ("cada mes el dia 15", "FREQ=MONTHLY;BYMONTHDAY=15"),
            ("todos los dias", "FREQ=DAILY"),
            ("todos los meses", "FREQ=MONTHLY"),
            ("todos los lunes", "FREQ=WEEKLY;BYDAY=MO"),
        ],
    )
    def test_common_spanish_recurrence_phrases_resolve(self, phrase: str, rrule: str) -> None:
        assert resolve_recurrence_phrase(phrase) == rrule

    def test_unrecognized_spanish_phrase_returns_none(self) -> None:
        assert resolve_recurrence_phrase("cuando pueda") is None

    def test_cada_with_no_unit_returns_none(self) -> None:
        assert resolve_recurrence_phrase("cada") is None


class TestResolveReminderPhrase:
    @pytest.mark.parametrize(
        ("phrase", "offset"),
        [
            ("at the time", "PT0S"),
            ("on time", "PT0S"),
            ("the day before", "-P1D"),
            ("a day before", "-P1D"),
            ("1 hour before", "-PT1H"),
            ("2 hours before", "-PT2H"),
            ("30 minutes before", "-PT30M"),
            ("a week before", "-P7D"),
        ],
    )
    def test_common_reminder_phrases_resolve(self, phrase: str, offset: str) -> None:
        assert resolve_reminder_phrase(phrase) == offset

    def test_unrecognized_phrase_returns_none(self) -> None:
        assert resolve_reminder_phrase("ping me eventually") is None

    def test_missing_before_returns_none(self) -> None:
        assert resolve_reminder_phrase("1 hour") is None

    @pytest.mark.parametrize(
        ("phrase", "offset"),
        [
            ("a tiempo", "PT0S"),
            ("en el momento", "PT0S"),
            ("el día antes", "-P1D"),
            ("un día antes", "-P1D"),
            ("1 hora antes", "-PT1H"),
            ("2 horas antes", "-PT2H"),
            ("30 minutos antes", "-PT30M"),
            ("una semana antes", "-P7D"),
            ("recuérdame el día antes", "-P1D"),
        ],
    )
    def test_common_spanish_reminder_phrases_resolve(self, phrase: str, offset: str) -> None:
        assert resolve_reminder_phrase(phrase) == offset

    def test_unrecognized_spanish_phrase_returns_none(self) -> None:
        assert resolve_reminder_phrase("avísame en algún momento") is None

    def test_missing_antes_returns_none(self) -> None:
        assert resolve_reminder_phrase("1 hora") is None


class TestResolvePriorityPhrase:
    @pytest.mark.parametrize(
        ("phrase", "priority"),
        [
            ("high priority", "high"),
            ("urgent", "high"),
            ("asap", "high"),
            ("medium", "medium"),
            ("normal", "medium"),
            ("low", "low"),
            ("urgente", "high"),
            ("prioridad alta", "high"),
            ("media", "medium"),
            ("baja", "low"),
        ],
    )
    def test_priority_phrases_resolve(self, phrase: str, priority: str) -> None:
        assert resolve_priority_phrase(phrase) == priority

    def test_unrecognized_phrase_returns_none(self) -> None:
        assert resolve_priority_phrase("whenever") is None
