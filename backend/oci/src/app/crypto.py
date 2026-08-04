"""Encryption at rest for stored Google refresh credentials (issue #105).

Keyed by `Settings.google_encryption_key` — never `secret_key`. That key's
documented rotation procedure is the "log every device out" lever; coupling
the two would make a routine logout-everywhere silently destroy every
calendar connection.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken


def _fernet_key(key: str) -> bytes:
    """Fernet requires a 32-byte urlsafe-base64 key; the setting itself is
    an arbitrary operator-chosen string, like secret_key, so it's hashed
    down to the right shape rather than requiring a pre-formatted value.
    """
    return base64.urlsafe_b64encode(hashlib.sha256(key.encode()).digest())


def encrypt_credential(plaintext: str, *, key: str) -> str:
    return Fernet(_fernet_key(key)).encrypt(plaintext.encode()).decode()


def decrypt_credential(ciphertext: str, *, key: str) -> str:
    try:
        return Fernet(_fernet_key(key)).decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        raise ValueError("Credential could not be decrypted with this key") from None
