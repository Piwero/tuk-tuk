"""Authentication settings and the fail-closed startup guarantee."""

import pytest

from app.config import Settings
from app.main import create_app


def test_settings_default_to_no_password_hash() -> None:
    settings = Settings(auth_password_hash=None)

    assert settings.auth_password_hash is None


def test_settings_read_auth_env_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_PASSWORD_HASH", "$argon2id$v=19$m=8,t=1,p=1$c29tZXNhbHQ$aGFzaA")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "false")
    monkeypatch.setenv("AUTH_LOGIN_DELAY_SECONDS", "2.5")
    monkeypatch.setenv("AUTH_SESSION_LIFETIME_DAYS", "14")
    monkeypatch.setenv("AUTH_SESSION_REISSUE_THRESHOLD_DAYS", "2")

    settings = Settings()

    assert settings.auth_password_hash == "$argon2id$v=19$m=8,t=1,p=1$c29tZXNhbHQ$aGFzaA"
    assert settings.auth_cookie_secure is False
    assert settings.auth_login_delay_seconds == 2.5
    assert settings.auth_session_lifetime_days == 14
    assert settings.auth_session_reissue_threshold_days == 2


def test_settings_default_cookie_secure_to_true(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AUTH_COOKIE_SECURE", raising=False)

    settings = Settings(auth_password_hash=None)

    assert settings.auth_cookie_secure is True


def test_app_refuses_to_start_without_a_password_hash() -> None:
    settings = Settings(auth_password_hash=None)

    with pytest.raises(RuntimeError, match="AUTH_PASSWORD_HASH"):
        create_app(settings)


def test_app_starts_with_a_password_hash_configured() -> None:
    settings = Settings(auth_password_hash="$argon2id$v=19$m=8,t=1,p=1$c29tZXNhbHQ$aGFzaA")

    create_app(settings)


def test_app_refuses_to_start_with_the_placeholder_secret_key() -> None:
    settings = Settings(
        auth_password_hash="$argon2id$v=19$m=8,t=1,p=1$c29tZXNhbHQ$aGFzaA",
        secret_key="change-me",
    )

    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        create_app(settings)
