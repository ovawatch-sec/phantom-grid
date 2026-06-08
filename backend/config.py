"""
config.py — centralised settings loaded from environment / .env file.
"""
from __future__ import annotations
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ── Server ──────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False
    cors_origins: str = "*"

    # ── Storage ─────────────────────────────────────────
    output_dir: str = "/app/output"
    data_dir:   str = "/app/data"

    # Azure Table Storage (all optional — file storage is always enabled)
    azure_storage_enabled: bool = False
    azure_connection_string: str = ""
    azure_account_name: str = ""
    azure_account_key: str = ""
    azure_table_prefix: str = "phantomgrid"

    # ── Scan engine ─────────────────────────────────────
    max_concurrent_tool_groups: int = 4   # groups run in parallel
    # Password list used by the credential-cracking phase (hashcat).
    default_wordlist: str = "/app/data/wordlists/rockyou.txt"

    @property
    def output_path(self) -> Path:
        return Path(self.output_dir)

    @property
    def data_path(self) -> Path:
        return Path(self.data_dir)


settings = Settings()
