"""
storage/azure_storage.py — Azure Table Storage implementation.
Activated only when azure_storage_enabled=True in config.
Writes to 5 tables: {prefix}Projects, Targets, Scans, Results, Config.
"""
from __future__ import annotations
import json
import logging
from typing import Any

from models import Project, Target, Scan, ToolResult
from storage.base import BaseStorage

logger = logging.getLogger(__name__)


class AzureTableStorage(BaseStorage):
    def __init__(self, connection_string: str = "", account_name: str = "",
                 account_key: str = "", prefix: str = "phantomgrid"):
        try:
            from azure.data.tables import TableServiceClient
            if connection_string:
                svc = TableServiceClient.from_connection_string(connection_string)
            else:
                svc = TableServiceClient(
                    endpoint=f"https://{account_name}.table.core.windows.net",
                    credential=account_key,
                )
            self._svc = svc
            self._prefix = prefix
            self._tables: dict[str, Any] = {}
            for name in ["Projects", "Targets", "Scans", "Results", "Config"]:
                full = f"{prefix}{name}"
                try:
                    svc.create_table_if_not_exists(full)
                except Exception:
                    pass
                self._tables[name] = svc.get_table_client(full)
            self._ok = True
        except Exception as exc:
            logger.error(f"Azure Table Storage init failed: {exc}")
            self._ok = False

    def _t(self, name: str):
        return self._tables[name]

    def _upsert(self, table_name: str, entity: dict) -> None:
        if not self._ok:
            return
        try:
            self._t(table_name).upsert_entity(entity)
        except Exception as exc:
            logger.error(f"Azure upsert {table_name} failed: {exc}")

    def _query(self, table_name: str, filter_str: str) -> list[dict]:
        if not self._ok:
            return []
        try:
            return list(self._t(table_name).query_entities(filter_str))
        except Exception as exc:
            logger.error(f"Azure query {table_name} failed: {exc}")
            return []

    def _get(self, table_name: str, pk: str, rk: str) -> dict | None:
        if not self._ok:
            return None
        try:
            return self._t(table_name).get_entity(pk, rk)
        except Exception:
            return None

    def _delete(self, table_name: str, pk: str, rk: str) -> None:
        if not self._ok:
            return
        try:
            self._t(table_name).delete_entity(pk, rk)
        except Exception:
            pass

    # ── Projects ───────────────────────────────────────────
    async def save_project(self, p: Project) -> None:
        self._upsert("Projects", p.to_table_entity())

    async def get_project(self, project_id: str) -> Project | None:
        e = self._get("Projects", "projects", project_id)
        return Project.from_table_entity(e) if e else None

    async def list_projects(self) -> list[Project]:
        rows = self._query("Projects", "PartitionKey eq 'projects'")
        return [Project.from_table_entity(r) for r in rows]

    async def delete_project(self, project_id: str) -> None:
        self._delete("Projects", "projects", project_id)

    # ── Targets ────────────────────────────────────────────
    async def save_target(self, t: Target) -> None:
        self._upsert("Targets", t.to_table_entity())

    async def list_targets(self, project_id: str) -> list[Target]:
        rows = self._query("Targets", f"PartitionKey eq '{project_id}'")
        return [Target.from_table_entity(r) for r in rows]

    async def delete_target(self, target_id: str, project_id: str) -> None:
        self._delete("Targets", project_id, target_id)

    # ── Scans ──────────────────────────────────────────────
    async def save_scan(self, s: Scan) -> None:
        self._upsert("Scans", s.to_table_entity())

    async def get_scan(self, scan_id: str) -> Scan | None:
        rows = self._query("Scans", f"RowKey eq '{scan_id}'")
        return Scan.from_table_entity(rows[0]) if rows else None

    async def list_scans(self, project_id: str) -> list[Scan]:
        rows = self._query("Scans", f"PartitionKey eq '{project_id}'")
        return [Scan.from_table_entity(r) for r in rows]

    # ── Results ────────────────────────────────────────────
    async def save_result(self, r: ToolResult) -> None:
        entity = r.to_table_entity()
        # Azure Table rows are capped at 1MB; chunk large data arrays
        data_str = entity.get("data", "[]")
        if len(data_str) > 900_000:
            # Store count only; full data lives in file storage
            entity["data"] = json.dumps(r.data[:100])
            entity["data_truncated"] = True
        self._upsert("Results", entity)

    async def list_results(self, scan_id: str) -> list[ToolResult]:
        rows = self._query("Results", f"PartitionKey eq '{scan_id}'")
        return [ToolResult.from_table_entity(r) for r in rows]

    # ── Config ─────────────────────────────────────────────
    async def save_storage_config(self, config: dict) -> None:
        entity = {"PartitionKey": "config", "RowKey": "storage", **config}
        self._upsert("Config", entity)

    async def load_storage_config(self) -> dict:
        e = self._get("Config", "config", "storage")
        return dict(e) if e else {}

    async def save_tool_api_keys(self, config: dict) -> None:
        entity = {"PartitionKey": "config", "RowKey": "tool_api_keys", **config}
        self._upsert("Config", entity)

    async def load_tool_api_keys(self) -> dict:
        e = self._get("Config", "config", "tool_api_keys")
        return dict(e) if e else {}
