"""Simulated repair executors. Each repair touches only its explicitly targeted resource."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..domain.topology import Topology
from ..services.catalog import ActionError
from .diagnostics import LAB_IFNAMES, inspection_points
from .network import NetworkModel


@dataclass
class RepairResult:
    description: str
    command: str
    changed_resources: list[str]
    outcome: str  # state_changed | no_change
    notes: str
    raw_output: str
    observations: list[dict[str, Any]] = field(default_factory=list)
    sim_duration_ms: int = 2000


def _switch_port(topo: Topology, iid: str, modes: tuple[str, ...]) -> None:
    if iid not in topo.ifaces:
        raise ActionError("invalid_target", f"Unknown interface '{iid}'.")
    info = topo.ifaces[iid]
    if topo.is_passive(iid):
        raise ActionError("invalid_target", f"{iid} is a passive patch-panel port; it has no configuration.")
    if info.kind == "mgmt":
        raise ActionError("invalid_target", "Management interfaces are out of scope for lab repairs.")
    if modes and info.switchport_mode not in modes:
        raise ActionError("invalid_target", f"{iid} is not a {'/'.join(modes)} port.")


def set_access_vlan(topo: Topology, m: NetworkModel, target: dict, params: dict) -> RepairResult:
    iid, vlan = target["interface"], params["vlan"]
    _switch_port(topo, iid, ("access",))
    if vlan not in (20, 30):
        raise ActionError("invalid_params", f"VLAN {vlan} is not defined in North Lab Fabric.")
    st = m.iface_state(iid)
    before = st["vlan"]
    st["vlan"] = vlan
    name = topo.ifaces[iid].name
    cmd = f"configure terminal\n interface {name}\n  switchport access vlan {vlan}\n end"
    changed = [iid] if before != vlan else []
    return RepairResult(
        description=f"Set access VLAN on {iid}: {before} → {vlan}",
        command=cmd, changed_resources=changed, outcome="state_changed" if changed else "no_change",
        notes="" if changed else f"{iid} was already in VLAN {vlan}.",
        raw_output=f"{topo.ifaces[iid].device_id}(config-if)# switchport access vlan {vlan}\n% Configuration applied (simulated)",
    )


def enable_interface(topo: Topology, m: NetworkModel, target: dict, params: dict) -> RepairResult:
    iid = target["interface"]
    _switch_port(topo, iid, ())
    st = m.iface_state(iid)
    was = st["admin_up"]
    st["admin_up"] = True
    info = topo.ifaces[iid]
    if topo.devices[info.device_id]["role"] == "server":
        cmd = f"ip link set dev {info.name} up"
    else:
        cmd = f"configure terminal\n interface {info.name}\n  no shutdown\n end"
    return RepairResult(
        description=f"Administratively enable {iid}", command=cmd,
        changed_resources=[] if was else [iid], outcome="no_change" if was else "state_changed",
        notes="Interface was already administratively up." if was else "",
        raw_output=f"{info.device_id}: {info.name} admin state → up (simulated)",
    )


def remove_impairment(topo: Topology, m: NetworkModel, target: dict, params: dict) -> RepairResult:
    imp_id = target["impairment_id"]
    rules = [i for i in m.state["impairments"] if i["id"] == imp_id]
    if not rules:
        raise ActionError("not_found", f"No impairment rule '{imp_id}' exists in this simulation.")
    rule = rules[0]
    if rule.get("owner") != "fiberscope":
        raise ActionError("not_owned", f"Impairment '{imp_id}' is not owned by FiberScope; refusing to modify it.")
    m.state["impairments"] = [i for i in m.state["impairments"] if i["id"] != imp_id]
    lab_if = LAB_IFNAMES.get(rule["egress_iface"], rule["egress_iface"])
    return RepairResult(
        description=f"Removed owned impairment {imp_id} ({rule['loss_pct']:g}% loss) from {rule['egress_iface']}",
        command=f"tc qdisc del dev {lab_if} root   # after verifying owner=fiberscope id={imp_id}",
        changed_resources=[f"impairment:{imp_id}"], outcome="state_changed", notes="",
        raw_output=f"ownership verified (owner=fiberscope)\nqdisc netem removed from {lab_if} (simulated)",
    )


def set_mtu(topo: Topology, m: NetworkModel, target: dict, params: dict) -> RepairResult:
    iid, mtu = target["interface"], params["mtu"]
    _switch_port(topo, iid, ())
    st = m.iface_state(iid)
    before = st["mtu"]
    st["mtu"] = mtu
    info = topo.ifaces[iid]
    cmd = (f"ip link set dev {info.name} mtu {mtu}" if topo.devices[info.device_id]["role"] == "server"
           else f"configure terminal\n interface {info.name}\n  mtu {mtu}\n end")
    note = ""
    if info.intended_mtu and mtu != info.intended_mtu:
        note = f"Warning: {mtu} differs from the documented intended MTU {info.intended_mtu}."
    return RepairResult(
        description=f"Set MTU on {iid}: {before} → {mtu}", command=cmd,
        changed_resources=[iid] if before != mtu else [], outcome="state_changed" if before != mtu else "no_change",
        notes=note, raw_output=f"{info.device_id}: {info.name} mtu {before} → {mtu} (simulated)",
    )


def clean_connector(topo: Topology, m: NetworkModel, target: dict, params: dict) -> RepairResult:
    loc = target["location"]
    if loc not in inspection_points(topo):
        raise ActionError("invalid_target", f"'{loc}' is not a documented fiber connection point.")
    dirty = [c for c in m.state["contamination"] if c["point"] == loc]
    m.state["contamination"] = [c for c in m.state["contamination"] if c["point"] != loc]
    cable = topo.cable_at.get(loc, ("?",))[0]
    return RepairResult(
        description=f"Inspect–clean–reinspect at {loc} ({cable})",
        command=f"field-procedure clean --location {loc}   # recorded step",
        changed_resources=[f"connector:{loc}"] if dirty else [], outcome="state_changed" if dirty else "no_change",
        notes="Post-clean inspection: PASS." if dirty else "Connector was already clean; no change to the optical path expected.",
        raw_output=f"Pre-clean inspection: {'FAIL' if dirty else 'PASS'}\nCleaned with approved one-click/lint-free method (recorded)\nPost-clean inspection: PASS",
        observations=[{"kind": "mated_point", "id": loc, "status": "up", "label": "cleaned, scope PASS"}],
        sim_duration_ms=300_000,
    )


def replace_patch_cable(topo: Topology, m: NetworkModel, target: dict, params: dict) -> RepairResult:
    cid = target["cable_id"]
    cable = topo.cables.get(cid)
    if cable is None:
        raise ActionError("invalid_target", f"Unknown cable '{cid}'.")
    if cable.kind == "trunk_pair":
        raise ActionError("invalid_target", f"{cid} is a structured trunk segment; trunk replacement is an escalation, not a technician swap.")
    ends = {cable.a, cable.b}
    fixed = [c for c in m.state["contamination"] if c.get("cable") == cid and c["point"] in ends]
    m.state["contamination"] = [c for c in m.state["contamination"] if c not in fixed]
    return RepairResult(
        description=f"Replaced patch cable {cid} with like-for-like spare",
        command=f"field-procedure replace-cable --id {cid}   # recorded step; new cord inspected before insertion",
        changed_resources=[f"cable:{cid}"], outcome="state_changed",
        notes="Replacement removes any defect on the old cord's connectors." if fixed else "The replaced cord was not the source of the observed condition (no change to readings expected).",
        raw_output=f"Old cord {cid} removed and tagged for inspection\nNew cord inspected (PASS) and installed\nLabels re-applied at both ends (recorded)",
        sim_duration_ms=600_000,
    )


def replace_optic(topo: Topology, m: NetworkModel, target: dict, params: dict) -> RepairResult:
    iid = target["interface"]
    if iid not in m.state["optics"]:
        raise ActionError("invalid_target", f"{iid} has no pluggable optic recorded.")
    m.state["optics"][iid]["module_replacements"] = m.state["optics"][iid].get("module_replacements", 0) + 1
    return RepairResult(
        description=f"Replaced optic in {iid} with like-for-like spare",
        command=f"field-procedure replace-optic --port {iid}   # recorded step",
        changed_resources=[f"optic:{iid}"], outcome="state_changed",
        notes="Module swapped. Whether this changes readings depends on whether the module was the cause.",
        raw_output=f"Optic removed from {iid}; spare inserted; DOM readable (simulated)",
        sim_duration_ms=300_000,
    )


REPAIRS = {
    "set_access_vlan": set_access_vlan,
    "enable_interface": enable_interface,
    "remove_impairment": remove_impairment,
    "set_mtu": set_mtu,
    "clean_connector": clean_connector,
    "replace_patch_cable": replace_patch_cable,
    "replace_optic": replace_optic,
}
