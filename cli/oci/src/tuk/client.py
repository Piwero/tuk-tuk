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
        self, session_cookie: str, path: str, fallback: str
    ) -> tuple[list[dict[str, object]], str | None]:
        """Every row of a small collection, following the page. Lists and Tags
        only exist to resolve a typed name, so the client reads the whole set;
        the 200-row page keeps this to one request in practice."""
        items: list[dict[str, object]] = []
        refreshed: str | None = None
        offset = 0
        while True:
            response = self._http.get(
                path,
                params={"limit": 200, "offset": offset},
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

    def read_tags(self, session_cookie: str) -> tuple[list[dict[str, object]], str | None]:
        """Every Tag, for resolving typed names — never creating one."""
        return self._fetch_all(session_cookie, "/api/v1/tags", "Could not list tags")

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
