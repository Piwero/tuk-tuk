"""The signed-in User of the request being served (ADR 0018).

SessionAuthMiddleware puts their id on `request.state.user_id` before any
route runs; `CurrentUserDep` loads that User in the route's own session.
"""

from typing import Annotated

from fastapi import Depends, Request

from app.db import SessionDep
from app.models import User


async def get_current_user(request: Request, session: SessionDep) -> User:
    user = await session.get(User, request.state.user_id)
    assert user is not None  # the middleware loaded this User a moment ago
    return user


CurrentUserDep = Annotated[User, Depends(get_current_user)]
