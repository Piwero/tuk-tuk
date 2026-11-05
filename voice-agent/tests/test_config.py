"""Model choices must work in every LiveKit data region (EU projects reject US-only models)."""

from tuk_voice_agent.config import TTS_MODEL


def test_tts_model_defaults_to_eu_supported_model() -> None:
    assert TTS_MODEL == "xai/tts-1"
