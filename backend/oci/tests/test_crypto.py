"""Encryption of sensitive `settings` columns and stored Google refresh
credentials at rest (issue #105; ADR 0008).

Deliberately keyed by APP_MASTER_KEY, never the session signing key — the
whole point is that rotating the session key (e.g. on a password change)
must not affect this.
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
        """APP_MASTER_KEY is an arbitrary operator-chosen string, not a
        pre-formatted Fernet key — any string must work.
        """
        ciphertext = encrypt_credential("token", key="short")

        assert decrypt_credential(ciphertext, key="short") == "token"
