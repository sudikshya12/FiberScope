"""FastAPI application entrypoint (unprivileged web API)."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select

from . import models as m
from .api.routes import router
from .config import BACKEND_DIR, settings
from .db import SessionLocal
from .seed import seed
from .services.catalog import ActionError
from .services.investigations import WorkflowError

log = logging.getLogger("fiberscope")


def run_migrations() -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.auto_migrate:
        run_migrations()
        with SessionLocal() as s:
            if not s.scalar(select(func.count()).select_from(m.Device)):
                log.info("empty database — seeding North Lab Fabric")
                seed(s)
            else:
                seed(s)  # idempotent refresh of inventory + scenario definitions; history untouched
    yield


app = FastAPI(
    title="FiberScope API",
    version="0.1.0",
    description="Network & Fiber Troubleshooting Lab — simulation engine, evidence store, investigation workflow. "
    "Independent portfolio project; all device output in SIMULATED mode is generated, not captured.",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["*"], allow_headers=["*"])


def _err(status: int, code: str, message: str, details=None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details}})


@app.exception_handler(WorkflowError)
async def _wf(_r: Request, exc: WorkflowError):
    return _err(exc.status, exc.code, exc.message, exc.details)


@app.exception_handler(ActionError)
async def _act(_r: Request, exc: ActionError):
    status = {"not_owned": 403, "not_found": 404, "lab_unavailable": 503, "lab_disabled": 503, "lab_not_ready": 503}.get(exc.code, 422)
    return _err(status, exc.code, exc.message, exc.details)


@app.exception_handler(RequestValidationError)
async def _val(_r: Request, exc: RequestValidationError):
    return _err(422, "invalid_request", "Request body or parameters are invalid.", [
        {"loc": list(e.get("loc", [])), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()
    ])


@app.exception_handler(PermissionError)
async def _perm(_r: Request, exc: PermissionError):
    return _err(409, "immutable", str(exc))


app.include_router(router)

_static = os.getenv("FIBERSCOPE_STATIC_DIR")
if _static and Path(_static).is_dir():
    app.mount("/assets", StaticFiles(directory=Path(_static) / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        f = Path(_static) / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(Path(_static) / "index.html")
