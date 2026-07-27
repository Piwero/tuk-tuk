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


settings = Settings()
