"""
storage/__init__.py — DualStorage writes to file always + Azure when enabled.
"""
from __future__ import annotations
import logging
from models import Project, Target, Scan, ToolResult
from storage.base import BaseStorage
from storage.file_storage import FileStorage

logger = logging.getLogger(__name__)


class DualStorage(BaseStorage):
    """Writes to FileStorage always. AzureTableStorage additionally when configured."""

    def __init__(self, output_dir: str):
        self._file = FileStorage(output_dir)
        self._azure: BaseStorage | None = None

    def enable_azure(self, conn_str: str = "", account: str = "",
                     key: str = "", prefix: str = "phantomgrid") -> None:
        try:
            from storage.azure_storage import AzureTableStorage
            self._azure = AzureTableStorage(conn_str, account, key, prefix)
            logger.info("Azure Table Storage enabled")
        except Exception as exc:
            logger.error(f"Could not enable Azure: {exc}")
            self._azure = None

    async def _both(self, method: str, *args, **kwargs) -> None:
        await getattr(self._file, method)(*args, **kwargs)
        if self._azure:
            try:
                await getattr(self._azure, method)(*args, **kwargs)
            except Exception as exc:
                logger.warning(f"Azure {method} failed (file storage OK): {exc}")

    # ── Projects ─────────────────────────────────────────────
    async def save_project(self, p: Project) -> None:
        await self._both("save_project", p)

    async def get_project(self, pid: str) -> Project | None:
        return await self._file.get_project(pid)

    async def list_projects(self) -> list[Project]:
        return await self._file.list_projects()

    async def delete_project(self, pid: str) -> None:
        await self._both("delete_project", pid)

    # ── Targets ──────────────────────────────────────────────
    async def save_target(self, t: Target) -> None:
        await self._both("save_target", t)

    async def list_targets(self, project_id: str) -> list[Target]:
        return await self._file.list_targets(project_id)

    async def delete_target(self, tid: str, pid: str) -> None:
        await self._both("delete_target", tid, pid)

    # ── Scans ────────────────────────────────────────────────
    async def save_scan(self, s: Scan) -> None:
        await self._both("save_scan", s)

    async def get_scan(self, scan_id: str) -> Scan | None:
        return await self._file.get_scan(scan_id)

    async def list_scans(self, project_id: str) -> list[Scan]:
        return await self._file.list_scans(project_id)

    # ── Results ──────────────────────────────────────────────
    async def save_result(self, r: ToolResult) -> None:
        await self._both("save_result", r)

    async def list_results(self, scan_id: str) -> list[ToolResult]:
        return await self._file.list_results(scan_id)

    # ── Config ───────────────────────────────────────────────
    async def save_storage_config(self, config: dict) -> None:
        await self._both("save_storage_config", config)

    async def load_storage_config(self) -> dict:
        return await self._file.load_storage_config()

    async def save_tool_api_keys(self, config: dict) -> None:
        await self._both("save_tool_api_keys", config)

    async def load_tool_api_keys(self) -> dict:
        return await self._file.load_tool_api_keys()

    # ── Auth (local file only — never mirrored to Azure) ──────
    async def save_auth(self, record: dict) -> None:
        await self._file.save_auth(record)

    async def load_auth(self) -> dict:
        return await self._file.load_auth()
