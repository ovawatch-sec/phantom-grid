"""Results retrieval and safe artifact serving."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, PlainTextResponse

from config import settings

router = APIRouter(prefix="/results", tags=["results"])


def _get_storage():
    from main import storage
    return storage


def _safe_output_path(rel_path: str) -> Path:
    base = Path(settings.output_dir).resolve()
    candidate = (base / rel_path).resolve()
    if base not in candidate.parents and candidate != base:
        raise HTTPException(400, "Invalid artifact path")
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(404, "Artifact not found")
    return candidate


@router.get("/{scan_id}")
async def get_results(scan_id: str):
    return await _get_storage().list_results(scan_id)


@router.get("/{scan_id}/by-category/{category}")
async def get_results_by_category(scan_id: str, category: str):
    results = await _get_storage().list_results(scan_id)
    return [r for r in results if r.category.value == category]


@router.get("/{scan_id}/summary")
async def get_summary(scan_id: str):
    results = await _get_storage().list_results(scan_id)
    summary = {}
    for r in results:
        cat = r.category.value
        summary[cat] = summary.get(cat, 0) + r.count
    return {
        "scan_id": scan_id,
        "totals": summary,
        "tool_count": len(results),
    }


@router.get("/{scan_id}/artifact")
async def get_artifact(scan_id: str, path: str = Query(..., min_length=1)):
    # scan_id remains in the route so the frontend keeps artifacts scoped to a scan URL.
    # The filesystem path is still strictly constrained to settings.output_dir.
    artifact = _safe_output_path(path)
    return FileResponse(str(artifact))


@router.get("/{scan_id}/artifact-text", response_class=PlainTextResponse)
async def get_artifact_text(scan_id: str, path: str = Query(..., min_length=1)):
    artifact = _safe_output_path(path)
    if artifact.suffix.lower() not in {".txt", ".md", ".json", ".jsonl", ".log"}:
        raise HTTPException(400, "Artifact is not a text file")
    return artifact.read_text(errors="replace")
