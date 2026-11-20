"""API tokens (GLOSSARY.md, ADR 0014's amendment, issue #413): minting a
token, and finding the live token a request presents.

A token reads `tuk_pat_<user id>_<64 hex digits>`: 256 random bits from
`secrets`, behind a prefix a secret scanner (or a person) recognises. Only
its SHA-256 hash is stored: the secret is random, not a password a person
chose, so a slow hash would add nothing but per-request cost.

The owner's id is part of the token so the auth middleware can look the
token up acting as that User (app.ownership), like every other read of an
owned row, instead of needing a cross-user exemption from the owner filter.
A token naming the wrong User simply matches no row: the hash is only
searched among that User's own tokens.
"""

import hashlib
import re
import secrets
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ApiToken

TOKEN_PREFIX = "tuk_pat_"
# How much of the token is kept in the clear, after the owner's id, so its
# owner can tell their tokens apart. 8 of 64 hex digits leaves 224 secret bits.
_PREFIX_SECRET_DIGITS = 8
_TOKEN_PATTERN = re.compile(r"^tuk_pat_([1-9][0-9]{0,9})_([0-9a-f]{64})$")

# `last_used_at` is written at most this often per token: a busy client
# must not turn every read into a write.
LAST_USED_RESOLUTION = timedelta(minutes=5)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def mint(user_id: int, name: str) -> tuple[ApiToken, str]:
    """A new token for `user_id` (not yet added to a session) and its
    plaintext, which is never stored: the caller shows it once."""
    token = f"{TOKEN_PREFIX}{user_id}_{secrets.token_hex(32)}"
    prefix = token[: token.rindex("_") + 1 + _PREFIX_SECRET_DIGITS]
    return ApiToken(name=name, token_hash=_hash(token), prefix=prefix), token


def owner_of(token: str) -> int | None:
    """The User id a well-formed token names, or None when it is not a
    token at all. Says nothing about whether the token is valid."""
    match = _TOKEN_PATTERN.match(token)
    return int(match.group(1)) if match else None


async def find_live_token(session: AsyncSession, token: str) -> ApiToken | None:
    """The unrevoked token whose plaintext is `token`. Runs acting as the
    User the token names (the caller's `acting_as`), so only their tokens
    are searched."""
    found: ApiToken | None = await session.scalar(
        select(ApiToken).where(ApiToken.token_hash == _hash(token), ApiToken.revoked_at.is_(None))
    )
    return found


def mark_used(api_token: ApiToken, now: datetime) -> bool:
    """Records that the token was just used, unless it already was within
    LAST_USED_RESOLUTION. True when the row changed and needs committing."""
    last = api_token.last_used_at
    if last is not None and now - last < LAST_USED_RESOLUTION:
        return False
    api_token.last_used_at = now
    return True
