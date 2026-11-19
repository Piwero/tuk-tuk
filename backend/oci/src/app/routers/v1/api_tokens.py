"""The signed-in User's API tokens (ADR 0014's amendment, issue #413):
create one (its value shown in this response only), list them, revoke one.

Rows are owned, so the central owner filter (app.ownership) keeps every
query here to the signed-in User's own tokens.
"""

from datetime import datetime

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from app.api_tokens import mint
from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.models import ApiToken
from app.schemas import Page
from app.users import current_user_id

router = APIRouter(prefix="/api/v1/auth/me/tokens", tags=["auth"])

MAX_NAME_LENGTH = 100


class ApiTokenCreate(BaseModel):
    name: str


class ApiTokenRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    prefix: str
    created_at: datetime
    last_used_at: datetime | None


class ApiTokenCreated(ApiTokenRead):
    """The one response that carries the token's value."""

    token: str


def _clean_name(name: str) -> str:
    name = name.strip()
    if not name or len(name) > MAX_NAME_LENGTH:
        raise APIError(
            422, "invalid_token_name", f"Token name must be 1 to {MAX_NAME_LENGTH} characters"
        )
    return name


@router.post("", status_code=201)
async def create_token(
    payload: ApiTokenCreate, request: Request, session: SessionDep
) -> ApiTokenCreated:
    """Mints a token for the signed-in User. The response is the only place
    its value ever appears: only a hash is stored."""
    api_token, plaintext = mint(current_user_id(request), _clean_name(payload.name))
    api_token.created_at = request.app.state.clock()
    session.add(api_token)
    await session.commit()
    return ApiTokenCreated(**ApiTokenRead.model_validate(api_token).model_dump(), token=plaintext)


@router.get("")
async def read_tokens(
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[ApiTokenRead]:
    """The signed-in User's live tokens, newest first. Never their values."""
    live = select(ApiToken).where(ApiToken.revoked_at.is_(None))
    total = await session.scalar(select(func.count()).select_from(live.subquery())) or 0
    rows = await session.scalars(
        live.order_by(ApiToken.created_at.desc(), ApiToken.id.desc()).limit(limit).offset(offset)
    )
    items = [ApiTokenRead.model_validate(row) for row in rows]
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.delete("/{token_id}", status_code=204)
async def revoke_token(token_id: int, request: Request, session: SessionDep) -> None:
    """Revokes one token: it stops authenticating at once. Nothing else of
    the User's (sessions, other tokens) is touched."""
    api_token = await session.get(ApiToken, token_id)
    if api_token is None or api_token.revoked_at is not None:
        raise NotFoundError(f"API token {token_id} not found")
    api_token.revoked_at = request.app.state.clock()
    await session.commit()
