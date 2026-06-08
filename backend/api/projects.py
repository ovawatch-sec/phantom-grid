"""Projects, Targets CRUD."""
from __future__ import annotations
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from models import Project, ProjectCreate, Target, TargetCreate

router = APIRouter(prefix="/projects", tags=["projects"])


def _get_storage():
    from main import storage
    return storage


@router.get("/")
async def list_projects():
    return await _get_storage().list_projects()


@router.post("/", status_code=201)
async def create_project(body: ProjectCreate):
    p = Project(name=body.name, description=body.description)
    await _get_storage().save_project(p)
    return p


@router.get("/{project_id}")
async def get_project(project_id: str):
    p = await _get_storage().get_project(project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str):
    await _get_storage().delete_project(project_id)


# ── Targets ──────────────────────────────────────────────────────

@router.get("/{project_id}/targets")
async def list_targets(project_id: str):
    return await _get_storage().list_targets(project_id)


@router.post("/{project_id}/targets", status_code=201)
async def add_target(project_id: str, body: TargetCreate):
    t = Target(project_id=project_id, domain=body.domain, is_oos=body.is_oos)
    await _get_storage().save_target(t)
    return t


@router.delete("/{project_id}/targets/{target_id}", status_code=204)
async def delete_target(project_id: str, target_id: str):
    await _get_storage().delete_target(target_id, project_id)
