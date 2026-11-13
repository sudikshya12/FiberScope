"""Investigation workflow, resolution criteria, evidence immutability, reset isolation."""
import pytest
from sqlalchemy import select

from app import models as m
from conftest import AB, diag, start

FIX = {
    "wrong-vlan": ("set_access_vlan", {"interface": "asw-2:Ethernet1/1"}, {"vlan": 20}, "l2_vlan", ("vlan_membership", {"device": "asw-2"})),
    "admin-down": ("enable_interface", {"interface": "asw-1:Ethernet1/1"}, {}, "admin_state", ("interface_state", {"interface": "asw-1:Ethernet1/1"})),
    "packet-loss": ("remove_impairment", {"impairment_id": "fs-imp-0001"}, {}, "packet_loss_impairment", ("impairment_inspect", {"interface": "asw-1:Ethernet1/49"})),
    "mtu-mismatch": ("set_mtu", {"interface": "asw-2:Ethernet1/49"}, {"mtu": 9216}, "mtu_mismatch", ("mtu_probe", AB)),
    "low-rx-power": ("clean_connector", {"location": "pp-02:F01"}, {}, "optical_path_degraded", ("optical_telemetry", {"interface": "asw-1:Ethernet1/1"})),
}


def _diagnose(client, inv, key):
    action, target = FIX[key][4]
    ev = diag(client, inv, action, target)
    r = client.post(f"/api/investigations/{inv}/diagnosis", json={"category": FIX[key][3], "statement": "diagnosis", "evidence_ids": [ev["id"]]})
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("key", list(FIX))
def test_every_scenario_resolves_end_to_end(client, key):
    inv = start(client, key)
    _diagnose(client, inv, key)
    a, t, p = FIX[key][:3]
    assert client.post(f"/api/investigations/{inv}/repairs", json={"action": a, "target": t, "params": p}).status_code == 200
    vr = client.post(f"/api/investigations/{inv}/verify").json()["verification"]
    assert vr["passed"], vr
    assert len(vr["checks"]) >= 2  # never a single-ping verification
    assert client.post(f"/api/investigations/{inv}/resolve", json={}).status_code == 200
    d = client.get(f"/api/investigations/{inv}").json()
    assert d["answer_key"]["diagnosis_matched"] is True


def test_repair_alone_does_not_resolve(client):
    inv = start(client, "wrong-vlan")
    _diagnose(client, inv, "wrong-vlan")
    client.post(f"/api/investigations/{inv}/repairs", json={"action": "set_access_vlan", "target": {"interface": "asw-2:Ethernet1/1"}, "params": {"vlan": 20}})
    r = client.post(f"/api/investigations/{inv}/resolve", json={})
    assert r.status_code == 409 and r.json()["error"]["code"] == "resolution_criteria_unmet"


def test_repair_requires_diagnosis(client):
    inv = start(client, "wrong-vlan")
    r = client.post(f"/api/investigations/{inv}/repairs", json={"action": "set_access_vlan", "target": {"interface": "asw-2:Ethernet1/1"}, "params": {"vlan": 20}})
    assert r.status_code == 409 and r.json()["error"]["code"] == "diagnosis_required"


def test_single_ping_does_not_verify_mtu(client):
    """Wrong repair (VLAN noop) on MTU scenario: ping passes but verification must fail."""
    inv = start(client, "mtu-mismatch")
    _diagnose(client, inv, "mtu-mismatch")
    client.post(f"/api/investigations/{inv}/repairs", json={"action": "set_access_vlan", "target": {"interface": "asw-2:Ethernet1/1"}, "params": {"vlan": 20}})
    vr = client.post(f"/api/investigations/{inv}/verify").json()["verification"]
    by = {c["id"]: c["passed"] for c in vr["checks"]}
    assert by["small_probe"] is True and by["large_probe"] is False and vr["passed"] is False


def test_repairs_touch_only_intended_resources(session, client):
    inv = start(client, "wrong-vlan")
    exe_id = client.get(f"/api/investigations/{inv}").json()["execution"]["id"]
    before = session.get(m.ScenarioExecution, exe_id).state
    _diagnose(client, inv, "wrong-vlan")
    client.post(f"/api/investigations/{inv}/repairs", json={"action": "set_access_vlan", "target": {"interface": "asw-2:Ethernet1/1"}, "params": {"vlan": 20}})
    session.expire_all()
    after = session.get(m.ScenarioExecution, exe_id).state
    changed = [k for k in before["ifaces"] if before["ifaces"][k] != after["ifaces"][k]]
    assert changed == ["asw-2:Ethernet1/1"]
    assert before["optics"] == after["optics"] and before["impairments"] == after["impairments"]


