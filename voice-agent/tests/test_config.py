"""Voice model defaults and environment overrides."""

from pydantic_settings import SettingsConfigDict

from tuk_voice_agent.config import Settings


def test_model_settings_defaults_and_env_override(monkeypatch) -> None:
    class EnvSettings(Settings):
        model_config = SettingsConfigDict(env_prefix="TEST_", extra="ignore")

    monkeypatch.setenv("TEST_TTS_MODEL", "cartesia/sonic-3")
    settings = EnvSettings()
    assert settings.tts_model == "cartesia/sonic-3"
    assert settings.stt_model == "assemblyai/universal-streaming-multilingual"
    assert Settings().tts_model == "xai/tts-1"
