"""Inventory/topology validation, provenance separation, and action-boundary security."""
import pytest

from app.domain.topology import build_topology
from conftest import AB, diag, start

CABLE = {"id": "CBL-T900", "media": "fiber", "fiber_type": "OM4", "connector_a": "LC/UPC duplex", "connector_b": "LC/UPC duplex", "nominal_length_m": 2}


def test_invalid_endpoint_rejected(client):
    r = client.post("/api/cables", json={**CABLE, "endpoint_a": "asw-9:Ethernet9/9", "endpoint_b": "pp-01:F03"})
    assert r.status_code == 422
    assert any(i["code"] == "invalid_endpoint" for i in r.json()["error"]["details"])


def test_duplicate_occupancy_rejected(client):
    r = client.post("/api/cables", json={**CABLE, "endpoint_a": "asw-1:Ethernet1/1", "endpoint_b": "pp-01:F03"})
    assert r.status_code == 422
    assert any(i["code"] == "occupied" and "CBL-F201" in i["message"] for i in r.json()["error"]["details"])


def test_valid_cable_accepted_then_port_is_occupied(client):
    ok = client.post("/api/cables", json={**CABLE, "endpoint_a": "asw-2:Ethernet1/2", "endpoint_b": "pp-02:F03"})
    assert ok.status_code == 201
    again = client.post("/api/cables/validate", json={**CABLE, "id": "CBL-T901", "endpoint_a": "pp-02:F03", "endpoint_b": None}).json()
    assert again["valid"] is False


def test_patch_panel_is_passive(session, client):
    topo = build_topology(session)
    assert topo.devices["pp-01"]["is_passive"] and topo.devices["pp-01"]["role"] == "patch_panel"
    assert all(not topo.ifaces[i].ipv4_cidr for i in topo.ifaces if topo.ifaces[i].device_id in ("pp-01", "pp-02"))
    # links terminate on active devices only; panels appear as mated points
    for link in topo.links.values():
        assert not topo.is_passive(link.a) and not topo.is_passive(link.b)
    inv = start(client)
    r = client.post(f"/api/investigations/{inv}/diagnostics", json={"action": "interface_state", "target": {"interface": "pp-01:F01"}})
    assert r.status_code == 422 and "passive" in r.json()["error"]["message"]


def test_trace_does_not_invent_links(client):
    t = client.get("/api/topology/trace", params={"interface": "pp-01:F03"}).json()
    assert t["complete"] is False  # front F03 unpatched, rear goes via trunk pair 3 to PP-02 F03 which is unpatched
    t2 = client.get("/api/topology/trace", params={"interface": "asw-2:Ethernet1/2"}).json()
    assert t2["complete"] is False and t2["gap_reason"] == "no cable recorded on this port"
    full = client.get("/api/topology/trace", params={"interface": "srv-a:eth0"}).json()
    assert full["complete"] and full["end"] == "asw-1:Ethernet1/1"
    assert full["cables"] == ["CBL-F101", "TRK-0102-P1", "CBL-F201"]


def test_missing_label_flagged(client):
    audit = client.get("/api/cables").json()["audit"]
    assert any(a["code"] == "label_missing" and a["cable_id"] == "CBL-F102" for a in audit)


@pytest.mark.parametrize("action", ["shell", "rm -rf /", "reachability; reboot", "__import__('os')", ""])
def test_unsupported_actions_rejected(client, action):
    inv = start(client)
    r = client.post(f"/api/investigations/{inv}/diagnostics", json={"action": action, "target": AB})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsupported_action"


@pytest.mark.parametrize("target", [
    {"src": "srv-a", "dst": "srv-b; cat /etc/passwd"},
    {"src": "srv-a", "dst": "srv-b", "cmd": "id"},
    {"src": "$(id)", "dst": "srv-b"},
])
def test_arbitrary_strings_in_targets_rejected(client, target):
    inv = start(client)
    r = client.post(f"/api/investigations/{inv}/diagnostics", json={"action": "reachability", "target": target})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"


def test_param_bounds_enforced(client):
    inv = start(client)
    for params in ({"count": 100000}, {"payload_bytes": 65000}, {"count": "10; ls"}):
        r = client.post(f"/api/investigations/{inv}/diagnostics", json={"action": "reachability", "target": AB, "params": params})
        assert r.status_code == 422
    r = client.post(f"/api/investigations/{inv}/diagnostics", json={"action": "throughput", "target": AB, "params": {"duration_s": 600}})
    assert r.status_code == 422


