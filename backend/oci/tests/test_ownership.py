"""The central owner filter (ADR 0018, issue #411), at the session seam:
every session the app opens filters owned tables to the User in context,
stamps new rows with them, and refuses an owned-table statement when no
User is in context (fail closed).

The HTTP-level proof that one User cannot reach another's rows is
tests/test_isolation.py."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Folder, TaskList, User
from app.ownership import OwnerContextError, acting_as
from tests.conftest import create_user_row


def in_session[T](app: FastAPI, work: Callable[[AsyncSession], Awaitable[T]]) -> T:
    """Runs `work` on one of the app's own sessions, outside any request."""

    async def _run() -> T:
        async with app.state.session_factory() as session:
            return await work(session)

    return asyncio.run(_run())


@pytest.fixture
def app(unauthenticated_client: TestClient) -> FastAPI:
    app = unauthenticated_client.app
    assert isinstance(app, FastAPI)
    return app


OWNED_STATEMENTS: dict[str, Callable[[AsyncSession], Awaitable[Any]]] = {
    "select": lambda s: s.scalars(select(TaskList)),
    "get": lambda s: s.get(TaskList, 1),
    "count": lambda s: s.scalar(select(func.count()).select_from(TaskList)),
    "column": lambda s: s.scalar(select(func.max(TaskList.sort_order))),
    "subquery": lambda s: s.scalar(
        select(func.count()).select_from(select(TaskList.id).subquery())
    ),
    "update": lambda s: s.execute(update(TaskList).values(name="x")),
    "delete": lambda s: s.execute(delete(Folder)),
}


class TestFailsClosed:
    @pytest.mark.parametrize("statement", OWNED_STATEMENTS.values(), ids=OWNED_STATEMENTS.keys())
    def test_an_owned_table_statement_with_no_user_in_context_raises(
        self, app: FastAPI, statement: Callable[[AsyncSession], Awaitable[Any]]
    ) -> None:
        with pytest.raises(OwnerContextError):
            in_session(app, statement)

    def test_tables_nobody_owns_need_no_user_in_context(self, app: FastAPI) -> None:
        # The auth middleware reads Users before it knows who is asking.
        users = in_session(app, lambda s: s.scalars(select(User.username)))
        assert list(users) == ["admin"]

    def test_adding_an_owned_row_with_no_user_in_context_raises(self, app: FastAPI) -> None:
        async def add_folder(session: AsyncSession) -> None:
            session.add(Folder(name="Work"))
            await session.flush()

        with pytest.raises(OwnerContextError):
            in_session(app, add_folder)


class TestActingAs:
    @pytest.fixture
    def bea(self, app: FastAPI) -> User:
        return create_user_row(app, "bea", "bea@example.com")

    def test_reads_see_only_the_users_own_rows(self, app: FastAPI, bea: User) -> None:
        with acting_as(bea.id):
            lists = in_session(app, lambda s: s.scalars(select(TaskList.owner_id)))
            assert list(lists) == [bea.id]
            assert in_session(app, lambda s: s.get(TaskList, 1)) is None
            count = in_session(app, lambda s: s.scalar(select(func.count()).select_from(TaskList)))
            assert count == 1

    def test_bulk_update_and_delete_touch_only_the_users_own_rows(
        self, app: FastAPI, bea: User
    ) -> None:
        async def rename_all_lists(session: AsyncSession) -> None:
            await session.execute(update(TaskList).values(name="Renamed"))
            await session.commit()

        with acting_as(bea.id):
            in_session(app, rename_all_lists)
        with acting_as(1):
            names = in_session(app, lambda s: s.scalars(select(TaskList.name)))
            assert list(names) == ["Inbox"]

        async def add_folder(session: AsyncSession) -> None:
            session.add(Folder(name="Mine"))
            await session.commit()

        async def delete_all_folders(session: AsyncSession) -> None:
            await session.execute(delete(Folder))
            await session.commit()

        with acting_as(1):
            in_session(app, add_folder)
        with acting_as(bea.id):
            in_session(app, delete_all_folders)
        with acting_as(1):
            folders = in_session(app, lambda s: s.scalars(select(Folder.name)))
            assert list(folders) == ["Mine"]

    def test_new_rows_belong_to_the_user_in_context(self, app: FastAPI, bea: User) -> None:
        async def add_folder(session: AsyncSession) -> int:
            folder = Folder(name="Work")
            session.add(folder)
            await session.commit()
            return folder.owner_id

        with acting_as(bea.id):
            assert in_session(app, add_folder) == bea.id

    def test_a_new_row_naming_another_owner_is_refused(self, app: FastAPI, bea: User) -> None:
        async def add_folder_for_admin(session: AsyncSession) -> None:
            session.add(Folder(name="Planted", owner_id=1))
            await session.flush()

        with acting_as(bea.id), pytest.raises(OwnerContextError):
            in_session(app, add_folder_for_admin)

    def test_an_existing_rows_owner_cannot_change(self, app: FastAPI, bea: User) -> None:
        async def give_inbox_away(session: AsyncSession) -> None:
            inbox = await session.scalar(select(TaskList))
            assert inbox is not None
            inbox.owner_id = 1
            await session.flush()

        with acting_as(bea.id), pytest.raises(OwnerContextError):
            in_session(app, give_inbox_away)

    def test_a_bulk_update_cannot_change_the_owner(self, app: FastAPI, bea: User) -> None:
        with acting_as(bea.id), pytest.raises(OwnerContextError):
            in_session(app, lambda s: s.execute(update(TaskList).values(owner_id=1)))

    @pytest.mark.parametrize("change", ["rename", "delete"])
    def test_a_row_loaded_as_one_user_cannot_be_written_as_another(
        self, app: FastAPI, bea: User, change: str
    ) -> None:
        async def load_then_write_as_admin(session: AsyncSession) -> None:
            with acting_as(bea.id):
                inbox = await session.scalar(select(TaskList))
            assert inbox is not None
            with acting_as(1):
                if change == "rename":
                    inbox.color = "red"
                else:
                    await session.delete(inbox)
                await session.flush()

        with pytest.raises(OwnerContextError):
            in_session(app, load_then_write_as_admin)

    def test_a_created_users_inbox_is_theirs_even_inside_another_users_context(
        self, app: FastAPI
    ) -> None:
        # An Admin creating an account (issue #412) runs as themselves.
        with acting_as(1):
            cleo = create_user_row(app, "cleo", "cleo@example.com")
        with acting_as(cleo.id):
            owners = in_session(app, lambda s: s.scalars(select(TaskList.owner_id)))
            assert list(owners) == [cleo.id]
