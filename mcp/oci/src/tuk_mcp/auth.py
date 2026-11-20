"""Who is calling: the MCP token exchange (issue #525, ADR 0016's amendment).

One shared HTTP server serves every User and holds no User's credential.
Each client sends its User's MCP token (`tuk_mcp_...`) as its bearer. On
every MCP request, before anything else is read, the server trades that
token at the backend's exchange route, authenticated with the deployment's
MCP service key, for a short-lived access credential (a `Grant`). The
tools use only that credential, for that one request: the MCP token itself
is never sent to any other backend route (no token passthrough), and no
positive result is cached, so a revoked token or a disabled User is
refused on the very next request.

The backend's address is fixed by the server's configuration, never by a
client, and redirects are never followed: the service key and the MCP
token go to that one address or nowhere.
"""

import re
from dataclasses import dataclass

import httpx

from .clients import ClientKey

EXCHANGE_PATH = "/api/v1/auth/mcp/exchange"
MCP_TOKEN = re.compile(r"^tuk_mcp_[1-9][0-9]{0,9}_[0-9a-f]{64}$")
MIN_SERVICE_KEY_LENGTH = 32


@dataclass(frozen=True)
class Grant:
    """One MCP request's identity: whose token, and what to call the API with."""

    user_id: int
    token_id: int
    access_token: str

    @property
    def client_key(self) -> ClientKey:
        """Which client's state this request may touch: from the backend's
        answer, never from anything the client sent."""
        return (self.user_id, self.token_id)


class TokenRejectedError(Exception):
    """The backend refused the MCP token: unknown, revoked, or its User
    disabled or blocked on a forced step."""


class BackendUnavailableError(Exception):
    """The backend could not say: unreachable, or an unexpected answer.
    The request fails closed."""


def bearer_token(header: str) -> str | None:
    """The MCP token an `Authorization` header carries, or None when it is
    not one. Shape only: a token-shaped string is not authenticated yet."""
    scheme, _, credential = header.partition(" ")
    if scheme.lower() != "bearer" or not MCP_TOKEN.match(credential):
        return None
    return credential


class Exchanger:
    def __init__(
        self,
        base_url: str,
        service_key: str,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if len(service_key) < MIN_SERVICE_KEY_LENGTH:
            raise ValueError(
                f"MCP_SERVICE_KEY must be at least {MIN_SERVICE_KEY_LENGTH} characters."
            )
        self._http = httpx.Client(
            base_url=base_url,
            transport=transport,
            timeout=10.0,
            follow_redirects=False,
            headers={"Authorization": f"Bearer {service_key}"},
        )

    def exchange(self, mcp_token: str) -> Grant:
        try:
            response = self._http.post(EXCHANGE_PATH, json={"token": mcp_token})
        except httpx.HTTPError:
            raise BackendUnavailableError from None
        try:
            body = response.json()
        except ValueError:
            raise BackendUnavailableError from None
        body = body if isinstance(body, dict) else {}
        if response.status_code in (401, 403):
            error = body.get("error")
            code = error.get("code") if isinstance(error, dict) else None
            # `unauthorized` is the backend refusing this server's service
            # key: a misconfigured deployment, not the client's fault.
            if code == "unauthorized":
                raise BackendUnavailableError
            raise TokenRejectedError
        if response.status_code != 200:
            raise BackendUnavailableError
        user_id, token_id, access = (
            body.get("user_id"),
            body.get("token_id"),
            body.get("access_token"),
        )
        if not (
            isinstance(user_id, int)
            and isinstance(token_id, int)
            and isinstance(access, str)
            and access
        ):
            raise BackendUnavailableError
        return Grant(user_id=user_id, token_id=token_id, access_token=access)

    def close(self) -> None:
        self._http.close()
