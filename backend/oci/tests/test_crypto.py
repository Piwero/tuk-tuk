"""Encryption of stored Google refresh credentials at rest (issue #105).

Deliberately keyed by its own setting, never secret_key — the whole point
is that rotating the session signing key must not affect this.
"""

import pytest

from app.crypto import decrypt_credential, encrypt_credential


class TestEncryptDecrypt:
    def test_round_trips_the_plaintext(self) -> None:
        ciphertext = encrypt_credential("a-refresh-token", key="key-one")

        assert decrypt_credential(ciphertext, key="key-one") == "a-refresh-token"

    def test_the_stored_value_is_not_the_plaintext(self) -> None:
        ciphertext = encrypt_credential("a-refresh-token", key="key-one")

        assert "a-refresh-token" not in ciphertext

    def test_decrypting_with_a_different_key_fails(self) -> None:
        ciphertext = encrypt_credential("a-refresh-token", key="key-one")

        with pytest.raises(ValueError, match="decrypted"):
            decrypt_credential(ciphertext, key="key-two")

    def test_two_different_keys_of_any_shape_both_work(self) -> None:
        """The key setting is an arbitrary operator-chosen string (like
        secret_key), not a pre-formatted Fernet key — any string must work.
        """
        ciphertext = encrypt_credential("token", key="short")

        assert decrypt_credential(ciphertext, key="short") == "token"
