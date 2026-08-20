"""Deterministic priority-phrase resolution (ADR 0005; issues #45, #46).

The model (app.assist.parse_capture_extraction) only ever extracts a bare
phrase describing urgency — resolving it onto one of the Priority levels a
`!token` can also name is ordinary code, never model output.

Spanish is first-class alongside English (issue #46): "urgente"/"alta"
mirror "urgent"/"high", "media" mirrors "medium", and "baja" mirrors "low".
"""

import unicodedata

from app.schemas import Priority


def _fold(text: str) -> str:
    normalized = unicodedata.normalize("NFD", text.lower())
    return "".join(c for c in normalized if unicodedata.category(c) != "Mn")


def resolve_priority_phrase(phrase: str) -> Priority | None:
    """Resolves `phrase` onto one of the three priority levels a `!token`
    can also name (high/medium/low — "none" is never proposed, same as
    there being no `!none` token), or None when it names none of them."""
    words = _fold(phrase.strip())
    if not words:
        return None
    if "high" in words or "urgent" in words or "asap" in words or "alta" in words:
        return "high"
    if "medium" in words or "normal" in words or "media" in words:
        return "medium"
    if "low" in words or "baja" in words:
        return "low"
    return None
