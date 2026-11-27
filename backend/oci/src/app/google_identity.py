"""Google sign-in (issue #586): the boundary to Google's OpenID Connect
endpoints, and verification of the ID token it returns.

Kept apart from app.calendar_source: signing in asks for identity only
(`openid email`), never Calendar scope or an offline refresh token, so a
User who declines Calendar consent still gets in.

`GoogleSignIn` is the injected port (tests fake it, exactly as they fake
the Calendar source); `verify_id_token` runs in the app, not the adapter,
so the trust checks (signature, issuer, audience, expiry, nonce) are the
same code whichever source produced the token.
"""

import base64
import binascii
import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicNumbers

from app.calendar_source import GoogleOAuthClient
from app.config import Settings

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = frozenset({"https://accounts.google.com", "accounts.google.com"})
SIGN_IN_SCOPE = "openid email"
# Tolerated clock difference between this server and Google's.
CLOCK_SKEW_SECONDS = 60


class GoogleSignInError(Exception):
    """Google refused the authorization code (or could not be reached)."""


class InvalidIdTokenError(Exception):
    """The ID token failed verification; it identifies nobody."""


@dataclass(frozen=True)
class GoogleIdentity:
    """A verified ID token's identity: Google's stable account id and the
    email it reports, with whether Google verified that email."""

    subject: str
    email: str
    email_verified: bool


class GoogleSignIn(Protocol):
    async def exchange_code(
        self, oauth_client: GoogleOAuthClient, code: str, redirect_uri: str, code_verifier: str
    ) -> str:
        """Trades an authorization code (with its PKCE verifier) for the
        raw ID token. Raises GoogleSignInError."""
        ...

    async def signing_keys(self) -> list[dict[str, Any]]:
        """Google's current JSON Web Keys. Raises GoogleSignInError."""
        ...


def shared_google_client(settings: Settings) -> GoogleOAuthClient | None:
    """The deployment's shared OAuth client, or None when not configured."""
    if settings.google_oauth_client_id and settings.google_oauth_client_secret:
        return GoogleOAuthClient(
            client_id=settings.google_oauth_client_id,
            client_secret=settings.google_oauth_client_secret,
        )
    return None


def new_pkce_verifier() -> str:
    return secrets.token_urlsafe(48)


def pkce_challenge(verifier: str) -> str:
    """RFC 7636's S256 challenge for `verifier`."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _b64decode(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def _b64int(segment: str) -> int:
    return int.from_bytes(_b64decode(segment), "big")


def verify_id_token(
    id_token: str,
    keys: list[dict[str, Any]],
    *,
    client_id: str,
    nonce: str,
    now: datetime,
) -> GoogleIdentity:
    """The identity an RS256 ID token asserts, after checking its
    signature against Google's keys, that Google issued it for this client,
    that it is current, and that it carries this sign-in's nonce. Raises
    InvalidIdTokenError on any failure."""
    try:
        header_segment, payload_segment, signature_segment = id_token.split(".")
        header = json.loads(_b64decode(header_segment))
        claims = json.loads(_b64decode(payload_segment))
        signature = _b64decode(signature_segment)
    except (ValueError, binascii.Error):
        raise InvalidIdTokenError("The ID token is malformed") from None
    if not isinstance(header, dict) or not isinstance(claims, dict):
        raise InvalidIdTokenError("The ID token is malformed")
    if header.get("alg") != "RS256":
        raise InvalidIdTokenError("The ID token is not RS256-signed")

    key = next(
        (k for k in keys if k.get("kid") == header.get("kid") and k.get("kty") == "RSA"), None
    )
    if key is None:
        raise InvalidIdTokenError("The ID token was signed with an unknown key")
    try:
        public_key = RSAPublicNumbers(_b64int(key["e"]), _b64int(key["n"])).public_key()
        public_key.verify(
            signature,
            f"{header_segment}.{payload_segment}".encode("ascii"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
    except (InvalidSignature, KeyError, ValueError, binascii.Error):
        raise InvalidIdTokenError("The ID token's signature is invalid") from None

    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise InvalidIdTokenError("The ID token was not issued by Google")
    audience = claims.get("aud")
    if isinstance(audience, list):
        if client_id not in audience or claims.get("azp") != client_id:
            raise InvalidIdTokenError("The ID token is for another client")
    elif audience != client_id:
        raise InvalidIdTokenError("The ID token is for another client")
    timestamp = now.timestamp()
    expires = claims.get("exp")
    if not isinstance(expires, int | float) or expires <= timestamp - CLOCK_SKEW_SECONDS:
        raise InvalidIdTokenError("The ID token has expired")
    issued = claims.get("iat")
    if isinstance(issued, int | float) and issued > timestamp + CLOCK_SKEW_SECONDS:
        raise InvalidIdTokenError("The ID token was issued in the future")
    presented_nonce = claims.get("nonce")
    if not isinstance(presented_nonce, str) or not secrets.compare_digest(presented_nonce, nonce):
        raise InvalidIdTokenError("The ID token belongs to another sign-in")

    subject, email = claims.get("sub"), claims.get("email")
    if not isinstance(subject, str) or not subject or not isinstance(email, str) or not email:
        raise InvalidIdTokenError("The ID token names no account")
    verified = claims.get("email_verified")
    return GoogleIdentity(
        subject=subject, email=email, email_verified=verified is True or verified == "true"
    )


class GoogleSignInAdapter:
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        # `transport` is a test-only seam, as in app.google_adapter.
        self._transport = transport

    async def exchange_code(
        self, oauth_client: GoogleOAuthClient, code: str, redirect_uri: str, code_verifier: str
    ) -> str:
        try:
            async with httpx.AsyncClient(transport=self._transport) as client:
                response = await client.post(
                    TOKEN_URL,
                    data={
                        "code": code,
                        "client_id": oauth_client.client_id,
                        "client_secret": oauth_client.client_secret,
                        "redirect_uri": redirect_uri,
                        "grant_type": "authorization_code",
                        "code_verifier": code_verifier,
                    },
                )
        except httpx.HTTPError as exc:
            raise GoogleSignInError(f"Could not reach Google: {type(exc).__name__}") from None
        if response.status_code != 200:
            raise GoogleSignInError(
                f"Google refused the authorization code ({response.status_code})"
            )
        id_token = response.json().get("id_token")
        if not isinstance(id_token, str):
            raise GoogleSignInError("Google returned no ID token")
        return id_token

    async def signing_keys(self) -> list[dict[str, Any]]:
        try:
            async with httpx.AsyncClient(transport=self._transport) as client:
                response = await client.get(JWKS_URL)
        except httpx.HTTPError as exc:
            raise GoogleSignInError(f"Could not reach Google: {type(exc).__name__}") from None
        if response.status_code != 200:
            raise GoogleSignInError(
                f"Google's signing keys are unavailable ({response.status_code})"
            )
        keys = response.json().get("keys")
        if not isinstance(keys, list):
            raise GoogleSignInError("Google's signing keys are malformed")
        return keys
