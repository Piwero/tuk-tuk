"""FastAPI entrypoint."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import __version__
from app.calendar_source import CalendarSource
from app.config import Settings
from app.config import settings as default_settings
from app.db import run_migrations
from app.errors import register_error_handlers
from app.google_adapter import GoogleCalendarSource
from app.login_throttle import LoginThrottle
from app.middleware import SessionAuthMiddleware
from app.models import TaskList
from app.routers.v1 import (
    auth,
    check_items,
    completed_occurrences,
    focus_sessions,
    folders,
    google,
    habits,
    lists,
    sections,
    tags,
    tasks,
    timers,
)
from app.session import Clock, real_clock

INBOX_NAME = "Inbox"


def create_app(
    settings: Settings | None = None,
    clock: Clock | None = None,
    calendar_source: CalendarSource | None = None,
) -> FastAPI:
    app_settings = settings or default_settings
    app_clock = clock or real_clock
    app_calendar_source = calendar_source or GoogleCalendarSource(
        client_id=app_settings.google_client_id or "",
        client_secret=app_settings.google_client_secret or "",
    )

    if not app_settings.auth_password_hash:
        raise RuntimeError(
            "AUTH_PASSWORD_HASH is not configured. The app refuses to start without a "
            "password hash: run 'mise run backend:hash-password' and set the printed "
            "hash as AUTH_PASSWORD_HASH in your .env or 1Password item."
        )
    if app_settings.secret_key == "change-me":
        raise RuntimeError(
            "SECRET_KEY is not configured. The app refuses to start while it's left at "
            "the placeholder value: generate one with 'openssl rand -base64 32' and set "
            "it as SECRET_KEY in your .env or 1Password item."
        )
    google_configured = bool(app_settings.google_client_id) and bool(
        app_settings.google_client_secret
    )
    if google_configured and not app_settings.google_encryption_key:
        raise RuntimeError(
            "GOOGLE_ENCRYPTION_KEY is not configured. GOOGLE_CLIENT_ID/SECRET are set, so "
            "the app refuses to start without a dedicated key to encrypt stored Google "
            "credentials: generate one with 'openssl rand -base64 32' and set it as "
            "GOOGLE_ENCRYPTION_KEY in your .env or 1Password item."
        )

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
    app.state.settings = app_settings
    app.state.clock = app_clock
    app.state.calendar_source = app_calendar_source
    app.state.login_throttle = LoginThrottle()
    app.add_middleware(SessionAuthMiddleware, settings=app_settings, clock=app_clock)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)
    app.include_router(auth.router)
    app.include_router(check_items.router)
    app.include_router(completed_occurrences.router)
    app.include_router(folders.router)
    app.include_router(focus_sessions.router)
    app.include_router(focus_sessions.stats_router)
    app.include_router(google.router)
    app.include_router(habits.router)
    app.include_router(habits.check_ins_router)
    app.include_router(lists.router)
    app.include_router(sections.router)
    app.include_router(tags.router)
    app.include_router(tasks.router)
    app.include_router(timers.router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app


app = create_app()
