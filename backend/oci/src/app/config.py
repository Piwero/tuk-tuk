"""Application settings loaded from environment variables."""

from typing import Literal

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
    # Required, PostgreSQL only (issue #407): postgresql+psycopg://… . Left
    # optional here so importing this module never fails; create_app
    # refuses to start without it (app.db.require_database_url), the same
    # posture as app_master_key below.
    database_url: str | None = None
    cors_origins: list[str] = ["http://localhost:5900"]

    # Authentication (ADR 0005/0008/0018). Passwords live on each User
    # (`users.password_hash`) and the session signing key in the DB-backed
    # `settings` table, not here — auth_password_hash below is consulted
    # only while no User can log in yet, to import an existing deployment's
    # `.env` value onto user #1 (ADR 0008's one-time upgrade path,
    # app.users.import_env_password); it is never read again once a User
    # holds a password, even if left in `.env`. A fresh deployment leaves
    # it unset and creates its first Admin through `/setup` instead.
    auth_password_hash: str | None = None
    # Which kind of deployment this is. Anything but an explicit
    # "development" counts as production, so a deployment that never sets
    # it is held to the production rules: today, only that AUTH_DISABLED is
    # refused (app.main). `.env.example` sets it for local development.
    app_env: Literal["production", "development"] = "production"
    # Local-dev escape hatch: when true SessionAuthMiddleware needs no
    # cookie and every request acts as the first Admin (ADR 0018). Off by
    # default, so a missing or ambiguous value keeps the fail-closed
    # posture (ADR 0005). The app refuses to start with it unless
    # APP_ENV=development, and logs a warning whenever it is on.
    auth_disabled: bool = False
    auth_cookie_secure: bool = True
    auth_login_delay_seconds: float = 1.0
    auth_session_lifetime_days: int = 30
    # Minimum age before a session is refreshed (app.session.needs_reissue),
    # not a distance from expiry: a session older than this is reissued on
    # its next request, however long before expiry that falls.
    auth_session_reissue_threshold_days: int = 1
    # The shared MCP server's service key (issue #525, ADR 0016's
    # amendment): the one credential that may trade a User's MCP token for
    # a short-lived access credential (app.mcp_exchange). The same value is
    # given to the MCP pod; it names no User. Unset, the exchange answers
    # 404 and MCP tokens authenticate nothing.
    mcp_service_key: str | None = None

    # Encrypts sensitive columns of the DB-backed `settings` table (ADR
    # 0008) — the Google client secret, and (app.routers.v1.google /
    # app.routers.v1.events) stored Google refresh tokens. The password hash
    # needs no such protection (Argon2id is one-way). Generated once at
    # deploy time the same way SECRET_KEY was before it, and required
    # unconditionally: the app refuses to start without it, the same
    # fail-closed posture SECRET_KEY had. Never read from or written to any
    # API response — a copy of the database must not disclose what it
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

    # Shared Google OAuth client (issue #586): operator-managed deployment
    # configuration, never stored in the database nor shown to anyone. Both
    # set turns on Google sign-in, invitations, and new Google Calendar
    # connections through this one client. Distinct from the one-time
    # import pair above, which only ever seeds user #1's own client.
    google_oauth_client_id: str | None = None
    google_oauth_client_secret: str | None = None

    # The frontend's public origin, used to build the links sent in
    # invitation emails (issue #586). Falls back to the first CORS origin.
    app_public_url: str | None = None

    # Outgoing email for invitations (issue #586). Unset SMTP_HOST means
    # invitations are never emailed: each records a delivery failure and an
    # Admin copies its link instead. "starttls" upgrades a plain connection
    # (usually port 587), "ssl" connects over TLS (usually 465); "none"
    # sends credentials in the clear and is refused outside development.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_security: Literal["starttls", "ssl", "none"] = "starttls"
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_timeout_seconds: float = 15.0

    # Assist (v2; ADR 0005/issue #41). Migration-only, like
    # auth_password_hash/google_client_id above: read once on an existing
    # deployment's first boot to import into the DB-backed `settings` row
    # (app.app_settings), then never consulted again. A fresh deployment
    # leaves both unset and configures Assist from Settings instead.
    assist_ollama_base_url: str | None = None
    assist_model: str | None = None


settings = Settings()
