"""The MCP token exchange (issue #525, ADR 0016's amendment).

The shared MCP server serves every User through one deployment and holds
no User's credential. Each MCP client presents its User's MCP token; on
every MCP request the server posts that token here, authenticated with
the deployment's MCP service key, and gets back a short-lived access
credential (app.mcp_exchange) for that one request. The MCP token never
reaches any other route: the API refuses it (app.middleware).

The route is a public path to the session middleware: the service key, not
a User's session, is what lets a caller in, and each check below is made
fresh on every call, so a revoked token or a disabled User is refused on
the very next MCP request.
"""

import hmac

from fastapi import APIRouter, Request
from fastapi.responses import Response
from pydantic import BaseModel

from app.api_tokens import find_token, mark_used, owner_of
from app.app_settings import require_app_settings
from app.errors import APIError, NotFoundError, error_response
from app.mcp_exchange import ACCESS_LIFETIME, MCP_EXCHANGE_PATH, issue_access
from app.middleware import forced_step, token_login_method
from app.models import User
from app.ownership import acting_as

router = APIRouter(tags=["auth"])


class ExchangeRequest(BaseModel):
    token: str


class ExchangeResponse(BaseModel):
    access_token: str
    expires_in: int
    user_id: int
    token_id: int


def _invalid_token() -> Response:
    return error_response(401, "invalid_mcp_token", "A valid MCP token is required")


@router.post(MCP_EXCHANGE_PATH, response_model=None)
async def exchange_mcp_token(
    payload: ExchangeRequest, request: Request
) -> ExchangeResponse | Response:
    service_key = request.app.state.settings.mcp_service_key
    if not service_key:
        raise NotFoundError("Not found")
    presented = request.headers.get("authorization", "").encode("latin-1", "replace")
    if not hmac.compare_digest(presented, f"Bearer {service_key}".encode()):
        raise APIError(401, "unauthorized", "A valid MCP service key is required")
    user_id = owner_of(payload.token, "mcp")
    if user_id is None:
        return _invalid_token()
    clock = request.app.state.clock
    # Looked up acting as the User the token names: only their own tokens
    # are searched (app.api_tokens).
    with acting_as(user_id):
        async with request.app.state.session_factory() as db_session:
            api_token = await find_token(db_session, payload.token)
            user = await db_session.get(User, user_id) if api_token is not None else None
            if api_token is None or user is None:
                return _invalid_token()
            if not user.is_active:
                return error_response(401, "account_disabled", "This account is disabled")
            if api_token.revoked_at is not None:
                return _invalid_token()
            blocked = forced_step(user, token_login_method(user))
            if blocked is not None:
                return blocked
            token_id = api_token.id
            app_settings = await require_app_settings(db_session)
            access = issue_access(
                app_settings.session_key, user_id=user_id, token_id=token_id, now=clock()
            )
            if mark_used(api_token, clock()):
                await db_session.commit()
    return ExchangeResponse(
        access_token=access,
        expires_in=int(ACCESS_LIFETIME.total_seconds()),
        user_id=user_id,
        token_id=token_id,
    )
