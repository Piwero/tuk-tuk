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
