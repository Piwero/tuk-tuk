"""Encryption at rest for sensitive columns of the DB-backed `settings`
table and stored Google refresh credentials (issue #105; ADR 0008).

Keyed by `Settings.app_master_key` — never the session signing key stored
in `settings` itself. That would be the self-encryption problem ADR 0008
exists to avoid: a key protecting DB-stored secrets can't itself live in
the database it protects.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken


def _fernet_key(key: str) -> bytes:
    """Fernet requires a 32-byte urlsafe-base64 key; the setting itself is
    an arbitrary operator-chosen string, so it's hashed down to the right
    shape rather than requiring a pre-formatted value.
    """
    return base64.urlsafe_b64encode(hashlib.sha256(key.encode()).digest())


def encrypt_credential(plaintext: str, *, key: str) -> str:
    return Fernet(_fernet_key(key)).encrypt(plaintext.encode()).decode()


def decrypt_credential(ciphertext: str, *, key: str) -> str:
    try:
        return Fernet(_fernet_key(key)).decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        raise ValueError("Credential could not be decrypted with this key") from None
