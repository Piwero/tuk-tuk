"""Authentication settings and the fail-closed startup guarantee (ADR 0008)."""

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


def test_app_refuses_to_start_without_an_app_master_key() -> None:
    settings = Settings(app_master_key=None)

    with pytest.raises(RuntimeError, match="APP_MASTER_KEY"):
        create_app(settings)


def test_app_starts_with_an_app_master_key_configured() -> None:
    settings = Settings(app_master_key="a-master-key")

    create_app(settings)


def test_app_starts_with_no_password_hash_configured() -> None:
    """A fresh deployment has no AUTH_PASSWORD_HASH at all — the app starts
    fine and gates behind /setup instead of refusing to boot (ADR 0008)."""
    settings = Settings(app_master_key="a-master-key", auth_password_hash=None)

    create_app(settings)


def test_settings_default_auth_disabled_to_false(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AUTH_DISABLED", raising=False)

    settings = Settings(auth_password_hash=None)

    assert settings.auth_disabled is False


def test_settings_read_auth_disabled_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_DISABLED", "true")

    settings = Settings()

    assert settings.auth_disabled is True


def test_app_logs_a_warning_when_auth_is_disabled(
    caplog: pytest.LogCaptureFixture,
) -> None:
    settings = Settings(app_master_key="a-master-key", auth_disabled=True)

    with caplog.at_level("WARNING", logger="app.main"):
        create_app(settings)

    assert "AUTH_DISABLED" in caplog.text


def test_app_stays_silent_when_auth_is_enabled(caplog: pytest.LogCaptureFixture) -> None:
    settings = Settings(app_master_key="a-master-key", auth_disabled=False)

    with caplog.at_level("WARNING", logger="app.main"):
        create_app(settings)

    assert "AUTH_DISABLED" not in caplog.text


def test_app_starts_with_google_configured() -> None:
    settings = Settings(
        app_master_key="a-master-key",
        google_client_id="a-client-id",
        google_client_secret="a-client-secret",
    )

    create_app(settings)
