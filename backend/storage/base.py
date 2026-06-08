"""storage/base.py — abstract storage interface."""
from __future__ import annotations
from abc import ABC, abstractmethod
from models import Project, Target, Scan, ToolResult


class BaseStorage(ABC):

    @abstractmethod
    async def save_project(self, project: Project) -> None: ...

    @abstractmethod
    async def get_project(self, project_id: str) -> Project | None: ...

    @abstractmethod
    async def list_projects(self) -> list[Project]: ...

    @abstractmethod
    async def delete_project(self, project_id: str) -> None: ...

    @abstractmethod
    async def save_target(self, target: Target) -> None: ...

    @abstractmethod
    async def list_targets(self, project_id: str) -> list[Target]: ...

    @abstractmethod
    async def delete_target(self, target_id: str, project_id: str) -> None: ...

    @abstractmethod
    async def save_scan(self, scan: Scan) -> None: ...

    @abstractmethod
    async def get_scan(self, scan_id: str) -> Scan | None: ...

    @abstractmethod
    async def list_scans(self, project_id: str) -> list[Scan]: ...

    @abstractmethod
    async def save_result(self, result: ToolResult) -> None: ...

    @abstractmethod
    async def list_results(self, scan_id: str) -> list[ToolResult]: ...

    @abstractmethod
    async def save_storage_config(self, config: dict) -> None: ...

    @abstractmethod
    async def load_storage_config(self) -> dict: ...

    @abstractmethod
    async def save_tool_api_keys(self, config: dict) -> None: ...

    @abstractmethod
    async def load_tool_api_keys(self) -> dict: ...

    # ── Auth (local-only control-plane secret; not mirrored to Azure) ──
    async def save_auth(self, record: dict) -> None:
        raise NotImplementedError

    async def load_auth(self) -> dict:
        raise NotImplementedError
