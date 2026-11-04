"""Single place for models and timings (issue #367/#368, ADR 0015). Swap a model here only."""

# Must equal AGENT_NAME in backend/oci/src/app/voice_token.py: the backend dispatches this agent
# by name via the token's roomConfig. Plain string on both sides; docs note covers drift.
AGENT_NAME = "tuktuk-voice"

STT_MODEL = "assemblyai/universal-streaming-multilingual"
STT_LANGUAGE = "multi"  # EN/ES code-switching
LLM_MODEL = "google/gemini-3.1-flash-lite"
TTS_MODEL = "inworld/inworld-tts-2-flash"
TTS_VOICE = "Ashley"  # language auto-detected from the text, so Spanish replies still work

RPC_TIMEOUT_SECONDS = 5.0
SILENCE_TIMEOUT_SECONDS = 20.0  # enforced in T8
ATTRIBUTES_WAIT_SECONDS = 3.0  # how long to wait for the tab's tz/date attributes after join

# Participant attribute names shared with the browser (frontend/oci/src/voice/session.ts).
ATTR_CONTRACT_VERSION = "contract_version"
ATTR_TZ = "tz"
ATTR_DATE = "date"
