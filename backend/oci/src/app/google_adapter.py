"""The concrete CalendarSource adapter — the only module that knows
Google's OAuth wire format (issue #105).
"""

import httpx

from app.calendar_source import CalendarSourceError, ExchangedCredential, RefreshedAccessToken

TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


class GoogleCalendarSource:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        # `transport` is a test-only seam (httpx.MockTransport); production
        # code never passes one and gets httpx's real network transport.
        self._transport = transport

    async def exchange_code(self, code: str, redirect_uri: str) -> ExchangedCredential:
        async with httpx.AsyncClient(transport=self._transport) as client:
            token_response = await client.post(
                TOKEN_URL,
                data={
                    "code": code,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            if token_response.status_code != 200:
                raise CalendarSourceError(
                    f"Google rejected the authorization code: {token_response.text}"
                )
            token_body = token_response.json()
            refresh_token = token_body.get("refresh_token")
            if not refresh_token:
                raise CalendarSourceError(
                    "Google granted no refresh token; reconnect to force re-consent"
                )
            access_token = token_body["access_token"]

            userinfo_response = await client.get(
                USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}
            )
            if userinfo_response.status_code != 200:
                raise CalendarSourceError(
                    f"Failed to fetch the connected account's identity: {userinfo_response.text}"
                )
            userinfo = userinfo_response.json()

        return ExchangedCredential(
            google_account_id=userinfo["id"],
            email=userinfo["email"],
            refresh_token=refresh_token,
        )

    async def refresh(self, refresh_token: str) -> RefreshedAccessToken:
        async with httpx.AsyncClient(transport=self._transport) as client:
            response = await client.post(
                TOKEN_URL,
                data={
                    "refresh_token": refresh_token,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "grant_type": "refresh_token",
                },
            )
            if response.status_code != 200:
                raise CalendarSourceError(f"Failed to refresh the access token: {response.text}")
            return RefreshedAccessToken(access_token=response.json()["access_token"])
