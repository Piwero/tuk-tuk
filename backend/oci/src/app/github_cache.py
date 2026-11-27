"""A short-lived cache in front of the GitHub source's reads (issue #583,
spec #576). Like the Event cache (app.event_cache), it lives in process
memory only and is never written to the database (ADR 0006): it absorbs
reopening the GitHub view without turning into a second source of truth.

The app holds one cache per item kind (Pull Requests, GitHub Issues), each
keyed on the User and the GitHub Token, so one User's results are never
served to another, nor one token's for another's.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from app.session import Clock

# Reopening the view within about a minute is instant (spec #576).
FRESH_FOR = timedelta(seconds=60)

# On a transient GitHub failure, a result this young is still worth
# showing, labelled stale (spec #576, ADR 0007).
STALE_FOR = timedelta(minutes=10)

# (owner user id, GitHub Token id)
_CacheKey = tuple[int, int]


@dataclass(frozen=True)
class CachedRead[Result]:
    """One token's successful read, which GitHub repositories (by id) it
    covers, and when it was fetched from GitHub."""

    result: Result
    repositories: frozenset[int]
    fetched_at: datetime


class GitHubReadCache[Result]:
    def __init__(self, clock: Clock) -> None:
        self._clock = clock
        self._entries: dict[_CacheKey, CachedRead[Result]] = {}

    def fresh(
        self, owner_id: int, token_id: int, repositories: frozenset[int]
    ) -> CachedRead[Result] | None:
        """The token's last read if it was fetched under 60 seconds ago and
        covers every one of `repositories`, so a repository watched since
        is read from GitHub rather than missing."""
        entry = self._younger_than(owner_id, token_id, FRESH_FOR)
        if entry is None or not repositories <= entry.repositories:
            return None
        return entry

    def stale(self, owner_id: int, token_id: int) -> CachedRead[Result] | None:
        """The token's last read if it was fetched under 10 minutes ago:
        what to show when GitHub is briefly unreachable."""
        return self._younger_than(owner_id, token_id, STALE_FOR)

    def _younger_than(
        self, owner_id: int, token_id: int, age: timedelta
    ) -> CachedRead[Result] | None:
        entry = self._entries.get((owner_id, token_id))
        if entry is None or self._clock() - entry.fetched_at >= age:
            return None
        return entry

    def store(
        self, owner_id: int, token_id: int, repositories: frozenset[int], result: Result
    ) -> CachedRead[Result]:
        entry = CachedRead(result=result, repositories=repositories, fetched_at=self._clock())
        self._entries[(owner_id, token_id)] = entry
        return entry

    def forget_owner(self, owner_id: int) -> None:
        self._entries = {key: entry for key, entry in self._entries.items() if key[0] != owner_id}

    def forget(self, owner_id: int, token_id: int) -> None:
        """Drops the token's last read, so it is never shown again."""
        self._entries.pop((owner_id, token_id), None)
