"""The signed-in User of the request being served (ADR 0018).

SessionAuthMiddleware puts their id on `request.state.user_id` before any
route runs; `CurrentUserDep` loads that User, through the same
app.users.current_user_id seam as every per-user read, in the route's own
session.
"""

from typing import Annotated

from fastapi import Depends

from app.db import SessionDep
from app.errors import APIError
from app.models import User
from app.users import current_user_id


async def get_current_user(
    session: SessionDep, user_id: Annotated[int, Depends(current_user_id)]
) -> User:
    user = await session.get(User, user_id)
    assert user is not None  # the middleware loaded this User a moment ago
    return user


CurrentUserDep = Annotated[User, Depends(get_current_user)]


async def require_admin(user: CurrentUserDep) -> User:
    """The signed-in User, provided they are an Admin; 403 otherwise."""
    if not user.is_admin:
        raise APIError(403, "admin_required", "Only an admin can manage accounts")
    return user


AdminDep = Annotated[User, Depends(require_admin)]
