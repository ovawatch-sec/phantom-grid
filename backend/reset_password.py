#!/usr/bin/env python3
"""
reset_password.py — administrative password reset for PhantomGrid.

PhantomGrid uses single-password auth. The public ``/api/auth/setup`` endpoint
only sets the password on first run and refuses to overwrite an existing one, so
a forgotten password cannot be changed through the API by design. This offline
script is the supported recovery path.

It reuses the application's own primitives (``auth.hash_password`` /
``auth.new_secret``) and persistence layer (``FileStorage.save_auth``), so the
written record always matches what the running API expects.

Usage
-----
Interactive (recommended) — prompts twice, nothing hits the shell history::

    python3 reset_password.py

Inside the Docker container (auth.json lives in the ``phantomgrid-output`` volume)::

    docker exec -it phantomgrid python3 /app/backend/reset_password.py

Non-interactive / automation (password from stdin)::

    printf 'CorrectHorseBatteryStaple' | python3 reset_password.py

Explicit data location when running on the host::

    python3 reset_password.py --output-dir /var/lib/phantomgrid/output

By default the token-signing secret is rotated, logging out all existing
sessions. Pass ``--keep-sessions`` to preserve current logins.
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import logging
import os
import sys
from pathlib import Path

import auth as auth_lib
from storage.file_storage import FileStorage

logger = logging.getLogger("phantomgrid.reset_password")

# Keep in parity with api.auth.MIN_PASSWORD_LENGTH. Defined locally so the CLI
# does not need to import FastAPI just to read one constant.
MIN_PASSWORD_LENGTH = 8


def _default_output_dir() -> str:
    """Resolve the output directory the app uses, honouring OUTPUT_DIR / .env."""
    try:
        from config import settings

        return settings.output_dir
    except Exception:  # pragma: no cover - config import is best-effort here
        return os.environ.get("OUTPUT_DIR", "/app/output")


def _read_password(supplied: str | None) -> str:
    """Obtain the new password without ever echoing or logging it.

    Precedence: explicit ``--password`` > piped stdin (automation) > interactive
    double-entry prompt. Raises SystemExit with a clear message on any failure.
    """
    if supplied is not None:
        return supplied

    if not sys.stdin.isatty():
        # Non-interactive context (e.g. piped input): take a single line.
        line = sys.stdin.readline()
        if not line:
            raise SystemExit(
                "No password provided: stdin is empty and no terminal is "
                "available for a prompt. Use --password or pipe the password in."
            )
        return line.rstrip("\n")

    first = getpass.getpass("New password: ")
    second = getpass.getpass("Confirm new password: ")
    if first != second:
        raise SystemExit("Passwords do not match.")
    return first


def _build_record(password: str, existing: dict, keep_sessions: bool) -> dict:
    """Build the auth record, rotating the signing secret unless asked to keep it."""
    record = auth_lib.hash_password(password)
    if keep_sessions and existing.get("secret"):
        record["secret"] = existing["secret"]
    else:
        record["secret"] = auth_lib.new_secret()
    return record


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="reset_password.py",
        description="Reset (or initialise) the PhantomGrid login password.",
    )
    parser.add_argument(
        "-p",
        "--password",
        help="New password. INSECURE: visible in shell history and the process "
        "list. Prefer the interactive prompt or piping via stdin.",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="PhantomGrid output directory holding .meta/auth.json. "
        "Defaults to the app's configured OUTPUT_DIR.",
    )
    parser.add_argument(
        "--keep-sessions",
        action="store_true",
        help="Preserve the existing token-signing secret so current logins stay "
        "valid. By default the secret is rotated, logging out all sessions.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Reset the password and persist the new auth record. Returns a process exit code."""
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)
    args = _parse_args(argv)

    output_dir = Path(args.output_dir or _default_output_dir())
    try:
        storage = FileStorage(output_dir)
    except OSError as exc:
        logger.error("Cannot access output directory %s: %s", output_dir, exc)
        return 1

    existing = asyncio.run(storage.load_auth())

    if args.password is not None:
        logger.warning(
            "Reading the password from --password is insecure (shell history / "
            "process list). Prefer the interactive prompt."
        )

    password = _read_password(args.password)
    if len(password) < MIN_PASSWORD_LENGTH:
        logger.error("Password must be at least %d characters.", MIN_PASSWORD_LENGTH)
        return 2

    record = _build_record(password, existing, args.keep_sessions)

    try:
        asyncio.run(storage.save_auth(record))
    except OSError as exc:
        logger.error("Failed to write auth record under %s: %s", output_dir, exc)
        return 1

    rotated = not (args.keep_sessions and existing.get("secret"))
    action = "reset" if existing.get("hash") else "initialised"
    logger.info("Password %s. Auth record written to %s", action, output_dir / ".meta" / "auth.json")
    if rotated:
        logger.info("Token-signing secret rotated — all existing sessions are logged out.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
