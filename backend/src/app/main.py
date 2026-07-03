"""FastAPI entrypoint."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import __version__
from app.config import Settings
from app.config import settings as default_settings
from app.db import run_migrations
from app.errors import register_error_handlers
from app.models import TaskList
from app.routers import check_items, folders, lists, tags, tasks

INBOX_NAME = "Inbox"


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or default_settings

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await asyncio.to_thread(run_migrations, app_settings.database_url)
        engine = create_async_engine(app_settings.database_url)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        app.state.session_factory = session_factory
        async with session_factory() as session:
            inbox = await session.scalar(select(TaskList).where(TaskList.is_inbox))
            if inbox is None:
                session.add(TaskList(name=INBOX_NAME, is_inbox=True))
                await session.commit()
        yield
        await engine.dispose()

    app = FastAPI(title=app_settings.app_name, version=__version__, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)
    app.include_router(check_items.router)
    app.include_router(folders.router)
    app.include_router(lists.router)
    app.include_router(tags.router)
    app.include_router(tasks.router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app


app = create_app()