def test_non_owned_impairment_rejected(client):
    inv = start(client, "packet-loss")
    ev = diag(client, inv, "impairment_inspect", {"interface": "asw-1:Ethernet1/49"})
    client.post(f"/api/investigations/{inv}/diagnosis", json={"category": "packet_loss_impairment", "statement": "x", "evidence_ids": [ev["id"]]})
    r = client.post(f"/api/investigations/{inv}/repairs", json={"action": "remove_impairment", "target": {"impairment_id": "fs-imp-9999"}})
    assert r.status_code == 404


def test_imported_and_simulated_evidence_distinguishable(client):
    inv = start(client, "low-rx-power")
    sim = diag(client, inv, "optical_telemetry", {"interface": "asw-1:Ethernet1/1"})
    r = client.post("/api/evidence/import", json={
        "format": "fiberscope.optical-observation.v1", "source_note": "sample", "investigation_id": inv,
        "observations": [{"interface_id": "asw-1:Ethernet1/1", "observed_at": "2026-01-01T00:00:00Z", "rx_power_dbm": -4.1, "tx_power_dbm": -2.0}],
    })
    assert r.status_code == 201
    d = client.get(f"/api/investigations/{inv}").json()
    modes = {e["id"]: e["source_mode"] for e in d["evidence"]}
    assert modes[sim["id"]] == "SIMULATED" and modes[r.json()["evidence_id"]] == "IMPORTED_SAMPLE"
    obs = client.get("/api/optics/observations", params={"interface": "asw-1:Ethernet1/1"}).json()["observations"]
    assert {o["source_mode"] for o in obs} == {"SIMULATED", "IMPORTED_SAMPLE"}


@pytest.mark.parametrize("bad", [
    {"interface_id": "asw-1:Ethernet1/50", "observed_at": "2026-01-01T00:00:00Z", "rx_power_dbm": -3},  # no optic
    {"interface_id": "asw-1:Ethernet1/1", "observed_at": "2026-01-01T00:00:00Z", "rx_power_dbm": 99},  # out of range
    {"interface_id": "asw-1:Ethernet1/1", "observed_at": "2999-01-01T00:00:00Z", "rx_power_dbm": -3},  # future
    {"interface_id": "asw-1:Ethernet1/1", "observed_at": "2026-01-01T00:00:00Z", "rx_power_dbm": -3, "script": "<x>"},
])
def test_import_validation(client, bad):
    r = client.post("/api/evidence/import", json={"format": "fiberscope.optical-observation.v1", "source_note": "x", "observations": [bad]})
    assert r.status_code == 422


def test_linux_lab_disabled_by_default(client):
    st = client.get("/api/lab/status").json()
    assert st["enabled"] is False and st["available"] is False
    r = client.post("/api/investigations", json={"scenario_key": "wrong-vlan", "source_mode": "LINUX_LAB"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "lab_disabled"


def test_linux_only_mode_restrictions(client):
    r = client.post("/api/investigations", json={"scenario_key": "low-rx-power", "source_mode": "LINUX_LAB"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsupported_in_mode"


def test_report_and_csv_from_history(client):
    inv = start(client, "wrong-vlan")
    diag(client, inv, "reachability", AB)
    rep = client.get(f"/api/reports/{inv}").json()
    for key in ("title", "scenario", "network_path", "initial_symptom", "baseline", "diagnostic_actions", "evidence", "diagnosis",
                "corrective_actions", "verification", "timeline", "limitations", "lessons_learned"):
        assert key in rep
    assert rep["scenario"]["source_mode"] == "SIMULATED"
    csv = client.get(f"/api/reports/{inv}/measurements.csv").text
    assert csv.splitlines()[0].startswith("evidence_id,phase,source_mode")
    assert "SIMULATED" in csv


def test_alembic_migration_applies(tmp_path):
    from alembic import command
    from alembic.config import Config
    from pathlib import Path
    from sqlalchemy import create_engine, inspect

    root = Path(__file__).resolve().parents[1]
    url = f"sqlite:///{tmp_path}/mig.db"
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")
    tables = set(inspect(create_engine(url)).get_table_names())
    assert {"evidence_items", "investigations", "cable_endpoints", "optical_observations"} <= tables
