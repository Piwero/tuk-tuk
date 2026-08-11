"""FastAPI entrypoint."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import __version__
from app.app_settings import bootstrap_app_settings, google_configured
from app.calendar_source import CalendarSource
from app.config import Settings
from app.config import settings as default_settings
from app.crypto import decrypt_credential
from app.db import run_migrations
from app.errors import register_error_handlers
from app.event_cache import EventCache
from app.google_adapter import GoogleCalendarSource
from app.login_throttle import LoginThrottle
from app.middleware import SessionAuthMiddleware
from app.models import TaskList
from app.routers.v1 import (
    auth,
    check_items,
    completed_occurrences,
    events,
    focus_sessions,
    folders,
    google,
    habits,
    lists,
    sections,
    stand_up,
    tags,
    tasks,
    timers,
)
from app.routers.v1 import settings as settings_router
from app.session import Clock, real_clock

INBOX_NAME = "Inbox"


def create_app(
    settings: Settings | None = None,
    clock: Clock | None = None,
    calendar_source: CalendarSource | None = None,
) -> FastAPI:
    app_settings = settings or default_settings
    app_clock = clock or real_clock
    # Credentials are wired up below, once the DB-backed `settings` row is
    # bootstrapped — that row, not these env vars, is the source of truth
    # for Google credentials after first boot (issue #117).
    app_calendar_source = calendar_source or GoogleCalendarSource(client_id="", client_secret="")

    if not app_settings.app_master_key:
        raise RuntimeError(
            "APP_MASTER_KEY is not configured. The app refuses to start without it: "
            "generate one with 'openssl rand -base64 32' and set it as APP_MASTER_KEY "
            "in your .env or 1Password item."
        )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await asyncio.to_thread(run_migrations, app_settings.database_url)
        engine = create_async_engine(app_settings.database_url)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        app.state.session_factory = session_factory
        async with session_factory() as session:
            settings_row = await bootstrap_app_settings(session, app_settings)
            if (
                google_configured(settings_row)
                and settings_row.google_client_id is not None
                and settings_row.encrypted_google_client_secret is not None
            ):
                assert app_settings.app_master_key is not None  # checked above
                client_secret = decrypt_credential(
                    settings_row.encrypted_google_client_secret, key=app_settings.app_master_key
                )
                app_calendar_source.configure(settings_row.google_client_id, client_secret)
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
    app.state.event_cache = EventCache(clock=app_clock)
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
    app.include_router(events.router)
    app.include_router(folders.router)
    app.include_router(focus_sessions.router)
    app.include_router(focus_sessions.stats_router)
    app.include_router(google.router)
    app.include_router(habits.router)
    app.include_router(habits.check_ins_router)
    app.include_router(lists.router)
    app.include_router(sections.router)
    app.include_router(settings_router.router)
    app.include_router(stand_up.router)
    app.include_router(tags.router)
    app.include_router(tasks.router)
    app.include_router(timers.router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app


app = create_app()
