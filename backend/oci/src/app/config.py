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
    auth_cookie_secure: bool = True
    auth_login_delay_seconds: float = 1.0
    auth_session_lifetime_days: int = 30
    auth_session_reissue_threshold_days: int = 1


settings = Settings()
