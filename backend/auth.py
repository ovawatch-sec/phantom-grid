"""
auth.py — self-contained single-password authentication for PhantomGrid.

Design goals:
  - First run: the user sets a password. No default credentials ever exist.
  - Password is stored only as a salted PBKDF2-HMAC-SHA256 hash (never plaintext).
  - Login issues an HMAC-signed, expiring bearer token. No server-side session
    table is needed — the token is self-verifying against a per-install secret.
  - Zero extra dependencies (uses hashlib/hmac/secrets from the stdlib).

The auth record is persisted via the file storage layer at .meta/auth.json and is
intentionally never mirrored to Azure — it is a local control-plane secret.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from typing import Any

# PBKDF2 cost. 200k SHA-256 iterations is a sensible 2024-era default for an
# interactive login on commodity hardware.
_PBKDF2_ITERATIONS = 200_000
_PBKDF2_DIGEST = "sha256"
_SALT_BYTES = 16

# Tokens are valid for 7 days; the UI silently re-authenticates on 401.
TOKEN_TTL_SECONDS = 7 * 24 * 3600


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64d(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def hash_password(password: str, salt: bytes | None = None) -> dict[str, str]:
    """Return a salted PBKDF2 hash record for the given password."""
    if salt is None:
        salt = secrets.token_bytes(_SALT_BYTES)
    derived = hashlib.pbkdf2_hmac(
        _PBKDF2_DIGEST, password.encode("utf-8"), salt, _PBKDF2_ITERATIONS
    )
    return {
        "algorithm": f"pbkdf2_{_PBKDF2_DIGEST}",
        "iterations": str(_PBKDF2_ITERATIONS),
        "salt": _b64e(salt),
        "hash": _b64e(derived),
    }


def verify_password(password: str, record: dict[str, Any]) -> bool:
    """Constant-time verification of a password against a stored hash record."""
    try:
        salt = _b64d(str(record.get("salt", "")))
        expected = _b64d(str(record.get("hash", "")))
        iterations = int(record.get("iterations", _PBKDF2_ITERATIONS))
    except (ValueError, TypeError):
        return False

    derived = hashlib.pbkdf2_hmac(
        _PBKDF2_DIGEST, password.encode("utf-8"), salt, iterations
    )
    return hmac.compare_digest(derived, expected)


def new_secret() -> str:
    """Generate a fresh per-install token-signing secret."""
    return _b64e(secrets.token_bytes(32))


def issue_token(secret: str, ttl: int = TOKEN_TTL_SECONDS) -> str:
    """Issue an HMAC-signed bearer token of the form ``<expiry>.<signature>``."""
    expiry = str(int(time.time()) + ttl)
    signature = _sign(secret, expiry)
    return f"{expiry}.{signature}"


def verify_token(secret: str, token: str | None) -> bool:
    """Validate an issued token: correct signature and not yet expired."""
    if not token or not secret or "." not in token:
        return False
    expiry, _, signature = token.partition(".")
    expected = _sign(secret, expiry)
    if not hmac.compare_digest(signature, expected):
        return False
    try:
        return int(expiry) > int(time.time())
    except ValueError:
        return False


def _sign(secret: str, payload: str) -> str:
    mac = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256)
    return _b64e(mac.digest())
