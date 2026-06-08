"""
main.py — FastAPI application entry point.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from storage import DualStorage

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)

logger = logging.getLogger(__name__)

# ── Global storage instance (singleton) ──────────────────────────
storage = DualStorage(settings.output_dir)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure output / data dirs exist
    Path(settings.output_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)

    # Load persisted Azure config on startup
    cfg = await storage.load_storage_config()

    if cfg.get("azure_enabled"):
        storage.enable_azure(
            conn_str=cfg.get("connection_string", ""),
            account=cfg.get("account_name", ""),
            key=cfg.get("account_key", ""),
            prefix=cfg.get("table_prefix", "phantomgrid"),
        )

    logger.info("PhantomGrid backend started")
    yield
    logger.info("PhantomGrid backend stopped")


app = FastAPI(
    title="PhantomGrid AD API",
    version="3.0.0",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in settings.cors_origins.split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API Routes ───────────────────────────────────────────────────
from fastapi import Depends

from api.auth import router as auth_router, require_auth
from api.projects import router as projects_router
from api.scans import router as scans_router
from api.results import router as results_router
from api.settings import router as settings_router
from api.tools import router as tools_router

# Auth endpoints are public (status/setup/login). Everything else requires a token.
app.include_router(auth_router, prefix="/api")

for router in [
    projects_router,
    scans_router,
    results_router,
    settings_router,
    tools_router,
]:
    app.include_router(router, prefix="/api", dependencies=[Depends(require_auth)])


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "3.0.0"}


# ── Serve Angular frontend (built files) ─────────────────────────
FRONTEND_DIR = Path("/app/frontend/dist/phantomgrid/browser")
ASSETS_DIR = FRONTEND_DIR / "assets"
INDEX_FILE = FRONTEND_DIR / "index.html"

if FRONTEND_DIR.exists() and INDEX_FILE.exists():
    # Angular may not generate assets/ if there are no assets.
    # Starlette StaticFiles crashes if the directory does not exist.
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    app.mount(
        "/assets",
        StaticFiles(directory=str(ASSETS_DIR)),
        name="assets",
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        requested_file = FRONTEND_DIR / full_path

        if requested_file.exists() and requested_file.is_file():
            return FileResponse(str(requested_file))

        return FileResponse(str(INDEX_FILE))

else:
    logger.warning(
        "Angular frontend build not found. Expected index.html at: %s",
        INDEX_FILE,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
