"""Scenario catalog (versioned). Faults mutate simulation state; checks are scenario-specific.

Each scenario carries a JSON-serializable *definition* (stored in ``scenario_definitions``) plus
code hooks: ``inject`` (state mutation) and ``checks`` (verification criteria).
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

Step = tuple[str, dict[str, Any], dict[str, Any]]  # (action, target, params)
Evaluator = Callable[[list[dict[str, Any]], "BaselineLookup"], tuple[bool, str]]


class BaselineLookup:
    def __init__(self, items: list[dict[str, Any]]):
        self.items = items  # [{action, target, params, payload}]

    def find(self, action: str, target: dict[str, Any], params: dict[str, Any] | None = None) -> dict[str, Any] | None:
        for it in reversed(self.items):
            if it["action"] != action or it["target"] != target:
                continue
            if params is not None and any(it["params"].get(k) != v for k, v in params.items()):
                continue
            return it["payload"]
        return None


@dataclass
class Check:
    id: str
    label: str
    rationale: str
    steps: list[Step]
    evaluate: Evaluator

    def describe(self) -> dict[str, Any]:
        return {"id": self.id, "label": self.label, "rationale": self.rationale,
                "steps": [{"action": a, "target": t, "params": p} for a, t, p in self.steps]}


@dataclass
class Scenario:
    key: str
    version: int
    definition: dict[str, Any]
    inject: Callable[[dict[str, Any]], list[str]]
    checks: list[Check]
    baseline: list[Step]
    focus_interfaces: list[str] = field(default_factory=list)

    @property
    def id(self) -> str:
        return f"{self.key}@{self.version}"


# ----------------------------------------------------------------------------- evaluators

AB = {"src": "srv-a", "dst": "srv-b"}
BA = {"src": "srv-b", "dst": "srv-a"}
PING10 = {"count": 10, "payload_bytes": 56, "dont_fragment": False, "ip_version": 4}
PING100 = {"count": 100, "payload_bytes": 56, "dont_fragment": False, "ip_version": 4}
IPERF = {"duration_s": 10, "parallel": 1}
MTU_SIZES = {"payload_sizes": [56, 1472, 8972], "ip_version": 4, "count": 3}


def _zero_loss(payloads, _b):
    p = payloads[0]
    ok = p["received"] == p["transmitted"] and p["transmitted"] > 0
    return ok, f"{p['received']}/{p['transmitted']} replies ({p['loss_pct']:g}% loss) {p['src']}→{p['dst']}, {p['payload_bytes']} B"


def _both_zero_loss(payloads, _b):
    msgs, ok = [], True
    for p in payloads:
        good = p["received"] == p["transmitted"]
        ok &= good
        msgs.append(f"{p['src']}→{p['dst']}: {p['received']}/{p['transmitted']}")
    return ok, "; ".join(msgs)


def _throughput_vs_baseline(min_ratio: float) -> Evaluator:
    def ev(payloads, b: BaselineLookup):
        p = payloads[0]
        base = b.find("throughput", {"src": p["src"], "dst": p["dst"]}, {"duration_s": p["duration_s"], "parallel": p["parallel"]})
        if base is None or not base.get("sender_gbps"):
            return False, "No comparable baseline throughput run (same endpoints, duration and streams) — cannot verify."
        ratio = (p.get("sender_gbps") or 0) / base["sender_gbps"]
        return ratio >= min_ratio, (
            f"{p.get('sender_gbps', 0):.2f} Gbit/s vs baseline {base['sender_gbps']:.2f} Gbit/s "
            f"({ratio * 100:.0f}%, need ≥{min_ratio * 100:.0f}%; same params: {p['duration_s']} s, P{p['parallel']}, n=1 run each)"
        )
    return ev


def _vlan_matches(payloads, _b):
    msgs, ok = [], True
    for p in payloads:
        mm = p["mismatches"]
        ok &= not mm
        msgs.append(f"{p['device']}: " + ("matches intent" if not mm else ", ".join(f"{r['port']} VLAN {r['running_vlan']}≠{r['intended_vlan']}" for r in mm)))
    return ok, "; ".join(msgs)


def _neighbor_resolved(ip: str, mac: str) -> Evaluator:
    def ev(payloads, _b):
        nb = payloads[-1]
        ent = next((e for e in nb.get("neighbors", []) if e["ip"] == ip), None)
        if ent is None:
            return False, f"No neighbor entry for {ip}"
        ok = ent["state"] == "REACHABLE" and ent["mac"] == mac
        return ok, f"{ip} → {ent['mac'] or 'no MAC'} {ent['state']} (expected {mac} REACHABLE)"
    return ev


def _iface_up(*ifaces: str, need_admin=True) -> Evaluator:
    def ev(payloads, _b):
        msgs, ok = [], True
        for p in payloads:
            good = p["oper_state"] == "up" and (p["admin_state"] == "up" or not need_admin)
            ok &= good
            msgs.append(f"{p['interface']}: admin {p['admin_state']} / oper {p['oper_state']}")
        return ok, "; ".join(msgs)
    return ev


def _mtu_intended(payloads, _b):
    msgs, ok = [], True
    for p in payloads:
        good = p["intended_mtu"] is None or p["mtu"] == p["intended_mtu"]
        ok &= good and p["oper_state"] == "up"
        msgs.append(f"{p['interface']} MTU {p['mtu']}{'' if good else f' (intended {p['intended_mtu']})'}")
    return ok, "; ".join(msgs)


def _large_df_pass(payloads, _b):
    msgs, ok = [], True
    for p in payloads:
        res = {r["payload_bytes"]: r["outcome"] for r in p["results"]}
        good = all(o == "pass" for o in res.values())
        ok &= good
        msgs.append(f"{p['src']}→{p['dst']}: " + ", ".join(f"{s} B {o}" for s, o in sorted(res.items())))
    return ok, "; ".join(msgs)


def _rx_normal(payloads, _b):
    p = payloads[0]
    msgs, ok = [], True
    for side in (p["local"], p["remote"]):
        if not side or not side.get("present"):
            continue
        rx = side["metrics"]["rx_power_dbm"]
        if rx["status"] == "unknown_thresholds":
            msgs.append(f"{side['interface']} Rx {rx['value']} dBm (thresholds unknown — not counted as pass)")
            continue
        good = rx["status"] == "normal"
        ok &= good
        msgs.append(f"{side['interface']} Rx {rx['value']:.2f} dBm {rx['status']}")
    return ok, "; ".join(msgs)


def _loss_within_budget(margin_db: float) -> Evaluator:
    def ev(payloads, _b):
        p = payloads[0]
        budget = (p.get("planning_budget") or {}).get("estimated_budget_db")
        ests = p.get("loss_estimates") or []
        if budget is None or not ests:
            return False, "Paired Tx/Rx readings or planning budget unavailable — cannot estimate loss."
        worst = max(ests, key=lambda e: e["estimated_loss_db"])
        ok = worst["estimated_loss_db"] <= budget + margin_db
        return ok, f"worst direction {worst['direction']}: {worst['estimated_loss_db']:.2f} dB (estimate) vs budget {budget:.2f} dB + {margin_db} dB margin"
    return ev


def _loss_not_worse_than_baseline(payloads, b: BaselineLookup):
    p = payloads[0]
    base = b.find("reachability", {"src": p["src"], "dst": p["dst"]}, {"count": p["count"], "payload_bytes": p["payload_bytes"], "dont_fragment": p["dont_fragment"], "ip_version": p["ip_version"]})
    if base is None:
        return False, "No baseline probe run with identical parameters — comparison not possible."
    ok = p["loss_pct"] <= base["loss_pct"] and p["received"] > 0
    return ok, f"recovery {p['loss_pct']:g}% loss vs baseline {base['loss_pct']:g}% (same test: {p['count']} probes, {p['payload_bytes']} B, n={p['count']} samples each)"


def _no_impairment(payloads, _b):
    p = payloads[0]
    return not p["rules"], ("no impairment rules on " + p["interface"]) if not p["rules"] else f"{len(p['rules'])} rule(s) still present"


# ----------------------------------------------------------------------------- fault hooks


def _stale(state, *pairs):
    for dev, ip in pairs:
        ent = state["neighbors"].get(dev, {}).get(ip)
        if ent:
            ent["state"] = "STALE"


def inject_wrong_vlan(state):
    state["ifaces"]["asw-2:Ethernet1/1"]["vlan"] = 30
    _stale(state, ("srv-a", "192.0.2.12"), ("srv-b", "192.0.2.11"), ("srv-b", "192.0.2.1"), ("gw-1", "192.0.2.12"))
    return ["asw-2:Ethernet1/1"]


def inject_admin_down(state):
    state["ifaces"]["asw-1:Ethernet1/1"]["admin_up"] = False
    _stale(state, ("srv-b", "192.0.2.11"), ("gw-1", "192.0.2.11"), ("srv-a", "192.0.2.12"), ("srv-a", "192.0.2.1"))
    return ["asw-1:Ethernet1/1"]


def inject_low_rx(state):
    state["contamination"].append({
        "point": "pp-02:F01", "cable": "CBL-F201", "affects_rx_of": "asw-1:Ethernet1/1", "extra_loss_db": 8.4,
        "description": "End-face contamination on the srv-a→asw-1 fiber of CBL-F201 at PP-02 F01",
    })
    return ["connector:pp-02:F01"]


def inject_packet_loss(state):
    state["impairments"].append({"id": "fs-imp-0001", "owner": "fiberscope", "egress_iface": "asw-1:Ethernet1/49", "kind": "netem", "loss_pct": 15.0})
    return ["impairment:fs-imp-0001"]


def inject_mtu(state):
    state["ifaces"]["asw-2:Ethernet1/49"]["mtu"] = 1500
    return ["asw-2:Ethernet1/49"]


# ----------------------------------------------------------------------------- definitions

COMMON_RESET = "Reset restores this execution's state to the healthy baseline. Evidence already collected is preserved; other executions are untouched."

SCENARIOS: dict[str, Scenario] = {}


def _register(s: Scenario) -> None:
    s.definition["key"] = s.key
    s.definition["version"] = s.version
    s.definition["recovery_checks"] = [c.describe() for c in s.checks]
    s.definition["baseline_actions"] = [{"action": a, "target": t, "params": p} for a, t, p in s.baseline]
    SCENARIOS[s.key] = s


_register(Scenario(
    key="wrong-vlan", version=1,
    definition={
        "title": "Wrong VLAN on an access port",
        "short": "Link is up, but the server is unreachable.",
        "difficulty": "Foundational",
        "learning_objective": "Distinguish a Layer 2 configuration fault from a physical link failure using state, neighbor and VLAN evidence.",
        "symptom_report": "Application team: Server A cannot reach Server B (192.0.2.12). On-site check reports Server B's NIC link light is on.",
        "baseline": "Server A and Server B communicate over VLAN 20 (APP-DATA) through asw-1 → uplink → asw-2.",
        "fault_mutation": "One access port's VLAN membership is changed from the intended VLAN 20 to VLAN 30.",
        "observable_symptoms": [
            "Physical link remains up at both ends",
            "ICMP to the peer fails with 'Destination Host Unreachable'",
            "ARP for the peer fails (neighbor FAILED)",
            "VLAN evidence shows a running/intended mismatch",
        ],
        "available_tests": ["reachability", "interface_state", "neighbor_table", "vlan_membership", "routing", "interface_counters", "cable_trace", "throughput"],
        "expected_evidence": [
            "interface_state: admin up / oper up on the server-facing ports",
            "neighbor_table on srv-a: 192.0.2.12 FAILED",
            "vlan_membership on asw-2: Ethernet1/1 VLAN 30 ≠ intended 20",
        ],
        "alternative_causes": [
            "Physical link failure (ruled out: link up at both ends)",
            "Peer host down or its firewall dropping ICMP (ARP would still resolve)",
            "Trunk not carrying VLAN 20 on the uplink",
            "Duplicate IP / wrong host addressing",
        ],
        "corrective_action": "Restore asw-2 Ethernet1/1 to access VLAN 20 (change only that port).",
        "reset_behavior": COMMON_RESET,
        "modes": ["SIMULATED", "LINUX_LAB"],
        "diagnosis_category": "l2_vlan",
        "hints": [
            "Start from the symptom: run reachability Server A → Server B.",
            "Before touching cables, read interface state at both server-facing switch ports — is the link really down?",
            "Link is up but ARP fails. Read Server A's neighbor table.",
            "Compare running VLAN membership with intent on both access switches.",
            "Record the diagnosis citing the VLAN evidence, then restore only the mismatched port.",
            "Verify: VLAN config, neighbor resolution, both directions, and a throughput check against baseline.",
        ],
        "focus": {"src": "srv-a", "dst": "srv-b"},
    },
    inject=inject_wrong_vlan,
    baseline=[
        ("reachability", AB, PING10), ("reachability", BA, PING10), ("throughput", AB, IPERF),
        ("vlan_membership", {"device": "asw-2"}, {}), ("interface_state", {"interface": "asw-2:Ethernet1/1"}, {}),
    ],
    checks=[
        Check("vlan_config", "Intended VLAN configuration restored", "Running VLAN membership on both access switches matches documented intent.",
              [("vlan_membership", {"device": "asw-1"}, {}), ("vlan_membership", {"device": "asw-2"}, {})], _vlan_matches),
        Check("neighbor", "Neighbor resolution", "Server A resolves Server B's MAC (after a probe refreshes ARP).",
              [("reachability", AB, {**PING10, "count": 3}), ("neighbor_table", {"device": "srv-a"}, {})], _neighbor_resolved("192.0.2.12", "02:00:5e:10:00:12")),
        Check("bidirectional", "Bidirectional connectivity", "10/10 probes in each direction.",
              [("reachability", AB, PING10), ("reachability", BA, PING10)], _both_zero_loss),
        Check("throughput", "Application-level throughput", "Bounded TCP test reaches ≥90% of the identical baseline run.",
              [("throughput", AB, IPERF)], _throughput_vs_baseline(0.9)),
    ],
    focus_interfaces=["asw-2:Ethernet1/1", "srv-b:eth0"],
))

_register(Scenario(
    key="admin-down", version=1,
    definition={
        "title": "Administratively disabled port",
        "short": "A switch port was shut down; the server lost its link.",
        "difficulty": "Foundational",
        "learning_objective": "Interpret administrative vs operational state, and avoid replacing healthy optics/cables for a configuration shutdown.",
        "symptom_report": "Server A lost connectivity to the application network after a maintenance window. The server reports eth0 'NO-CARRIER'.",
        "baseline": "Server A eth0 ↔ asw-1 Ethernet1/1 link is up; both servers communicate.",
        "fault_mutation": "asw-1 Ethernet1/1 is administratively disabled (shutdown).",
        "observable_symptoms": [
            "Server A eth0: NO-CARRIER / link down",
            "Optical: Server A receiver reports loss of signal (switch laser off)",
            "asw-1 Ethernet1/1: admin down, oper down (Administratively down)",
        ],
        "available_tests": ["reachability", "interface_state", "optical_telemetry", "interface_counters", "cable_trace", "neighbor_table"],
        "expected_evidence": ["interface_state asw-1:Ethernet1/1 → admin down", "interface_state srv-a:eth0 → admin up, oper down (no carrier)"],
        "alternative_causes": ["Broken/disconnected patch cord", "Failed optic at either end", "Port err-disabled by a protection feature", "Server NIC disabled"],
        "corrective_action": "Enable only asw-1 Ethernet1/1 (after confirming the shutdown was not intentional).",
        "reset_behavior": COMMON_RESET,
        "modes": ["SIMULATED", "LINUX_LAB"],
        "diagnosis_category": "admin_state",
        "hints": [
            "Run reachability from Server A — what kind of failure is it?",
            "Read Server A eth0 state: admin vs operational.",
            "Read the far end (asw-1 Ethernet1/1). Which side is configured down?",
            "Optional: optical telemetry shows LOS at Server A — explain why that does not mean a bad fiber.",
            "Enable only the affected port, then verify admin, oper and endpoint connectivity.",
        ],
        "focus": {"src": "srv-a", "dst": "srv-b"},
    },
    inject=inject_admin_down,
    baseline=[("reachability", AB, PING10), ("interface_state", {"interface": "asw-1:Ethernet1/1"}, {}), ("interface_state", {"interface": "srv-a:eth0"}, {})],
    checks=[
        Check("admin_oper", "Administrative and operational state", "Switch port admin up and oper up; server NIC has carrier.",
              [("interface_state", {"interface": "asw-1:Ethernet1/1"}, {}), ("interface_state", {"interface": "srv-a:eth0"}, {})], _iface_up()),
        Check("endpoints", "Endpoint connectivity", "Server A reaches Server B and the gateway, 10/10 each.",
              [("reachability", AB, PING10), ("reachability", {"src": "srv-a", "dst": "gw-1"}, PING10)], _both_zero_loss),
    ],
    focus_interfaces=["asw-1:Ethernet1/1", "srv-a:eth0"],
))

_register(Scenario(
    key="low-rx-power", version=1,
    definition={
        "title": "Low optical receive power",
        "short": "DOM warning on a switch receiver; link still up.",
        "difficulty": "Intermediate",
        "learning_objective": "Interpret low Rx power as evidence of a degraded optical path — not proof of a specific failed part — and gather the next evidence systematically.",
        "symptom_report": "Monitoring: DOM low-warning on asw-1 Ethernet1/1 receive power. No user-facing outage reported yet.",
        "baseline": "Server A ↔ asw-1 Ethernet1/1 optical path (CBL-F101 → PP-01 → TRK-0102 P1 → PP-02 → CBL-F201) with normal Rx at both ends.",
        "fault_mutation": "Excess loss is introduced at one mated connection point on one fiber of the duplex path (modeled contamination). The location is hidden.",
        "observable_symptoms": [
            "asw-1 Ethernet1/1 Rx power below the module's low-warning threshold",
            "Link remains up; traffic may be unaffected for now",
            "Reverse direction (Server A Rx) normal",
        ],
        "available_tests": ["optical_telemetry", "cable_trace", "connector_inspection", "interface_state", "interface_counters", "reachability", "throughput"],
        "expected_evidence": [
            "optical_telemetry: low Rx at asw-1 Eth1/1, normal Tx at srv-a eth0, normal Rx at srv-a",
            "Directional loss estimate well above the documented planning budget",
            "cable_trace listing every mated point",
            "connector_inspection FAIL at the affected point",
        ],
        "alternative_causes": [
            "Contaminated connector at a mated pair",
            "Excessive path loss (macro-bend, damaged cord, poor mated pair)",
            "Weak remote transmitter (check remote Tx)",
            "Incorrect optical component (fiber type or optic mismatch)",
            "DOM sensor error (compare with remote readings and trend)",
        ],
        "corrective_action": "Inspect each mated point with a fiber scope; clean (or replace the cord) only where inspection fails; re-inspect; re-read optics.",
        "reset_behavior": COMMON_RESET,
        "modes": ["SIMULATED"],
        "diagnosis_category": "optical_path_degraded",
        "safety": "Never look into a fiber connector or port. Do not create faults by bending or damaging fiber. Use an inspection probe.",
        "hints": [
            "Read optical telemetry on asw-1 Ethernet1/1 — it reads both ends of the link.",
            "Is the remote transmitter (Server A) sending normal power? Is the reverse direction healthy?",
            "Compare estimated loss with the documented planning budget. Low Rx ≠ a specific failed part.",
            "Trace the documented cable path to list each mated point.",
            "Inspect connectors with the scope, point by point. Clean only what fails inspection.",
            "Verify: Rx within thresholds at both ends, loss back near budget, link up, traffic healthy.",
        ],
        "focus": {"src": "srv-a", "dst": "srv-b"},
    },
    inject=inject_low_rx,
    baseline=[("optical_telemetry", {"interface": "asw-1:Ethernet1/1"}, {}), ("reachability", AB, PING10), ("throughput", AB, IPERF)],
    checks=[
        Check("rx_thresholds", "Rx power within module thresholds", "Both ends of the link report Rx inside their own thresholds (unknown thresholds never count as pass).",
              [("optical_telemetry", {"interface": "asw-1:Ethernet1/1"}, {})], _rx_normal),
        Check("loss_budget", "Estimated loss near planning budget", "Directional loss estimate ≤ documented budget + 1.5 dB.",
              [("optical_telemetry", {"interface": "asw-1:Ethernet1/1"}, {})], _loss_within_budget(1.5)),
        Check("link", "Link state", "Both ends admin/oper up.",
              [("interface_state", {"interface": "asw-1:Ethernet1/1"}, {}), ("interface_state", {"interface": "srv-a:eth0"}, {})], _iface_up()),
        Check("traffic", "Endpoint reachability", "10/10 probes Server A → Server B.",
              [("reachability", AB, PING10)], _zero_loss),
        Check("throughput", "Throughput vs baseline", "Identical bounded TCP test ≥90% of baseline.",
              [("throughput", AB, IPERF)], _throughput_vs_baseline(0.9)),
    ],
    focus_interfaces=["asw-1:Ethernet1/1", "srv-a:eth0"],
))

_register(Scenario(
    key="packet-loss", version=1,
    definition={
        "title": "Packet loss on a lab link",
        "short": "Intermittent timeouts and slow transfers.",
        "difficulty": "Intermediate",
        "learning_objective": "Quantify loss with comparable probes, locate it, and distinguish software-induced loss from interface errors.",
        "symptom_report": "Users report intermittent timeouts and slow transfers between Server A and Server B.",
        "baseline": "100-probe ping Server A → Server B with 0% loss; bounded throughput near line rate.",
        "fault_mutation": "A FiberScope-owned netem rule drops ~15% of packets on one switch uplink egress.",
        "observable_symptoms": ["Partial ping loss", "Throughput collapse with retransmissions", "Interface error counters remain clean"],
        "available_tests": ["reachability", "throughput", "interface_counters", "impairment_inspect", "interface_state", "cable_trace"],
        "expected_evidence": ["reachability: ~15% loss over 100 probes", "interface_counters: no CRC/errors", "impairment_inspect: owned netem rule on asw-1 Ethernet1/49"],
        "alternative_causes": ["Physical-layer errors (would show CRC/FCS counters)", "Congestion / oversubscription", "Duplex or speed mismatch", "Faulty optic or cable"],
        "corrective_action": "Remove only the FiberScope-owned impairment rule (ownership verified).",
        "reset_behavior": COMMON_RESET,
        "modes": ["SIMULATED", "LINUX_LAB"],
        "diagnosis_category": "packet_loss_impairment",
        "note": "Software-injected loss does not produce physical CRC errors.",
        "hints": [
            "Quantify: run a 100-probe reachability test with the same parameters as baseline.",
            "Measure impact with a bounded throughput test and compare to baseline.",
            "Check counters on each hop — are there CRC errors or discards?",
            "Clean counters + loss → look at queueing/impairment rules on the uplink.",
            "Remove only the owned rule; re-run the identical 100-probe test.",
        ],
        "focus": {"src": "srv-a", "dst": "srv-b"},
    },
    inject=inject_packet_loss,
    baseline=[("reachability", AB, PING100), ("throughput", AB, IPERF), ("interface_counters", {"interface": "asw-1:Ethernet1/49"}, {})],
    checks=[
        Check("impairment_removed", "Impairment rule removed", "No owned impairment rules remain on the uplink.",
              [("impairment_inspect", {"interface": "asw-1:Ethernet1/49"}, {})], _no_impairment),
        Check("loss_vs_baseline", "Loss vs baseline (identical test)", "100 probes, 56 B — loss not worse than the baseline run.",
              [("reachability", AB, PING100)], _loss_not_worse_than_baseline),
        Check("throughput", "Throughput vs baseline", "Identical bounded TCP test ≥90% of baseline.",
              [("throughput", AB, IPERF)], _throughput_vs_baseline(0.9)),
    ],
    focus_interfaces=["asw-1:Ethernet1/49"],
))

_register(Scenario(
    key="mtu-mismatch", version=1,
    definition={
        "title": "MTU mismatch",
        "short": "Ping works; bulk transfers hang.",
        "difficulty": "Intermediate",
        "learning_objective": "Explain why a successful default ping does not prove all traffic works, and locate an MTU mismatch with DF probes.",
        "symptom_report": "After a change window, ping from Server A to Server B works, but bulk transfers hang.",
        "baseline": "Jumbo path: hosts MTU 9000, switch ports MTU 9216. 8972-byte DF probes pass end-to-end.",
        "fault_mutation": "One segment on the path is set to MTU 1500.",
        "observable_symptoms": ["Default 56-byte ping succeeds", "1472-byte DF probe passes, 8972-byte DF probe fails", "TCP connects but transfer stalls", "Oversize drops on one port"],
        "available_tests": ["reachability", "mtu_probe", "throughput", "interface_state", "interface_counters", "cable_trace"],
        "expected_evidence": ["mtu_probe: 1500 B packets pass, 9000 B fail", "interface_state asw-2:Ethernet1/49 MTU 1500 (intended 9216)", "interface_counters: oversize drops"],
        "alternative_causes": ["Firewall blocking large ICMP", "PMTUD black hole on a routed hop", "Host MTU misconfiguration", "Application issue"],
        "corrective_action": "Restore the intended MTU (9216) on the mismatched interface only.",
        "reset_behavior": COMMON_RESET,
        "modes": ["SIMULATED", "LINUX_LAB"],
        "diagnosis_category": "mtu_mismatch",
        "hints": [
            "Confirm the report: default ping works. Then run a bounded throughput test.",
            "Run the MTU probe with 56, 1472 and 8972-byte DF payloads.",
            "Read interface state (MTU) on each hop of the path; compare with intended MTU.",
            "Counters on the suspect port should show oversize drops.",
            "Restore the intended MTU on only that interface; repeat the same small and large probes.",
        ],
        "focus": {"src": "srv-a", "dst": "srv-b"},
    },
    inject=inject_mtu,
    baseline=[("reachability", AB, PING10), ("mtu_probe", AB, MTU_SIZES), ("throughput", AB, IPERF)],
    checks=[
        Check("small_probe", "Small packets", "Default-size probes still pass (10/10).",
              [("reachability", AB, {**PING10, "dont_fragment": True})], _zero_loss),
        Check("large_probe", "Large DF packets, both directions", "56, 1472 and 8972-byte DF probes pass both ways.",
              [("mtu_probe", AB, MTU_SIZES), ("mtu_probe", BA, MTU_SIZES)], _large_df_pass),
        Check("mtu_config", "MTU matches intent on every hop", "All data-path interfaces run their documented MTU.",
              [("interface_state", {"interface": i}, {}) for i in ("srv-a:eth0", "asw-1:Ethernet1/1", "asw-1:Ethernet1/49", "asw-2:Ethernet1/49", "asw-2:Ethernet1/1", "srv-b:eth0")], _mtu_intended),
        Check("throughput", "Throughput vs baseline", "Identical bounded TCP test ≥90% of baseline.",
              [("throughput", AB, IPERF)], _throughput_vs_baseline(0.9)),
    ],
    focus_interfaces=["asw-2:Ethernet1/49"],
))

DIAGNOSIS_CATEGORIES = {
    "physical_link": "Physical link / cabling failure",
    "admin_state": "Interface administratively disabled",
    "l2_vlan": "Layer 2 VLAN misconfiguration",
    "optical_path_degraded": "Degraded optical path (low Rx power)",
    "packet_loss_impairment": "Packet loss on a link",
    "mtu_mismatch": "MTU mismatch on the path",
    "host_issue": "Endpoint/host issue",
    "other": "Other / undetermined",
}


def get_scenario(key: str) -> Scenario:
    if key not in SCENARIOS:
        raise KeyError(key)
    return SCENARIOS[key]
