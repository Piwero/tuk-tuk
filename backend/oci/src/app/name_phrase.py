"""Deterministic List/Tag phrase resolution (ADR 0005; issue #45).

The model (app.assist.parse_capture_extraction) only ever extracts a bare
phrase — a candidate List name, or one or more candidate Tag names.
Matching that phrase against what actually exists is ordinary code, never
model output: `resolve_name_phrase` only ever returns one of the
caller-supplied `candidates` (the user's real List/Tag names), so the model
can never cause a List or Tag to be invented (CONTEXT.md's Assist glossary:
"only existing Lists and Tags are matched, never invented").
"""

import re


def resolve_name_phrase(phrase: str, candidates: list[str]) -> str | None:
    """Case-insensitive match of `phrase` against `candidates`, returning the
    candidate's own casing — or None when nothing matches, which the caller
    treats the same as "not mentioned".

    Tries an exact match first, then falls back to a candidate appearing as
    a whole-word-bounded substring of the phrase (e.g. the model returning
    "my errands list" instead of the bare "errands"). This still can't
    invent a name — the match always has to name a real candidate — it just
    tolerates wrapper words around it. When multiple candidates match by
    containment, the longest one wins, since a longer match is a more
    specific (less accidental) match of the phrase.
    """
    normalized = phrase.strip().lower()
    if not normalized:
        return None

    for candidate in candidates:
        if candidate.lower() == normalized:
            return candidate

    best: str | None = None
    for candidate in candidates:
        candidate_normalized = candidate.strip().lower()
        if not candidate_normalized:
            continue
        pattern = r"(?<!\w)" + re.escape(candidate_normalized) + r"(?!\w)"
        if re.search(pattern, normalized) and (
            best is None or len(candidate_normalized) > len(best.strip().lower())
        ):
            best = candidate
    return best
