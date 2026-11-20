"""Row-level isolation (ADR 0018, issue #411): the one place that keeps each
User's rows apart.

A contextvar names the User the current code acts as. Every session the app
opens (`create_session_factory`) is an `IsolatedSession`, which:

- adds `owner_id = <that User>` to every owned table wherever it appears in
  a statement: plain selects, `Session.get`, counts and aggregates,
  subqueries, joins, relationship loads, and ORM-enabled UPDATE and DELETE;
- stamps new owned rows with that User when it flushes, and refuses a new
  row naming another owner, a change to a row's owner, and any change to
  or deletion of a row that is not that User's;
- raises `OwnerContextError` for any statement on an owned table, or any
  owned row flushed, while no User is in context (fails closed).

Tables nobody owns (`users`, `settings`, `user_settings`, `task_tags`) are
untouched, so the auth middleware can load the User before anyone is in
context. Raw SQL (`text()`, psycopg) bypasses all of this; the app has none
on owned tables.

Who sets the context: SessionAuthMiddleware for every authenticated request,
and `app.users.create_user` for the Inbox it gives a new User. Any other
code that reaches owned tables outside a request must wrap itself in
`acting_as(user_id)` too, or it raises.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, cast

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import ORMExecuteState, Session, UOWTransaction, with_loader_criteria
from sqlalchemy.orm.attributes import get_history
from sqlalchemy.sql import visitors
from sqlalchemy.sql.dml import UpdateBase
from sqlalchemy.sql.elements import ClauseElement
from sqlalchemy.sql.schema import Table

from app.db import Base
from app.models import OwnedMixin

_current_owner: ContextVar[int | None] = ContextVar("tuktuk_current_owner", default=None)


class OwnerContextError(RuntimeError):
    """Owned rows were touched with no User in context, or a write tried to
    hand a row to another User. Always a bug in the calling code, never a
    client error: it surfaces as a 500."""


@contextmanager
def acting_as(user_id: int) -> Iterator[None]:
    """Runs the enclosed code as `user_id`: every session sees, creates and
    changes only that User's rows. Nests, restoring the outer User on exit
    (an Admin creating an account gives the new User their own Inbox)."""
    token = _current_owner.set(user_id)
    try:
        yield
    finally:
        _current_owner.reset(token)


_OWNED_TABLE_NAMES = frozenset(
    mapper.local_table.name  # type: ignore[attr-defined]
    for mapper in Base.registry.mappers
    if issubclass(mapper.class_, OwnedMixin)
)


def _touches_owned_table(state: ORMExecuteState) -> bool:
    if any(issubclass(mapper.class_, OwnedMixin) for mapper in state.all_mappers):
        return True
    # all_mappers names the top level only: a subquery, a join or a
    # column-only select of an owned table is found by walking the statement.
    statement = state.statement
    return isinstance(statement, ClauseElement) and any(
        isinstance(element, Table) and element.name in _OWNED_TABLE_NAMES
        for element in visitors.iterate(statement)
    )


def _writes_owner(state: ORMExecuteState) -> bool:
    """Whether an INSERT or UPDATE statement sets `owner_id`, through
    `.values()` or through the parameters it is executed with."""
    statement = state.statement
    if not isinstance(statement, UpdateBase):
        return False
    # No public accessor exposes a DML statement's `.values()`.
    values: dict[Any, Any] = getattr(statement, "_values", None) or {}
    keys = {getattr(key, "key", key) for key in values}
    parameters = state.parameters
    rows = parameters if isinstance(parameters, list) else [parameters or {}]
    for row in rows:
        keys.update(row)
    return "owner_id" in keys


def _filter_owned_rows(state: ORMExecuteState) -> None:
    if not _touches_owned_table(state):
        return
    owner_id = _current_owner.get()
    if owner_id is None:
        raise OwnerContextError(
            "Owned rows were queried with no User in context. Run this inside "
            "app.ownership.acting_as(user_id)."
        )
    if _writes_owner(state):
        raise OwnerContextError("A statement may not write owner_id.")
    if state.is_insert or state.is_column_load or state.is_relationship_load:
        # Column and relationship loads are for objects this session already
        # loaded through the filter, and relationship loads carry the parent
        # query's criteria with them. An INSERT selects nothing.
        return
    state.statement = state.statement.options(
        with_loader_criteria(
            OwnedMixin,
            lambda cls: cls.owner_id == owner_id,
            include_aliases=True,
        )
    )


def _guard_flush(session: Session, _flush_context: UOWTransaction, _instances: object) -> None:
    """Stamps new owned rows with the User in context, and refuses to write
    a row that belongs to anyone else or to change a row's owner. Runs when
    the session flushes, so code adding rows inside `acting_as` flushes
    before leaving it."""
    owner_id = _current_owner.get()
    for row in session.new:
        if not isinstance(row, OwnedMixin):
            continue
        if owner_id is None:
            raise OwnerContextError(
                f"A new {type(row).__name__} was added with no User in context. Run this "
                "inside app.ownership.acting_as(user_id)."
            )
        named_owner = cast(int | None, row.owner_id)  # unset until flushed
        if named_owner is None:
            row.owner_id = owner_id
        elif named_owner != owner_id:
            raise OwnerContextError(f"A new {type(row).__name__} names another User as its owner.")
    changed = [row for row in session.dirty if session.is_modified(row)]
    for row in [*changed, *session.deleted]:
        if not isinstance(row, OwnedMixin):
            continue
        if get_history(row, "owner_id").has_changes():
            raise OwnerContextError(f"A {type(row).__name__}'s owner cannot change.")
        if row.owner_id != owner_id:
            raise OwnerContextError(
                f"A {type(row).__name__} of User {row.owner_id} was written while acting as "
                f"{owner_id}."
            )


class IsolatedSession(Session):
    """The sync Session behind every AsyncSession the app opens."""


event.listen(IsolatedSession, "do_orm_execute", _filter_owned_rows)
event.listen(IsolatedSession, "before_flush", _guard_flush)


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """The app's one session factory: every session it opens is isolated."""
    return async_sessionmaker(engine, expire_on_commit=False, sync_session_class=IsolatedSession)
