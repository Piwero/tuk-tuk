"""The MCP token exchange's access credential (issue #525, ADR 0016's
amendment).

A User's MCP token (`tuk_mcp_...`, app.api_tokens) has the shared MCP
server as its audience: the API never accepts it. The MCP server, holding
the deployment's MCP service key, trades it at the exchange route for an
access credential: `tuk_mcpa_<signed payload>` naming the User, the MCP
token it came from, and an expiry ACCESS_LIFETIME away. The MCP server uses
it for one MCP request and drops it.

Stateless and signed with the instance's session key under its own salt, so
it can never pass for a session cookie, nor a cookie for it. Revocation is
not left to the expiry: every request it authenticates re-checks that its
MCP token is still live and its User still active (app.middleware).
"""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta

from itsdangerous import BadSignature, URLSafeSerializer

MCP_EXCHANGE_PATH = "/api/v1/auth/mcp/exchange"
ACCESS_PREFIX = "tuk_mcpa_"
ACCESS_LIFETIME = timedelta(minutes=2)

_SALT = "tuk-tuk-mcp-access"

# All an access credential may reach: the routes the MCP server's tools call
# (tuk_mcp.tools, through tuk_core.client), exact method and full-path
# match. It is a bearer for its whole lifetime, so it gets no further than
# the tools themselves: no delete of any kind, no tokens, no settings.
_ID = r"[0-9]+"
_TOOL_ROUTES: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (method, re.compile(rf"^/api/v1/{path}$"))
    for method, path in (
        ("GET", "tasks"),
        ("POST", "tasks"),
        ("GET", f"tasks/{_ID}"),
        ("PATCH", f"tasks/{_ID}"),
        ("POST", f"tasks/{_ID}/check-items"),
        ("GET", "lists"),
        ("GET", "tags"),
        ("GET", "habits"),
        ("PUT", rf"habits/{_ID}/check-ins/[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}"),
        ("GET", "events"),
        ("GET", "goals"),
        ("GET", "focus-stats"),
    )
)


def reaches(method: str, path: str) -> bool:
    """Whether an access credential may be used for this request."""
    return any(method == m and pattern.match(path) for m, pattern in _TOOL_ROUTES)


@dataclass(frozen=True)
class AccessClaims:
    user_id: int
    token_id: int


def _serializer(session_key: str) -> URLSafeSerializer:
    return URLSafeSerializer(session_key, salt=_SALT)


def issue_access(session_key: str, *, user_id: int, token_id: int, now: datetime) -> str:
    payload = {"uid": user_id, "tid": token_id, "exp": (now + ACCESS_LIFETIME).timestamp()}
    signed: str = _serializer(session_key).dumps(payload)
    return ACCESS_PREFIX + signed


def is_access(credential: str) -> bool:
    return credential.startswith(ACCESS_PREFIX)


def verify_access(credential: str, session_key: str, now: datetime) -> AccessClaims | None:
    """The claims of a validly signed, unexpired access credential, else None."""
    if not is_access(credential):
        return None
    try:
        payload = _serializer(session_key).loads(credential.removeprefix(ACCESS_PREFIX))
    except BadSignature:
        return None
    if not isinstance(payload, dict):
        return None
    user_id, token_id, exp = payload.get("uid"), payload.get("tid"), payload.get("exp")
    if not isinstance(user_id, int) or not isinstance(token_id, int):
        return None
    if not isinstance(exp, int | float) or now.timestamp() >= exp:
        return None
    return AccessClaims(user_id=user_id, token_id=token_id)
