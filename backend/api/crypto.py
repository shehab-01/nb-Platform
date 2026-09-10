"""
Encryption for per-store secrets (Conversions API token, Pathao password, …).

Fernet (AES-128-CBC + HMAC, versioned, from `cryptography`) keyed by
APP_ENCRYPTION_KEY. The variable may hold several keys, comma-separated: the
first encrypts, all of them decrypt, which is how a key is rotated — add the
new key at the front, re-save the settings over time, drop the old key.

Nothing decrypted ever leaves the API: settings endpoints return "set / not
set" plus the last few characters (see api.routers.store_settings).
"""
from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken, MultiFernet


class EncryptionUnavailable(RuntimeError):
    """APP_ENCRYPTION_KEY is missing or malformed."""


def _keys() -> list[bytes]:
    raw = os.getenv("APP_ENCRYPTION_KEY", "")
    return [k.strip().encode() for k in raw.split(",") if k.strip()]


def _fernet() -> MultiFernet:
    keys = _keys()
    if not keys:
        raise EncryptionUnavailable(
            "APP_ENCRYPTION_KEY is not set; generate one with "
            "`python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"`"
        )
    try:
        return MultiFernet([Fernet(k) for k in keys])
    except (ValueError, TypeError) as exc:
        raise EncryptionUnavailable(f"APP_ENCRYPTION_KEY is malformed: {exc}") from exc


def available() -> bool:
    try:
        _fernet()
    except EncryptionUnavailable:
        return False
    return True


def encrypt(plaintext: str) -> bytes:
    return _fernet().encrypt(plaintext.encode("utf-8"))


def decrypt(ciphertext: bytes | None) -> str | None:
    """None for None. Raises InvalidToken if no configured key can open it."""
    if ciphertext is None:
        return None
    return _fernet().decrypt(bytes(ciphertext)).decode("utf-8")


def hint(plaintext: str | None, keep: int = 4) -> str | None:
    """The tail of a secret, for "ends with …1234" in the admin. None when
    unset; the whole thing is never shown."""
    if not plaintext:
        return None
    return plaintext[-keep:] if len(plaintext) > keep else "*" * len(plaintext)


__all__ = ["EncryptionUnavailable", "InvalidToken", "available", "decrypt", "encrypt", "hint"]
