"""Model defaults and timings (issue #367/#368, ADR 0015). Models can be overridden by environment."""

import os

# Must equal AGENT_NAME in backend/oci/src/app/voice_livekit.py: the backend dispatches this agent
# by name via the token's roomConfig. Plain string on both sides; docs note covers drift.
AGENT_NAME = "tuktuk-voice"

STT_MODEL = os.getenv("STT_MODEL", "assemblyai/universal-streaming-multilingual")
STT_LANGUAGE = os.getenv("STT_LANGUAGE", "multi")  # EN/ES code-switching
LLM_MODEL = os.getenv("LLM_MODEL", "google/gemini-3.1-flash-lite")
# The LiveKit project's data region limits which models work (EU projects get REGION_RESTRICTED on
# Inworld). Keep a model that has an EU endpoint so both US and EU projects work.
TTS_MODEL = os.getenv("TTS_MODEL", "xai/tts-1")
TTS_VOICE = os.getenv("TTS_VOICE", "ara")
TTS_LANGUAGE = os.getenv(
    "TTS_LANGUAGE", "auto"
)  # detected from the text, so Spanish replies still work

RPC_TIMEOUT_SECONDS = 5.0
ATTRIBUTES_WAIT_SECONDS = 3.0  # how long to wait for the tab's tz/date attributes after join

# Participant attribute names shared with the browser (frontend/oci/src/voice/session.ts).
ATTR_CONTRACT_VERSION = "contract_version"
ATTR_TZ = "tz"
ATTR_DATE = "date"
