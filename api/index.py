"""Vercel entrypoint: the FiberScope FastAPI app as a Python serverless function.

The serverless filesystem is read-only except /tmp, so the SQLite database lives there and is
created + seeded on cold start. Data therefore resets when an instance is recycled — fine for a
public demo; attach a persistent database (FIBERSCOPE_DATABASE_URL) for durable history.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("FIBERSCOPE_DATABASE_URL", "sqlite:////tmp/fiberscope.db")
os.environ.setdefault("FIBERSCOPE_AUTO_MIGRATE", "0")

from app import models  # noqa: E402,F401  (register tables)
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.seed import seed  # noqa: E402

Base.metadata.create_all(engine)
with SessionLocal() as _s:
    seed(_s)

from app.main import app  # noqa: E402,F401  (ASGI app picked up by the Vercel Python runtime)
