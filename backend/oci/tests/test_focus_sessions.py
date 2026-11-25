"""Focus Sessions: Pomo & Stopwatch timers (issue #34).

A Focus Session is one persisted period of focused work. Timers tick
client-side; the backend stores finished (or retroactively added) sessions
only: mode, start/end, pause duration, an optional note, and an optional
link to one Task or Habit.
"""

from fastapi.testclient import TestClient

from tests.conftest import create_user_row, log_in, make_task
from tests.test_habits import make_habit


def make_session(client: TestClient, **fields: object) -> dict:
    """Create a Focus Session over the API and return its JSON body."""
    payload = {
        "mode": "stopwatch",
        "started_at": "2026-07-03T10:00:00Z",
        "ended_at": "2026-07-03T10:30:00Z",
        **fields,
    }
    response = client.post("/api/v1/focus-sessions", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


class TestCreateFocusSession:
    def test_persists_a_finished_stopwatch_session(self, client: TestClient) -> None:
        body = make_session(client)

        assert body["mode"] == "stopwatch"
        assert body["started_at"] == "2026-07-03T10:00:00Z"
        assert body["ended_at"] == "2026-07-03T10:30:00Z"
        assert body["pause_seconds"] == 0
        assert body["duration_seconds"] == 1800
        assert body["note"] == ""
        assert body["task_id"] is None
        assert body["habit_id"] is None
        assert isinstance(body["id"], int)

    def test_pause_time_is_tracked_separately_from_focus_time(self, client: TestClient) -> None:
        body = make_session(client, mode="pomo", pause_seconds=300, note="deep work")

        assert body["mode"] == "pomo"
        assert body["pause_seconds"] == 300
        # 30 wall-clock minutes minus 5 paused: 25 minutes of honest focus.
        assert body["duration_seconds"] == 1500
        assert body["note"] == "deep work"

    def test_links_to_a_task(self, client: TestClient) -> None:
        task = make_task(client, "Write report")

        body = make_session(client, task_id=task["id"])

        assert body["task_id"] == task["id"]
        assert body["habit_id"] is None

    def test_links_to_a_habit(self, client: TestClient) -> None:
        habit = make_habit(client, "Reading")

        body = make_session(client, habit_id=habit["id"])

        assert body["habit_id"] == habit["id"]

    def test_rejects_linking_both_a_task_and_a_habit(self, client: TestClient) -> None:
        task = make_task(client, "Write report")
        habit = make_habit(client, "Reading")

        response = client.post(
            "/api/v1/focus-sessions",
            json={
                "mode": "stopwatch",
                "started_at": "2026-07-03T10:00:00Z",
                "ended_at": "2026-07-03T10:30:00Z",
                "task_id": task["id"],
                "habit_id": habit["id"],
            },
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_session"

    def test_unknown_links_are_404(self, client: TestClient) -> None:
        for fields in ({"task_id": 999}, {"habit_id": 999}):
            response = client.post(
                "/api/v1/focus-sessions",
                json={
                    "mode": "stopwatch",
                    "started_at": "2026-07-03T10:00:00Z",
                    "ended_at": "2026-07-03T10:30:00Z",
                    **fields,
                },
            )

            assert response.status_code == 404, fields

    def test_rejects_an_end_that_does_not_follow_the_start(self, client: TestClient) -> None:
        for ended_at in ("2026-07-03T10:00:00Z", "2026-07-03T09:59:00Z"):
            response = client.post(
                "/api/v1/focus-sessions",
                json={
                    "mode": "stopwatch",
                    "started_at": "2026-07-03T10:00:00Z",
                    "ended_at": ended_at,
                },
            )

            assert response.status_code == 422, ended_at
            assert response.json()["error"]["code"] == "invalid_session"

    def test_rejects_a_pause_that_consumes_the_whole_session(self, client: TestClient) -> None:
        # 1801 s exceeds the 1800 s span; 1800 s would leave zero focus time.
        for pause_seconds in (1801, 1800):
            response = client.post(
                "/api/v1/focus-sessions",
                json={
                    "mode": "stopwatch",
                    "started_at": "2026-07-03T10:00:00Z",
                    "ended_at": "2026-07-03T10:30:00Z",
                    "pause_seconds": pause_seconds,
                },
            )

            assert response.status_code == 422, pause_seconds
            assert response.json()["error"]["code"] == "invalid_session"


class TestListEditDelete:
    def test_lists_sessions_most_recently_started_first(self, client: TestClient) -> None:
        make_session(client, started_at="2026-07-03T08:00:00Z", ended_at="2026-07-03T08:25:00Z")
        make_session(client, started_at="2026-07-03T12:00:00Z", ended_at="2026-07-03T12:25:00Z")
        make_session(client, started_at="2026-07-03T10:00:00Z", ended_at="2026-07-03T10:25:00Z")

        page = client.get("/api/v1/focus-sessions").json()

        assert [item["started_at"] for item in page["items"]] == [
            "2026-07-03T12:00:00Z",
            "2026-07-03T10:00:00Z",
            "2026-07-03T08:00:00Z",
        ]

    def test_edits_times_note_and_link_retroactively(self, client: TestClient) -> None:
        task = make_task(client, "Write report")
        session = make_session(client)

        response = client.patch(
            f"/api/v1/focus-sessions/{session['id']}",
            json={
                "started_at": "2026-07-03T09:00:00Z",
                "ended_at": "2026-07-03T09:50:00Z",
                "pause_seconds": 600,
                "note": "edited",
                "task_id": task["id"],
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["started_at"] == "2026-07-03T09:00:00Z"
        assert body["duration_seconds"] == 2400
        assert body["note"] == "edited"
        assert body["task_id"] == task["id"]

    def test_linking_a_habit_replaces_a_task_link(self, client: TestClient) -> None:
        task = make_task(client, "Write report")
        habit = make_habit(client, "Reading")
        session = make_session(client, task_id=task["id"])

        body = client.patch(
            f"/api/v1/focus-sessions/{session['id']}", json={"habit_id": habit["id"]}
        ).json()

        assert body["habit_id"] == habit["id"]
        assert body["task_id"] is None

    def test_null_unlinks_a_session(self, client: TestClient) -> None:
        task = make_task(client, "Write report")
        session = make_session(client, task_id=task["id"])

        body = client.patch(
            f"/api/v1/focus-sessions/{session['id']}", json={"task_id": None}
        ).json()

        assert body["task_id"] is None

    def test_the_edited_period_is_validated_as_a_whole(self, client: TestClient) -> None:
        session = make_session(client)  # 10:00 -> 10:30

        response = client.patch(
            f"/api/v1/focus-sessions/{session['id']}",
            json={"ended_at": "2026-07-03T09:00:00Z"},
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_session"

    def test_delete_removes_the_session(self, client: TestClient) -> None:
        session = make_session(client)

        assert client.delete(f"/api/v1/focus-sessions/{session['id']}").status_code == 204
        assert client.get("/api/v1/focus-sessions").json()["total"] == 0

    def test_unknown_session_is_404(self, client: TestClient) -> None:
        assert client.patch("/api/v1/focus-sessions/999", json={}).status_code == 404
        assert client.delete("/api/v1/focus-sessions/999").status_code == 404


class TestLinkedRowDeletion:
    def test_deleting_a_task_unlinks_its_sessions_but_keeps_them(self, client: TestClient) -> None:
        task = make_task(client, "Write report")
        session = make_session(client, task_id=task["id"])

        assert client.delete(f"/api/v1/tasks/{task['id']}").status_code == 204

        page = client.get("/api/v1/focus-sessions").json()
        assert page["total"] == 1
        assert page["items"][0]["id"] == session["id"]
        assert page["items"][0]["task_id"] is None

    def test_deleting_a_habit_unlinks_its_sessions_but_keeps_them(self, client: TestClient) -> None:
        habit = make_habit(client, "Reading")
        make_session(client, habit_id=habit["id"])

        assert client.delete(f"/api/v1/habits/{habit['id']}").status_code == 204

        page = client.get("/api/v1/focus-sessions").json()
        assert page["total"] == 1
        assert page["items"][0]["habit_id"] is None


def test_a_single_focus_session_is_readable(client: TestClient) -> None:
    created = make_session(client)

    response = client.get(f"/api/v1/focus-sessions/{created['id']}")

    assert response.status_code == 200
    assert response.json() == created


def test_unknown_focus_session_is_404(client: TestClient) -> None:
    response = client.get("/api/v1/focus-sessions/999")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


RUN_ID = "6f1c2b0e-3a4d-4e5f-8a9b-0c1d2e3f4a5b"


class TestRetrySafeCreate:
    """Issue #546: a finished run carries a client-generated `client_run_id`,
    so a create retried after a lost response records one session, not two."""

    def test_a_retried_create_for_the_same_run_records_one_session(
        self, client: TestClient
    ) -> None:
        first = make_session(client, client_run_id=RUN_ID)

        # The response was lost; the client retries, its end a little later.
        retry = client.post(
            "/api/v1/focus-sessions",
            json={
                "mode": "stopwatch",
                "started_at": "2026-07-03T10:00:00Z",
                "ended_at": "2026-07-03T10:30:05Z",
                "client_run_id": RUN_ID,
            },
        )

        assert retry.status_code == 200, retry.text
        assert retry.json() == first
        assert client.get("/api/v1/focus-sessions").json()["total"] == 1

    def test_different_runs_record_different_sessions(self, client: TestClient) -> None:
        make_session(client, client_run_id=RUN_ID)
        make_session(client, client_run_id="0a6e0c4f-1111-4222-8333-944455556666")

        assert client.get("/api/v1/focus-sessions").json()["total"] == 2

    def test_creates_without_a_run_id_are_never_merged(self, client: TestClient) -> None:
        make_session(client)
        make_session(client)

        assert client.get("/api/v1/focus-sessions").json()["total"] == 2

    def test_the_run_id_is_scoped_to_its_user(self, client: TestClient) -> None:
        alice_session = make_session(client, client_run_id=RUN_ID)
        create_user_row(client, "bea", "bea@example.com")
        log_in(client, "bea")

        bea_session = make_session(client, client_run_id=RUN_ID)

        assert bea_session["id"] != alice_session["id"]
        assert client.get("/api/v1/focus-sessions").json()["total"] == 1

    def test_rejects_a_blank_run_id(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/focus-sessions",
            json={
                "mode": "stopwatch",
                "started_at": "2026-07-03T10:00:00Z",
                "ended_at": "2026-07-03T10:30:00Z",
                "client_run_id": "",
            },
        )

        assert response.status_code == 422
