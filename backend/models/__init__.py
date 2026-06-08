"""
models/__init__.py — Pydantic data models for projects, scans, and results.
These are the canonical shapes used by the API, storage layer, and tool outputs.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


# ══════════════════════════════════════════════════════════
# ENUMS
# ══════════════════════════════════════════════════════════

class ScanStatus(str, Enum):
    PENDING   = "pending"
    RUNNING   = "running"
    COMPLETED = "completed"
    FAILED    = "failed"
    CANCELLED = "cancelled"


class ToolCategory(str, Enum):
    DISCOVERY = "discovery"   # host / DC discovery
    ACCOUNT   = "account"     # users, groups, SIDs
    KERBEROS  = "kerberos"    # AS-REP / Kerberoast hash harvesting
    SHARE     = "share"       # SMB shares / file access
    SERVICE   = "service"     # WinRM and other service access checks
    LDAP      = "ldap"        # LDAP / directory dumps
    GRAPH     = "graph"       # BloodHound collection
    CRED      = "cred"        # cracked credentials


class ResultSeverity(str, Enum):
    CRITICAL = "critical"
    HIGH     = "high"
    MEDIUM   = "medium"
    LOW      = "low"
    INFO     = "info"
    UNKNOWN  = "unknown"


# ══════════════════════════════════════════════════════════
# PROJECT
# ══════════════════════════════════════════════════════════

class ProjectCreate(BaseModel):
    name: str
    description: str = ""


class Project(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    description: str = ""
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)
    scan_count: int = 0

    def to_table_entity(self) -> dict:
        return {
            "PartitionKey": "projects",
            "RowKey": self.id,
            "name": self.name,
            "description": self.description,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "scan_count": self.scan_count,
        }

    @staticmethod
    def from_table_entity(e: dict) -> "Project":
        return Project(
            id=e["RowKey"],
            name=e.get("name", ""),
            description=e.get("description", ""),
            created_at=datetime.fromisoformat(e.get("created_at", now_utc().isoformat())),
            updated_at=datetime.fromisoformat(e.get("updated_at", now_utc().isoformat())),
            scan_count=int(e.get("scan_count", 0)),
        )


# ══════════════════════════════════════════════════════════
# TARGET
# ══════════════════════════════════════════════════════════

class TargetCreate(BaseModel):
    domain: str
    is_oos: bool = False   # True = out-of-scope


class Target(BaseModel):
    id: str = Field(default_factory=new_id)
    project_id: str
    domain: str
    is_oos: bool = False
    added_at: datetime = Field(default_factory=now_utc)

    def to_table_entity(self) -> dict:
        return {
            "PartitionKey": self.project_id,
            "RowKey": self.id,
            "domain": self.domain,
            "is_oos": self.is_oos,
            "added_at": self.added_at.isoformat(),
        }

    @staticmethod
    def from_table_entity(e: dict) -> "Target":
        return Target(
            id=e["RowKey"],
            project_id=e["PartitionKey"],
            domain=e.get("domain", ""),
            is_oos=bool(e.get("is_oos", False)),
            added_at=datetime.fromisoformat(e.get("added_at", now_utc().isoformat())),
        )


# ══════════════════════════════════════════════════════════
# SCAN
# ══════════════════════════════════════════════════════════

DEFAULT_AD_TOOLS = [
    "host_discovery",
    "lookupsid",
    "asrep_roast", "kerberoast",
    "smb_shares", "winrm_check", "ldap_dump",
    "bloodhound",
    "crack_asrep", "crack_kerberoast",
]


class AdCredentials(BaseModel):
    """Authentication material for a scan. Never persisted to storage — these are
    passed straight to the scan engine and held only for the duration of the run."""
    ad_domain: str = ""          # e.g. CORP.LOCAL ("" for local/non-domain auth)
    username: str = ""
    password: str = ""
    ntlm_hash: str = ""          # NT hash for pass-the-hash; mutually exclusive with password


class ScanCreate(BaseModel):
    project_id: str
    tools: list[str] = Field(default_factory=lambda: list(DEFAULT_AD_TOOLS))
    # Credentials used to authenticate against the target domain/hosts.
    credentials: AdCredentials = Field(default_factory=AdCredentials)
    # Password list for the credential-cracking phase (None → engine default).
    wordlist: Optional[str] = None
    # When True, reuse successful tool results from the project's most recent scan.
    reuse_previous: bool = False


class ScanProgress(BaseModel):
    tool: str
    status: str          # "running" | "done" | "error" | "skipped" | "completed" | "failed"
    message: str = ""
    count: int = 0       # results produced
    elapsed_s: float = 0.0
    ts: datetime = Field(default_factory=now_utc)
    domain: str = ""
    phase: str = ""
    phase_index: int = 0
    phase_total: int = 0
    completed_tools: int = 0      # phase-completed tools
    total_tools: int = 0          # phase-total tools
    overall_completed_tools: int = 0
    overall_total_tools: int = 0


class Scan(BaseModel):
    id: str = Field(default_factory=new_id)
    project_id: str
    status: ScanStatus = ScanStatus.PENDING
    tools: list[str] = Field(default_factory=list)
    # Non-secret auth metadata for display/audit. Password and NTLM hash are
    # deliberately NOT stored — they are handed to the engine in memory only.
    ad_domain: str = ""
    username: str = ""
    wordlist: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    progress: list[ScanProgress] = Field(default_factory=list)
    error: str = ""

    def to_table_entity(self) -> dict:
        import json
        return {
            "PartitionKey": self.project_id,
            "RowKey": self.id,
            "status": self.status.value,
            "tools": json.dumps(self.tools),
            "ad_domain": self.ad_domain,
            "username": self.username,
            "wordlist": self.wordlist or "",
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else "",
            "completed_at": self.completed_at.isoformat() if self.completed_at else "",
            "error": self.error,
        }

    @staticmethod
    def from_table_entity(e: dict) -> "Scan":
        import json
        return Scan(
            id=e["RowKey"],
            project_id=e["PartitionKey"],
            status=ScanStatus(e.get("status", "pending")),
            tools=json.loads(e.get("tools", "[]")),
            ad_domain=e.get("ad_domain", ""),
            username=e.get("username", ""),
            wordlist=e.get("wordlist") or None,
            created_at=datetime.fromisoformat(e.get("created_at", now_utc().isoformat())),
            started_at=datetime.fromisoformat(e["started_at"]) if e.get("started_at") else None,
            completed_at=datetime.fromisoformat(e["completed_at"]) if e.get("completed_at") else None,
            error=e.get("error", ""),
        )


# ══════════════════════════════════════════════════════════
# TOOL RESULT  (one row per tool per domain per scan)
# ══════════════════════════════════════════════════════════

class ToolResult(BaseModel):
    """
    Generic container that every tool produces.
    `data` is a list of category-specific typed dicts.
    Using a list[dict] keeps the model open — adding a new tool
    means adding a new parser, NOT a schema migration.
    """
    id: str = Field(default_factory=new_id)
    scan_id: str
    project_id: str
    tool: str
    category: ToolCategory
    domain: str
    data: list[dict[str, Any]] = Field(default_factory=list)
    count: int = 0
    elapsed_s: float = 0.0
    created_at: datetime = Field(default_factory=now_utc)
    error: str = ""

    def model_post_init(self, __context: Any) -> None:
        if not self.count:
            self.count = len(self.data)

    def to_table_entity(self) -> dict:
        import json
        return {
            "PartitionKey": self.scan_id,
            "RowKey": self.id,
            "project_id": self.project_id,
            "tool": self.tool,
            "category": self.category.value,
            "domain": self.domain,
            "data": json.dumps(self.data),
            "count": self.count,
            "elapsed_s": self.elapsed_s,
            "created_at": self.created_at.isoformat(),
            "error": self.error,
        }

    @staticmethod
    def from_table_entity(e: dict) -> "ToolResult":
        import json
        return ToolResult(
            id=e["RowKey"],
            scan_id=e["PartitionKey"],
            project_id=e.get("project_id", ""),
            tool=e.get("tool", ""),
            category=ToolCategory(e.get("category", "discovery")),
            domain=e.get("domain", ""),
            data=json.loads(e.get("data", "[]")),
            count=int(e.get("count", 0)),
            elapsed_s=float(e.get("elapsed_s", 0)),
            created_at=datetime.fromisoformat(e.get("created_at", now_utc().isoformat())),
            error=e.get("error", ""),
        )


# ══════════════════════════════════════════════════════════
# STORAGE CONFIG
# ══════════════════════════════════════════════════════════

class StorageConfig(BaseModel):
    azure_enabled: bool = False
    connection_string: str = ""
    account_name: str = ""
    account_key: str = ""
    table_prefix: str = "phantomgrid"
