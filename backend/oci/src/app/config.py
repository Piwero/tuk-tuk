"""Application settings loaded from environment variables."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "tuk-tuk"
    backend_host: str = "0.0.0.0"
    backend_port: int = 8900
    backend_log_level: str = "info"
    database_url: str = "sqlite+aiosqlite:///./tuk_tuk.db"
    cors_origins: list[str] = ["http://localhost:5900"]

    # Authentication (ADR 0005/0008). The password hash and the session
    # signing key now live in the DB-backed `settings` table (see
    # app.app_settings), not here — auth_password_hash below is consulted
    # only once, on the very first boot, to import an existing deployment's
    # `.env` value (ADR 0008's one-time upgrade path); it is never read
    # again once that row exists, even if left in `.env`. A fresh
    # deployment leaves it unset and sets a password through `/setup`
    # instead.
    auth_password_hash: str | None = None
    auth_cookie_secure: bool = True
    auth_login_delay_seconds: float = 1.0
    auth_session_lifetime_days: int = 30
    # Minimum age before a session is refreshed (app.session.needs_reissue),
    # not a distance from expiry: a session older than this is reissued on
    # its next request, however long before expiry that falls.
    auth_session_reissue_threshold_days: int = 1

    # Encrypts sensitive columns of the DB-backed `settings` table (ADR
    # 0008) — the Google client secret, and (app.routers.v1.google /
    # app.routers.v1.events) stored Google refresh tokens. The password hash
    # needs no such protection (Argon2id is one-way). Generated once at
    # deploy time the same way SECRET_KEY was before it, and required
    # unconditionally: the app refuses to start without it, the same
    # fail-closed posture SECRET_KEY had. Never read from or written to any
    # API response — a copy of the SQLite file must not disclose what it
    # protects.
    app_master_key: str | None = None

    # Google Calendar integration (issue #103; ADR 0006). Both absent by
    # default, which is what disables the whole feature: no setting turns it
    # off explicitly, the same "missing means off" convention used elsewhere
    # in this file. A missing value here is not fatal — the app starts and
    # runs normally with no Google integration at all, it just never shows
    # Google Calendar anywhere. Consulted for the initial GoogleCalendarSource
    # wiring and, like auth_password_hash above, the one-time settings
    # import on first boot (ADR 0008) — a fresh deployment instead sets
    # these through Settings' Google credentials step (issue #117).
    google_client_id: str | None = None
    google_client_secret: str | None = None


def google_configured(settings: Settings) -> bool:
    """Whether the Google Calendar integration is set up at all — both
    settings present. Shared by every route that needs to answer or gate on
    this (google.py's settings routes, events.py's read-only feed)."""
    return bool(settings.google_client_id) and bool(settings.google_client_secret)


settings = Settings()
