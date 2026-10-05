"""HTTP client. The transport is the only injection point."""

from dataclasses import asdict, dataclass

import httpx

from tuk.store import SESSION_COOKIE_NAME


class ClientError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class LoginRequest:
    """Thin client-side declaration of the login body — deliberately not
    imported from the backend, so installing the CLI never pulls in the
    database stack."""

    password: str


class Client:
    def __init__(self, base_url: str, transport: httpx.BaseTransport | None = None) -> None:
        self._http = httpx.Client(base_url=base_url, transport=transport)

    def login(self, password: str) -> str:
        response = self._http.post(
            "/api/v1/auth/login", json=asdict(LoginRequest(password=password))
        )
        if response.status_code == 204:
            cookie = response.cookies.get(SESSION_COOKIE_NAME)
            if not cookie:
                raise ClientError("login_failed", "Login succeeded but set no session cookie")
            return cookie
        raise self._error(response, "Login failed")

    def show_task(self, task_id: int, session_cookie: str) -> tuple[dict[str, object], str | None]:
        """Fetch one task. Returns the body plus a refreshed session cookie
        when the server reissued one, so an actively-used session stays alive.
        """
        response = self._http.get(
            f"/api/v1/tasks/{task_id}",
            headers={"Cookie": f"{SESSION_COOKIE_NAME}={session_cookie}"},
        )
        if response.status_code == 200:
            body = response.json()
            if not isinstance(body, dict):
                raise ClientError("bad_response", "Server returned a malformed task")
            return dict(body), response.cookies.get(SESSION_COOKIE_NAME)
        raise self._error(response, "Could not fetch task")

    def list_tasks(
        self,
        session_cookie: str,
        view: str,
        today: str | None,
        limit: int,
        offset: int,
    ) -> tuple[dict[str, object], str | None]:
        """One page of a Smart List view. Returns the API's page body plus a
        refreshed session cookie when the server reissued one."""
        params: dict[str, str | int] = {"view": view, "limit": limit, "offset": offset}
        if today is not None:
            params["today"] = today
        response = self._http.get(
            "/api/v1/tasks",
            params=params,
            headers={"Cookie": f"{SESSION_COOKIE_NAME}={session_cookie}"},
        )
        if response.status_code == 200:
            body = response.json()
            if not isinstance(body, dict):
                raise ClientError("bad_response", "Server returned a malformed task list")
            return dict(body), response.cookies.get(SESSION_COOKIE_NAME)
        raise self._error(response, "Could not list tasks")

    def _fetch_all(
        self,
        session_cookie: str,
        path: str,
        fallback: str,
        extra: dict[str, str | int] | None = None,
    ) -> tuple[list[dict[str, object]], str | None]:
        """Every row of a small collection, following the page. Lists and Tags
        only exist to resolve a typed name, so the client reads the whole set;
        the 200-row page keeps this to one request in practice."""
        items: list[dict[str, object]] = []
        refreshed: str | None = None
        offset = 0
        while True:
            params: dict[str, str | int] = {"limit": 200, "offset": offset}
            if extra:
                params.update(extra)
            response = self._http.get(
                path,
                params=params,
                headers={"Cookie": f"{SESSION_COOKIE_NAME}={session_cookie}"},
            )
            if response.status_code != 200:
                raise self._error(response, fallback)
            body = response.json()
            if not isinstance(body, dict) or not isinstance(body.get("items"), list):
                raise ClientError("bad_response", "Server returned a malformed collection")
            page = [row for row in body["items"] if isinstance(row, dict)]
            items += page
            total = body.get("total")
            refreshed = response.cookies.get(SESSION_COOKIE_NAME) or refreshed
            if not isinstance(total, int) or offset + len(page) >= total:
                return items, refreshed
            offset += len(page)

    def read_lists(self, session_cookie: str) -> tuple[list[dict[str, object]], str | None]:
        """Every List, for resolving a typed name — never creating one."""
        return self._fetch_all(session_cookie, "/api/v1/lists", "Could not list lists")

    def list_habits(
        self, session_cookie: str, due: str, limit: int = 200, offset: int = 0
    ) -> tuple[dict[str, object], str | None]:
        """One page of the Habits due on the caller's local day. Returns the
        API's page body — not a walked-and-rebuilt list — so `--json` can pass
        it straight through rather than inventing an envelope around it."""
        response = self._http.get(
            "/api/v1/habits",
            params={"due": due, "limit": limit, "offset": offset},
            headers={"Cookie": f"{SESSION_COOKIE_NAME}={session_cookie}"},
        )
        if response.status_code == 200:
            body = response.json()
            if not isinstance(body, dict):
                raise ClientError("bad_response", "Server returned a malformed habit list")
            return dict(body), response.cookies.get(SESSION_COOKIE_NAME)
        raise self._error(response, "Could not list habits")

    def read_tags(self, session_cookie: str) -> tuple[list[dict[str, object]], str | None]:
        """Every Tag, for resolving typed names — never creating one."""
        return self._fetch_all(session_cookie, "/api/v1/tags", "Could not list tags")

    def put_check_in(
        self, session_cookie: str, habit_id: int, day: str, value: float
    ) -> tuple[dict[str, object], str | None]:
        """Upsert the day's check-in: one row per (habit, date), so repeating
        it is harmless. Returns the check-in body plus a refreshed cookie."""
        response = self._http.put(
            f"/api/v1/habits/{habit_id}/check-ins/{day}",
            json={"value": value},
            headers={"Cookie": f"{SESSION_COOKIE_NAME}={session_cookie}"},
        )
        if response.status_code == 200:
            body = response.json()
            if not isinstance(body, dict):
                raise ClientError("bad_response", "Server returned a malformed check-in")
            return dict(body), response.cookies.get(SESSION_COOKIE_NAME)
        raise self._error(response, "Could not record check-in")

    def delete_check_in(self, session_cookie: str, habit_id: int, day: str) -> str | None:
        """Undo the day's check-in. Returns a refreshed cookie when reissued."""
        response = self._http.delete(
            f"/api/v1/habits/{habit_id}/check-ins/{day}",
            headers={"Cookie": f"{SESSION_COOKIE_NAME}={session_cookie}"},
        )
        if response.status_code == 204:
            return response.cookies.get(SESSION_COOKIE_NAME)
        raise self._error(response, "Could not undo check-in")

    def read_events(
        self, session_cookie: str, day: str
    ) -> tuple[list[dict[str, object]], str | None]:
        """The day's events across every enabled calendar. The endpoint
        answers empty (not 404) when Google is unconfigured, and isolates
        per-account failures into `failures` — both surface here as a plain
        event list, never an error for calendar trouble."""
        response = self._http.get(
            "/api/v1/events",
            params={"range_start": day, "range_end": day},
            headers={"Cookie": f"{SESSION_COOKIE_NAME}={session_cookie}"},
        )
        if response.status_code == 200:
            body = response.json()
            if not isinstance(body, dict) or not isinstance(body.get("events"), list):
                raise ClientError("bad_response", "Server returned malformed events")
            events = [row for row in body["events"] if isinstance(row, dict)]
            return events, response.cookies.get(SESSION_COOKIE_NAME)
        raise self._error(response, "Could not read events")

    def create_task(
        self, session_cookie: str, body: dict[str, object]
    ) -> tuple[dict[str, object], str | None]:
        """Create a Task. A missing list_id lands it in the Inbox — the API's
        doing, not the client's. Returns the created body plus a refreshed
        session cookie when the server reissued one."""
        response = self._http.post(
            "/api/v1/tasks",
            json=body,
            headers={"Cookie": f"{SESSION_COOKIE_NAME}={session_cookie}"},
        )
        if response.status_code == 201:
            created = response.json()
            if not isinstance(created, dict):
                raise ClientError("bad_response", "Server returned a malformed task")
            return dict(created), response.cookies.get(SESSION_COOKIE_NAME)
        raise self._error(response, "Could not add task")

    def _error(self, response: httpx.Response, fallback: str) -> ClientError:
        try:
            error = response.json().get("error", {})
        except ValueError:
            return ClientError("http_error", f"{fallback} (status {response.status_code})")
        code = error.get("code", "http_error")
        message = error.get("message", fallback)
        return ClientError(str(code), str(message))

    def close(self) -> None:
        self._http.close()
