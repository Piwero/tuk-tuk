"""FastAPI entrypoint."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.app_settings import bootstrap_app_settings
from app.calendar_source import CalendarSource
from app.config import Settings
from app.config import settings as default_settings
from app.db import check_database_reachable, create_engine, require_database_url, run_migrations
from app.errors import register_error_handlers
from app.event_cache import EventCache
from app.github_adapter import GitHubApiSource
from app.github_source import GitHubSource
from app.google_adapter import GoogleCalendarSource
from app.middleware import SessionAuthMiddleware
from app.ownership import create_session_factory
from app.routers.v1 import (
    admin_users,
    api_tokens,
    assist,
    assistant,
    auth,
    check_item_suggestions,
    check_items,
    completed_occurrences,
    events,
    focus_sessions,
    folders,
    github,
    goals,
    google,
    habits,
    key_results,
    lists,
    mcp_exchange,
    missed_reminders,
    now,
    reminder_deliveries,
    sections,
    stand_up,
    tags,
    tasks,
    timers,
    voice,
)
from app.routers.v1 import settings as settings_router
from app.session import Clock, real_clock
from app.user_settings import user_settings_from_env
from app.users import import_env_password


def create_app(
    settings: Settings | None = None,
    clock: Clock | None = None,
    calendar_source: CalendarSource | None = None,
    github_source: GitHubSource | None = None,
) -> FastAPI:
    app_settings = settings or default_settings
    app_clock = clock or real_clock
    # Holds no credentials: each call names the acting user's own OAuth
    # client (issue #409).
    app_calendar_source = calendar_source or GoogleCalendarSource()
    # Holds no credentials either: each call names a User's GitHub Token.
    app_github_source = github_source or GitHubApiSource()

    if not app_settings.app_master_key:
        raise RuntimeError(
            "APP_MASTER_KEY is not configured. The app refuses to start without it: "
            "generate one with 'openssl rand -base64 32' and set it as APP_MASTER_KEY "
            "in your .env or 1Password item."
        )

    database_url = require_database_url(app_settings.database_url)

    if app_settings.auth_disabled:
        if app_settings.app_env != "development":
            raise RuntimeError(
                "AUTH_DISABLED is set but APP_ENV is not 'development'. The app refuses to "
                "start: AUTH_DISABLED serves every route as the first admin with no login. "
                "Set APP_ENV=development for local development, or unset AUTH_DISABLED."
            )
        logging.getLogger(__name__).warning(
            "AUTH_DISABLED is on: every route serves unauthenticated, as the first admin. "
            "Local development only — never enable in a real deployment."
        )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_engine(database_url)
        await check_database_reachable(engine, database_url)
        await asyncio.to_thread(run_migrations, database_url)
        session_factory = create_session_factory(engine)
        app.state.session_factory = session_factory
        async with session_factory() as session:
            await bootstrap_app_settings(session, app_settings)
            await import_env_password(
                session, app_settings.auth_password_hash, user_settings_from_env(app_settings)
            )
        yield
        await engine.dispose()

    app = FastAPI(title=app_settings.app_name, version=__version__, lifespan=lifespan)
    app.state.settings = app_settings
    app.state.clock = app_clock
    app.state.calendar_source = app_calendar_source
    app.state.github_source = app_github_source
    app.state.event_cache = EventCache(clock=app_clock)
    app.add_middleware(SessionAuthMiddleware, settings=app_settings, clock=app_clock)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)
    app.include_router(admin_users.router)
    app.include_router(api_tokens.router)
    app.include_router(assist.router)
    app.include_router(assistant.router)
    app.include_router(auth.router)
    app.include_router(check_items.router)
    app.include_router(check_item_suggestions.router)
    app.include_router(completed_occurrences.router)
    app.include_router(events.router)
    app.include_router(folders.router)
    app.include_router(now.router)
    app.include_router(focus_sessions.router)
    app.include_router(focus_sessions.stats_router)
    app.include_router(github.router)
    app.include_router(goals.router)
    app.include_router(google.router)
    app.include_router(habits.router)
    app.include_router(habits.check_ins_router)
    app.include_router(key_results.router)
    app.include_router(lists.router)
    app.include_router(mcp_exchange.router)
    app.include_router(missed_reminders.router)
    app.include_router(reminder_deliveries.router)
    app.include_router(sections.router)
    app.include_router(settings_router.router)
    app.include_router(stand_up.router)
    app.include_router(tags.router)
    app.include_router(tasks.router)
    app.include_router(timers.router)
    app.include_router(voice.router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app


app = create_app()
