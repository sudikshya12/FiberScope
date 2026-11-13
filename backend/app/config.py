"""Runtime configuration (environment variables, no secrets committed)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    database_url: str = field(
        default_factory=lambda: os.getenv(
            "FIBERSCOPE_DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'data' / 'fiberscope.db'}"
        )
    )
    # Linux lab mode is OFF unless the operator explicitly enables it AND a runner is configured.
    linux_lab_enabled: bool = field(default_factory=lambda: _env_bool("FIBERSCOPE_LINUX_LAB_ENABLED"))
    lab_runner_url: str = field(default_factory=lambda: os.getenv("FIBERSCOPE_LAB_RUNNER_URL", "http://127.0.0.1:8765"))
    lab_runner_token: str = field(default_factory=lambda: os.getenv("FIBERSCOPE_LAB_RUNNER_TOKEN", ""))
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip()
            for o in os.getenv("FIBERSCOPE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
            if o.strip()
        )
    )
    auto_migrate: bool = field(default_factory=lambda: _env_bool("FIBERSCOPE_AUTO_MIGRATE", True))


settings = Settings()
