"""Authenticated loopback client for the privileged lab runner (no shell, fixed request schema)."""
from __future__ import annotations

import uuid
from typing import Any

import httpx

from ..config import settings
from ..services.catalog import ActionError


class RunnerClient:
    def __init__(self, base_url: str | None = None, token: str | None = None, timeout_s: float = 75.0):
        self.base_url = (base_url or settings.lab_runner_url).rstrip("/")
        self.token = token if token is not None else settings.lab_runner_token
        self.timeout_s = timeout_s

    def call(self, body: dict[str, Any], timeout_s: float | None = None) -> dict[str, Any]:
        if not self.token:
            raise ActionError("lab_unavailable", "Linux lab runner token is not configured.")
        body = {**body, "request_id": uuid.uuid4().hex[:16]}
        try:
            r = httpx.post(f"{self.base_url}/v1/run", json=body, headers={"Authorization": f"Bearer {self.token}"},
                           timeout=timeout_s or self.timeout_s)
        except httpx.HTTPError as exc:
            raise ActionError("lab_unavailable", f"Lab runner unreachable: {exc.__class__.__name__}") from exc
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code != 200:
            raise ActionError(data.get("error", "lab_error"), data.get("message", f"Lab runner returned HTTP {r.status_code}"))
        return data

    def status(self) -> dict[str, Any]:
        return self.call({"op": "status"}, timeout_s=3)
