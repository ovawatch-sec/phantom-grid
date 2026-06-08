"""Storage configuration management."""
from __future__ import annotations
from fastapi import APIRouter

from models import StorageConfig

router = APIRouter(prefix="/settings", tags=["settings"])


def _get_storage():
    from main import storage
    return storage


@router.get("/storage")
async def get_storage_config():
    cfg = await _get_storage().load_storage_config()
    # Never return the actual storage account key.
    if "account_key" in cfg:
        cfg["account_key"] = "••••••••" if cfg["account_key"] else ""
    if "azure_account_key" in cfg:
        cfg["azure_account_key"] = "••••••••" if cfg["azure_account_key"] else ""
    return cfg


@router.post("/storage")
async def save_storage_config(body: StorageConfig):
    storage = _get_storage()
    existing = await storage.load_storage_config()
    cfg = body.model_dump()

    # Keep existing secret if UI sends blank/masked password field.
    existing_key = existing.get("account_key") or existing.get("azure_account_key") or ""
    if not cfg.get("account_key") or cfg.get("account_key") == "••••••••":
        cfg["account_key"] = existing_key

    await storage.save_storage_config(cfg)
    if body.azure_enabled:
        storage.enable_azure(
            conn_str=cfg.get("connection_string", ""),
            account=cfg.get("account_name", ""),
            key=cfg.get("account_key", ""),
            prefix=cfg.get("table_prefix", "phantomgrid"),
        )
    return {"ok": True}
