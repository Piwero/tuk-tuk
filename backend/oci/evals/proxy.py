"""A pass-through provider proxy that records token usage (issue #190).

The suite needs to answer "what does a full pass cost?", and the app
deliberately throws that away: `_post_completion` reads `choices` and
nothing else, because a token count is not something a chat turn has any
use for. Rather than thread a usage channel through production code for
the benefit of a manual script, the script points the app at this proxy
and the proxy points at the real provider — the app is unchanged, the
request on the wire is the real one, and the `usage` block every
OpenAI-compatible provider returns is read off the response as it passes.
"""

import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx

_FORWARD_TIMEOUT_SECONDS = 120.0


@dataclass
class Usage:
    """Tokens billed across every call made through the proxy."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    calls: int = 0
    # Providers vary in what they report; anything unrecognised is kept
    # verbatim rather than silently rounded to zero, so a run against a
    # provider with a different usage shape says so instead of claiming
    # the pass was free.
    unreported_calls: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def cost_usd(self, price_in: float, price_out: float) -> float:
        """Dollars, given per-million-token input/output prices. Prices are
        an argument rather than a table in this repo: a hard-coded price
        list is wrong the week a provider changes one, and wrong quietly."""
        return (self.prompt_tokens * price_in + self.completion_tokens * price_out) / 1_000_000


class _ProxyServer(ThreadingHTTPServer):
    """Carries the upstream and the running tally the handler needs.

    A typed subclass rather than attributes stapled onto a stock
    `ThreadingHTTPServer`: the handler reads both on every request, and
    smuggling them past the type checker would mean three `type: ignore`s
    guarding the one thing this module exists to get right."""

    def __init__(self, upstream: str, usage: Usage) -> None:
        super().__init__(("127.0.0.1", 0), _ProxyHandler)
        self.upstream = upstream.rstrip("/")
        self.usage = usage


class _ProxyHandler(BaseHTTPRequestHandler):
    server: _ProxyServer

    def do_POST(self) -> None:  # noqa: N802
        self._forward("POST")

    def do_GET(self) -> None:  # noqa: N802
        self._forward("GET")

    def _forward(self, method: str) -> None:
        server = self.server
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else None
        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() in ("authorization", "content-type")
        }
        usage = server.usage
        try:
            response = httpx.request(
                method,
                f"{server.upstream}{self.path}",
                content=body,
                headers=headers,
                timeout=_FORWARD_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            usage.errors.append(f"{type(exc).__name__}: {exc!r}")
            self.send_response(502)
            self.end_headers()
            return

        if self.path.endswith("/chat/completions"):
            usage.calls += 1
            self._record(response, usage)

        self.send_response(response.status_code)
        self.send_header("Content-Type", response.headers.get("content-type", "application/json"))
        self.send_header("Content-Length", str(len(response.content)))
        self.end_headers()
        self.wfile.write(response.content)

    @staticmethod
    def _record(response: httpx.Response, usage: Usage) -> None:
        try:
            reported = response.json().get("usage") or {}
        except ValueError:
            reported = {}
        prompt = reported.get("prompt_tokens")
        completion = reported.get("completion_tokens")
        if not isinstance(prompt, int) or not isinstance(completion, int):
            usage.unreported_calls += 1
            return
        usage.prompt_tokens += prompt
        usage.completion_tokens += completion

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass


class UsageProxy:
    """Runs on localhost for the length of a pass; the app is configured
    against `base_url` and every call is forwarded to `upstream`."""

    def __init__(self, upstream: str) -> None:
        self.usage = Usage()
        self._server = _ProxyServer(upstream, self.usage)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    @property
    def base_url(self) -> str:
        host, port = self._server.socket.getsockname()[:2]
        return f"http://{host!s}:{port}"

    def __enter__(self) -> "UsageProxy":
        return self

    def __exit__(self, *exc: object) -> None:
        self.stop()

    def stop(self) -> None:
        self._server.shutdown()
        self._thread.join()
