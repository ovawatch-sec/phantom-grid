"""
tools/registry.py — Central AD tool registry.

Add a new tool: implement it in tools/ad_tools.py (subclass BaseTool), then add
one line to REGISTRY. The scan engine reads this file — nothing else changes.
"""
from __future__ import annotations
from tools.base import BaseTool
from tools.ad_tools import (
    HostDiscoveryTool,
    LookupSidTool,
    AsRepRoastTool,
    KerberoastTool,
    SmbSharesTool,
    WinRmCheckTool,
    LdapDumpTool,
    BloodhoundTool,
    CrackAsRepTool,
    CrackKerberoastTool,
)

# key → class (not instance — instantiated per scan with output/data dirs)
REGISTRY: dict[str, type[BaseTool]] = {
    "host_discovery":   HostDiscoveryTool,
    "lookupsid":        LookupSidTool,
    "asrep_roast":      AsRepRoastTool,
    "kerberoast":       KerberoastTool,
    "smb_shares":       SmbSharesTool,
    "winrm_check":      WinRmCheckTool,
    "ldap_dump":        LdapDumpTool,
    "bloodhound":       BloodhoundTool,
    "crack_asrep":      CrackAsRepTool,
    "crack_kerberoast": CrackKerberoastTool,
}


def get_tool(name: str, output_dir, data_dir) -> BaseTool | None:
    cls = REGISTRY.get(name)
    if cls is None:
        return None
    return cls(output_dir=output_dir, data_dir=data_dir)


def list_tools() -> list[dict]:
    """Return tool metadata for the API /tools endpoint."""
    result = []
    for name, cls in REGISTRY.items():
        binary_name = getattr(cls, "binary_name", "")
        if binary_name is None:
            binary_name = "internal"
        elif binary_name == "":
            binary_name = name

        result.append({
            "name": name,
            "category": cls.category.value,
            "description": cls.description,
            "parallel_group": cls.parallel_group,
            "requires_root": cls.requires_root,
            "binary_name": binary_name,
        })
    return result
