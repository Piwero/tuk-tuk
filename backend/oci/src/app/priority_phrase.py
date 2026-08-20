"""Deterministic priority-phrase resolution (ADR 0005; issue #45).

The model (app.assist.parse_capture_extraction) only ever extracts a bare
phrase describing urgency — resolving it onto one of the Priority levels a
`!token` can also name is ordinary code, never model output.
"""

from app.schemas import Priority


def resolve_priority_phrase(phrase: str) -> Priority | None:
    """Resolves `phrase` onto one of the three priority levels a `!token`
    can also name (high/medium/low — "none" is never proposed, same as
    there being no `!none` token), or None when it names none of them."""
    words = phrase.strip().lower()
    if not words:
        return None
    if "high" in words or "urgent" in words or "asap" in words:
        return "high"
    if "medium" in words or "normal" in words:
        return "medium"
    if "low" in words:
        return "low"
    return None
