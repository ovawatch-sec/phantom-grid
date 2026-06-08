"""Tool metadata endpoint."""
from pathlib import Path

from fastapi import APIRouter

from config import settings
from tools.registry import REGISTRY, get_tool, list_tools

router = APIRouter(prefix="/tools", tags=["tools"])


@router.get("/")
async def get_tools():
    tools = list_tools()
    output_dir = Path(settings.output_dir)
    data_dir = Path(settings.data_dir)

    for item in tools:
        tool = get_tool(item["name"], output_dir, data_dir)
        availability_error = tool.availability_error() if tool else "Tool is not registered"
        item["available"] = availability_error is None
        item["availability_error"] = availability_error or ""
        item["binary"] = tool.binary_name if tool and tool.binary_name not in ("", None) else item["name"]
        if tool and tool.binary_name is None:
            item["binary"] = "internal"

    return tools
