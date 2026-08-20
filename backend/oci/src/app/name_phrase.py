"""Deterministic List/Tag phrase resolution (ADR 0005; issue #45).

The model (app.assist.parse_capture_extraction) only ever extracts a bare
phrase — a candidate List name, or one or more candidate Tag names.
Matching that phrase against what actually exists is ordinary code, never
model output: `resolve_name_phrase` only ever returns one of the
caller-supplied `candidates` (the user's real List/Tag names), so the model
can never cause a List or Tag to be invented (CONTEXT.md's Assist glossary:
"only existing Lists and Tags are matched, never invented").
"""


def resolve_name_phrase(phrase: str, candidates: list[str]) -> str | None:
    """Case-insensitive exact match of `phrase` against `candidates`,
    returning the candidate's own casing — or None when nothing matches,
    which the caller treats the same as "not mentioned"."""
    normalized = phrase.strip().lower()
    for candidate in candidates:
        if candidate.lower() == normalized:
            return candidate
    return None
