"""Model defaults and timings (issue #367/#368, ADR 0015). Models can be overridden by environment."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    stt_model: str = "assemblyai/universal-streaming-multilingual"
    stt_language: str = "multi"
    llm_model: str = "google/gemini-3.1-flash-lite"
    # Inworld has no EU endpoint; use model with EU support by default.
    tts_model: str = "xai/tts-1"
    tts_voice: str = "ara"
    tts_language: str = "auto"


settings = Settings()

# Must equal AGENT_NAME in backend/oci/src/app/voice_livekit.py: the backend dispatches this agent
# by name via the token's roomConfig. Plain string on both sides; docs note covers drift.
AGENT_NAME = "tuktuk-voice"

STT_MODEL = settings.stt_model
STT_LANGUAGE = settings.stt_language  # EN/ES code-switching
LLM_MODEL = settings.llm_model
TTS_MODEL = settings.tts_model
TTS_VOICE = settings.tts_voice
TTS_LANGUAGE = settings.tts_language  # detected from the text, so Spanish replies still work

RPC_TIMEOUT_SECONDS = 5.0
ATTRIBUTES_WAIT_SECONDS = 3.0  # how long to wait for the tab's tz/date attributes after join

# Participant attribute names shared with the browser (frontend/oci/src/voice/session.ts).
ATTR_CONTRACT_VERSION = "contract_version"
ATTR_TZ = "tz"
ATTR_DATE = "date"
