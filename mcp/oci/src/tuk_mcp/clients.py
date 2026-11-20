"""Per-client state of the shared HTTP server (issue #525).

What a client has read decides what it may write (the write-id allowlist,
`tuk_mcp.tools`), so that provenance must outlive one MCP request: a
client reads, then writes in a later call. It must also never be shared
between clients. Each MCP token is one client, so state is keyed by
`Grant.client_key` — the User and token id the backend's exchange
returned — never by a raw token or anything else the client sent.

Bounded both ways: an entry idle longer than `idle_seconds` is dropped, and
past `max_clients` the least recently used goes first. A dropped client
simply reads again before its next write. Each entry has its own lock, so
one client's requests run one at a time while different clients run side
by side.
"""

import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field

ClientKey = tuple[int, int]


@dataclass
class ClientState:
    task_ids: set[int] = field(default_factory=set)
    habit_ids: set[int] = field(default_factory=set)
    lock: threading.Lock = field(default_factory=threading.Lock)
    last_used: float = 0.0


class ClientStates:
    def __init__(
        self,
        max_clients: int = 256,
        idle_seconds: float = 8 * 3600,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._max = max_clients
        self._idle = idle_seconds
        self._clock = clock
        self._entries: OrderedDict[ClientKey, ClientState] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: ClientKey) -> ClientState:
        now = self._clock()
        with self._lock:
            for stale in [k for k, s in self._entries.items() if now - s.last_used > self._idle]:
                del self._entries[stale]
            state = self._entries.pop(key, None) or ClientState()
            state.last_used = now
            self._entries[key] = state
            while len(self._entries) > self._max:
                self._entries.popitem(last=False)
            return state

    def __len__(self) -> int:
        return len(self._entries)
