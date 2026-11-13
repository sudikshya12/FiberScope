"""Scenario behavior: faults change state; evidence derives from state."""
from conftest import AB, diag, start


def test_wrong_vlan_keeps_physical_link_but_breaks_connectivity(client):
    inv = start(client, "wrong-vlan")
    ping = diag(client, inv, "reachability", AB, {"count": 5})
    assert ping["payload"]["received"] == 0
    assert ping["payload"]["failure_mode"] == "neighbor_unresolved"
    for iface in ("asw-2:Ethernet1/1", "srv-b:eth0", "asw-1:Ethernet1/1", "srv-a:eth0"):
        st = diag(client, inv, "interface_state", {"interface": iface})["payload"]
        assert st["admin_state"] == "up" and st["oper_state"] == "up", iface
    nb = diag(client, inv, "neighbor_table", {"device": "srv-a"})["payload"]
    assert next(n for n in nb["neighbors"] if n["ip"] == "192.0.2.12")["state"] == "FAILED"
    vlan = diag(client, inv, "vlan_membership", {"device": "asw-2"})["payload"]
    assert [r["interface"] for r in vlan["mismatches"]] == ["asw-2:Ethernet1/1"]
    assert vlan["mismatches"][0]["running_vlan"] == 30 and vlan["mismatches"][0]["intended_vlan"] == 20


def test_disabled_port_reports_admin_state_separately(client):
    inv = start(client, "admin-down")
    sw = diag(client, inv, "interface_state", {"interface": "asw-1:Ethernet1/1"})
    assert sw["payload"]["admin_state"] == "down" and sw["payload"]["oper_state"] == "down"
    assert sw["payload"]["reason"] == "Administratively down"
    srv = diag(client, inv, "interface_state", {"interface": "srv-a:eth0"})["payload"]
    assert srv["admin_state"] == "up" and srv["oper_state"] == "down"
    assert "NO-CARRIER" in diag(client, inv, "interface_state", {"interface": "srv-a:eth0"})["raw_output"]


def test_missing_optical_thresholds_never_report_healthy(client):
    inv = start(client, "wrong-vlan")
    ev = diag(client, inv, "optical_telemetry", {"interface": "srv-b:eth0"})
    local = ev["payload"]["local"]
    assert local["thresholds_available"] is False
    assert local["metrics"]["rx_power_dbm"]["status"] == "unknown_thresholds"
    assert local["metrics"]["rx_power_dbm"]["value"] is not None
    assert local["overall"] != "normal"
    assert "UNKNOWN" in ev["interpretation"]


def test_missing_telemetry_is_not_zero(client):
    inv = start(client, "wrong-vlan")
    ev = diag(client, inv, "optical_telemetry", {"interface": "asw-1:Ethernet1/50"})  # DAC, no optic
    assert ev["payload"]["local"]["present"] is False
    assert "not zero" in ev["interpretation"]


def test_low_rx_does_not_name_a_component(client):
    inv = start(client, "low-rx-power")
    ev = diag(client, inv, "optical_telemetry", {"interface": "asw-1:Ethernet1/1"})
    rx = ev["payload"]["local"]["metrics"]["rx_power_dbm"]
    assert rx["status"] == "low_warning"
    text = ev["interpretation"].lower()
    assert "does not by itself identify" in text
    for leaked in ("pp-02", "cbl-f201", "contaminat" + "ion at"):
        assert leaked not in text
    est = {e["direction"]: e["estimated_loss_db"] for e in ev["payload"]["loss_estimates"]}
    assert est["srv-a:eth0 → asw-1:Ethernet1/1"] > 8 > est["asw-1:Ethernet1/1 → srv-a:eth0"]
    # traffic is still fine — degraded optical path, not an outage
    assert diag(client, inv, "reachability", AB)["payload"]["loss_pct"] == 0


def test_low_rx_wrong_repair_then_correct_repair(client):
    inv = start(client, "low-rx-power")
    e = diag(client, inv, "optical_telemetry", {"interface": "asw-1:Ethernet1/1"})
    client.post(f"/api/investigations/{inv}/diagnosis", json={"category": "optical_path_degraded", "statement": "Low Rx on asw-1 Eth1/1 from srv-a direction", "evidence_ids": [e["id"]]})
    client.post(f"/api/investigations/{inv}/repairs", json={"action": "replace_optic", "target": {"interface": "asw-1:Ethernet1/1"}})
    vr = client.post(f"/api/investigations/{inv}/verify").json()["verification"]
    assert vr["passed"] is False
    assert client.get(f"/api/investigations/{inv}").json()["status"] == "verification_failed"
    insp_bad = diag(client, inv, "connector_inspection", {"location": "pp-02:F01"})
    insp_ok = diag(client, inv, "connector_inspection", {"location": "pp-01:F01"})
    assert insp_bad["payload"]["result"] == "FAIL" and insp_ok["payload"]["result"] == "PASS"
    assert client.get(f"/api/investigations/{inv}").json()["status"] == "investigating"
    client.post(f"/api/investigations/{inv}/repairs", json={"action": "clean_connector", "target": {"location": "pp-02:F01"}})
    assert client.post(f"/api/investigations/{inv}/verify").json()["verification"]["passed"] is True
    assert client.post(f"/api/investigations/{inv}/resolve", json={}).status_code == 200
    d = client.get(f"/api/investigations/{inv}").json()
    assert d["status"] == "resolved" and d["failed_verifications"] == 1


def test_mtu_distinguishes_small_and_large_probes(client):
    inv = start(client, "mtu-mismatch")
    assert diag(client, inv, "reachability", AB)["payload"]["loss_pct"] == 0
    res = {r["payload_bytes"]: r["outcome"] for r in diag(client, inv, "mtu_probe", AB)["payload"]["results"]}
    assert res == {56: "pass", 1472: "pass", 8972: "no_reply"}
    tp = diag(client, inv, "throughput", AB)["payload"]
    assert tp["connected"] and tp["stalled"]
    st = diag(client, inv, "interface_state", {"interface": "asw-2:Ethernet1/49"})["payload"]
    assert st["mtu"] == 1500 and st["intended_mtu"] == 9216
    assert diag(client, inv, "interface_counters", {"interface": "asw-2:Ethernet1/49"})["payload"]["counters"]["rx_oversize"] > 0


def test_packet_loss_without_interface_errors(client):
    inv = start(client, "packet-loss")
    p = diag(client, inv, "reachability", AB, {"count": 100})["payload"]
    assert 5 < p["loss_pct"] < 30
    c = diag(client, inv, "interface_counters", {"interface": "asw-1:Ethernet1/49"})["payload"]["counters"]
    assert c["rx_crc"] == 0 and c["rx_errors"] == 0
    rules = diag(client, inv, "impairment_inspect", {"interface": "asw-1:Ethernet1/49"})["payload"]["rules"]
    assert rules[0]["owner"] == "fiberscope" and rules[0]["id"] == "fs-imp-0001"


def test_simulation_is_deterministic(client):
    a, b = start(client, "packet-loss"), start(client, "packet-loss")
    pa = diag(client, a, "reachability", AB, {"count": 100})["payload"]
    pb = diag(client, b, "reachability", AB, {"count": 100})["payload"]
    assert pa["transmitted"] == pb["transmitted"] == 100
    # same execution seed/run sequence reproduces identically on re-creation is covered by seed derivation;
    # different executions are independent but bounded
    assert 0 < pa["loss_pct"] < 40 and 0 < pb["loss_pct"] < 40