def test_evidence_is_immutable_and_hash_verified(session, client):
    inv = start(client, "wrong-vlan")
    ev = diag(client, inv, "reachability", AB)
    assert client.get(f"/api/evidence/{ev['id']}").json()["integrity_ok"] is True
    row = session.get(m.EvidenceItem, ev["id"])
    row.interpretation = "tampered"
    with pytest.raises(PermissionError):
        session.commit()
    session.rollback()
    with pytest.raises(PermissionError):
        session.delete(session.get(m.EvidenceItem, ev["id"]))
        session.commit()
    session.rollback()


def test_evidence_preserved_after_repair_and_new_observations_are_new_rows(client):
    inv = start(client, "wrong-vlan")
    before = diag(client, inv, "vlan_membership", {"device": "asw-2"})
    _diagnose(client, inv, "wrong-vlan")
    client.post(f"/api/investigations/{inv}/repairs", json={"action": "set_access_vlan", "target": {"interface": "asw-2:Ethernet1/1"}, "params": {"vlan": 20}})
    after = diag(client, inv, "vlan_membership", {"device": "asw-2"})
    assert before["id"] != after["id"]
    old = client.get(f"/api/evidence/{before['id']}").json()
    assert old["payload"]["mismatches"] and not after["payload"]["mismatches"]


def test_reset_affects_only_selected_simulation(session, client):
    a, b = start(client, "wrong-vlan"), start(client, "admin-down")
    ev_a = diag(client, a, "reachability", AB)
    assert client.post(f"/api/investigations/{a}/reset").status_code == 200
    da, db = client.get(f"/api/investigations/{a}").json(), client.get(f"/api/investigations/{b}").json()
    assert da["status"] == "abandoned" and da["execution"]["status"] == "reset"
    assert db["status"] == "investigating" and db["execution"]["status"] == "faulted"
    assert any(e["id"] == ev_a["id"] for e in da["evidence"])  # history preserved
    s_b = session.get(m.ScenarioExecution, db["execution"]["id"]).state
    assert s_b["ifaces"]["asw-1:Ethernet1/1"]["admin_up"] is False


def test_restart_preserves_history(client):
    a = start(client, "wrong-vlan")
    new = client.post(f"/api/investigations/{a}/restart").json()
    ids = [i["id"] for i in client.get("/api/investigations").json()["investigations"]]
    assert a in ids and new["id"] in ids and new["id"] != a
    assert client.get(f"/api/investigations/{a}").json()["status"] == "abandoned"


def test_abandon_is_not_success(client):
    a = start(client, "wrong-vlan")
    client.post(f"/api/investigations/{a}/abandon", json={"reason": "time"})
    assert client.post(f"/api/investigations/{a}/resolve", json={}).status_code == 409


def test_reopen_after_resolution(client):
    inv = start(client, "admin-down")
    _diagnose(client, inv, "admin-down")
    client.post(f"/api/investigations/{inv}/repairs", json={"action": "enable_interface", "target": {"interface": "asw-1:Ethernet1/1"}})
    client.post(f"/api/investigations/{inv}/verify")
    client.post(f"/api/investigations/{inv}/resolve", json={})
    assert client.post(f"/api/investigations/{inv}/reopen", json={"reason": "recurred"}).json()["status"] == "investigating"
    assert client.post(f"/api/investigations/{inv}/resolve", json={}).status_code == 409  # needs fresh verification


def test_challenge_mode_withholds_answer_and_hints(client):
    inv = start(client, "wrong-vlan", mode="challenge")
    d = client.get(f"/api/investigations/{inv}").json()
    assert d["answer_key"] is None and d["scenario"]["key"] == "undisclosed"
    assert "hints" not in d["scenario_definition"] and "corrective_action" not in d["scenario_definition"]
    ev = diag(client, inv, "reachability", AB)
    assert ev["next_steps"] == []
    fault_event = next(t for t in d["timeline"] if t["kind"] == "fault_injected")
    assert "changed_resources" not in fault_event["data"]


def test_diagnosis_requires_post_fault_evidence(client):
    inv = client.post("/api/investigations", json={"scenario_key": "wrong-vlan"}).json()["id"]
    base = client.post(f"/api/investigations/{inv}/baseline").json()["evidence_ids"]
    client.post(f"/api/investigations/{inv}/inject-fault")
    r = client.post(f"/api/investigations/{inv}/diagnosis", json={"category": "l2_vlan", "statement": "x", "evidence_ids": base[:1]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "evidence_required"


def test_state_survives_new_session(session, client):
    inv = start(client, "wrong-vlan")
    diag(client, inv, "reachability", AB)
    from app.db import SessionLocal
    with SessionLocal() as s2:
        assert s2.get(m.Investigation, inv).status == "investigating"
        assert len(s2.scalars(select(m.EvidenceItem).where(m.EvidenceItem.investigation_id == inv)).all()) >= 5
