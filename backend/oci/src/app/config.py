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

    # Authentication (ADR 0005). No setting disables the gate; a missing hash
    # makes the app refuse to start rather than serve unauthenticated.
    auth_password_hash: str | None = None
    # Signs the session cookie (app.session). Provisioned once in 1Password
    # and synced into the cluster as SECRET_KEY (see backend/chart) — never
    # generated at container start, since a per-boot key would log every
    # device out on every deploy.
    secret_key: str = "change-me"
    auth_cookie_secure: bool = True
    auth_login_delay_seconds: float = 1.0
    auth_session_lifetime_days: int = 30
    # Minimum age before a session is refreshed (app.session.needs_reissue),
    # not a distance from expiry: a session older than this is reissued on
    # its next request, however long before expiry that falls.
    auth_session_reissue_threshold_days: int = 1

    # Google Calendar integration (issue #103; ADR 0006). Both absent by
    # default, which is what disables the whole feature: no setting turns it
    # off explicitly, the same "missing means off" convention used elsewhere
    # in this file. Unlike auth_password_hash, a missing value here is not
    # fatal — the app starts and runs normally with no Google integration at
    # all, it just never shows Google Calendar anywhere.
    google_client_id: str | None = None
    google_client_secret: str | None = None
    # Encrypts stored Google refresh credentials at rest (issue #105).
    # Deliberately its own setting rather than derived from secret_key:
    # secret_key's documented rotation procedure is the "log every device
    # out" lever, and coupling the two would make a routine logout-everywhere
    # silently destroy every calendar connection. Required (app.main refuses
    # to start without it) only when the Google integration is itself
    # configured — an unconfigured deployment needs no encryption key at all.
    google_encryption_key: str | None = None


def google_configured(settings: Settings) -> bool:
    """Whether the Google Calendar integration is set up at all — both
    settings present. Shared by every route that needs to answer or gate on
    this (google.py's settings routes, events.py's read-only feed)."""
    return bool(settings.google_client_id) and bool(settings.google_client_secret)


settings = Settings()
