"""Application settings loaded from environment variables."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "app"
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    backend_log_level: str = "info"


settings = Settings()
