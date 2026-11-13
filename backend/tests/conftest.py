import os
import sys
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp(prefix="fiberscope-test-")
os.environ["FIBERSCOPE_DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["FIBERSCOPE_AUTO_MIGRATE"] = "0"
os.environ.pop("FIBERSCOPE_LINUX_LAB_ENABLED", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed  # noqa: E402


@pytest.fixture()
def session():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    s = SessionLocal()
    seed(s)
    yield s
    s.close()


@pytest.fixture()
def client(session):
    with TestClient(app) as c:
        yield c


AB = {"src": "srv-a", "dst": "srv-b"}


def start(client, key="wrong-vlan", mode="guided"):
    inv = client.post("/api/investigations", json={"scenario_key": key, "mode": mode}).json()
    assert client.post(f"/api/investigations/{inv['id']}/baseline").status_code == 200
    assert client.post(f"/api/investigations/{inv['id']}/inject-fault").status_code == 200
    return inv["id"]


def diag(client, inv_id, action, target, params=None):
    r = client.post(f"/api/investigations/{inv_id}/diagnostics", json={"action": action, "target": target, "params": params or {}})
    assert r.status_code == 200, r.text
    return r.json()["evidence"]
