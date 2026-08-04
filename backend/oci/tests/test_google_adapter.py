"""The Google-wire-format adapter (issue #105) — the only module in the
suite that speaks Google's OAuth wire format. Exercised against a stubbed
HTTP transport; no test in the suite ever contacts Google for real.
"""

import httpx
import pytest

from app.calendar_source import CalendarSourceError
from app.google_adapter import GoogleCalendarSource

TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


def adapter(handler: httpx.MockTransport) -> GoogleCalendarSource:
    return GoogleCalendarSource(
        client_id="a-client-id", client_secret="a-client-secret", transport=handler
    )


class TestExchangeCode:
    async def test_returns_the_identity_and_refresh_token_on_success(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            if request.url == TOKEN_URL:
                assert "client_secret=a-client-secret" in request.content.decode()
                return httpx.Response(200, json={"access_token": "at-1", "refresh_token": "rt-1"})
            assert request.url == USERINFO_URL
            assert request.headers["Authorization"] == "Bearer at-1"
            return httpx.Response(200, json={"id": "google-123", "email": "a@example.com"})

        credential = await adapter(httpx.MockTransport(handle)).exchange_code(
            "auth-code", redirect_uri="https://tuk-tuk.example/api/v1/google/callback"
        )

        assert credential.google_account_id == "google-123"
        assert credential.email == "a@example.com"
        assert credential.refresh_token == "rt-1"

    async def test_raises_when_google_rejects_the_code(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, json={"error": "invalid_grant"})

        with pytest.raises(CalendarSourceError):
            await adapter(httpx.MockTransport(handle)).exchange_code(
                "bad-code", redirect_uri="https://tuk-tuk.example/api/v1/google/callback"
            )

    async def test_raises_when_google_grants_no_refresh_token(self) -> None:
        """Google omits refresh_token on a repeat consent without
        prompt=consent; treated as a hard failure rather than silently
        losing the ability to stay connected."""

        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"access_token": "at-1"})

        with pytest.raises(CalendarSourceError):
            await adapter(httpx.MockTransport(handle)).exchange_code(
                "auth-code", redirect_uri="https://tuk-tuk.example/api/v1/google/callback"
            )

    async def test_raises_when_userinfo_lookup_fails(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            if request.url == TOKEN_URL:
                return httpx.Response(200, json={"access_token": "at-1", "refresh_token": "rt-1"})
            return httpx.Response(500, text="server error")

        with pytest.raises(CalendarSourceError):
            await adapter(httpx.MockTransport(handle)).exchange_code(
                "auth-code", redirect_uri="https://tuk-tuk.example/api/v1/google/callback"
            )


class TestRefresh:
    async def test_returns_a_fresh_access_token(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            assert request.url == TOKEN_URL
            assert "refresh_token=rt-1" in request.content.decode()
            return httpx.Response(200, json={"access_token": "at-2"})

        token = await adapter(httpx.MockTransport(handle)).refresh("rt-1")

        assert token.access_token == "at-2"

    async def test_raises_when_the_refresh_token_is_revoked(self) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, json={"error": "invalid_grant"})

        with pytest.raises(CalendarSourceError):
            await adapter(httpx.MockTransport(handle)).refresh("revoked-token")
