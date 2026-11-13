"""LinuxLabBackend — same workflow, real (isolated) Linux networking via the lab runner.

The FastAPI process stays unprivileged; it sends fixed-schema requests to the runner and
normalizes the real output into the same payload shapes that verification checks consume.
"""
from __future__ import annotations

from typing import Any

from ..config import settings
from ..domain.topology import Topology
from ..scenarios import Scenario
from ..services.catalog import ActionError
from ..sim.diagnostics import COLLECTORS, DiagnosticResult, SimContext
from ..sim.repairs import RepairResult
from . import parsers
from .client import RunnerClient

LAB_NOTE = "Collected from FiberScope-owned Linux network namespaces (veth pairs, VLAN-aware bridges). Virtual Ethernet does not exercise physical optics or fiber."
HOST_IP4 = {"srv-a": "192.0.2.11", "srv-b": "192.0.2.12", "gw-1": "192.0.2.1"}


def _raw(results: list[dict[str, Any]]) -> str:
    return "\n\n".join(f"$ {' '.join(r['argv'])}\n{r['stdout']}{r['stderr']}" for r in results)


class LinuxLabBackend:
    source_mode = "LINUX_LAB"

    def __init__(self, client: RunnerClient | None = None):
        self.client = client or RunnerClient()

    def initial_state(self, topo: Topology) -> dict[str, Any]:
        st = self.client.status()
        if not st.get("ready"):
            raise ActionError("lab_not_ready", "Lab runner reports the namespaces are not set up. Run the runner 'setup' command first.")
        self.client.call({"op": "restore_baseline"})
        return {"schema": "linux-lab", "faults": [], "note": "Live state lives in the lab namespaces."}

    def inject_fault(self, execution, scenario: Scenario, topo: Topology) -> list[str]:
        res = self.client.call({"op": "fault", "scenario": scenario.key})
        execution.state = {**execution.state, "faults": [*execution.state.get("faults", []), scenario.key]}
        return [res.get("description", scenario.key)]

    def reset(self, execution, topo: Topology) -> None:
        self.client.call({"op": "restore_baseline"})
        execution.state = {"schema": "linux-lab", "faults": []}

    def apply_repair(self, execution, topo, action, target, params) -> RepairResult:
        res = self.client.call({"op": "repair", "action": action, "target": target, "params": params})
        cmds = [" ".join(r["argv"]) for r in res.get("results", [])]
        return RepairResult(
            description=f"{action} on {next(iter(target.values()))}", command="\n".join(cmds),
            changed_resources=[str(v) for v in target.values()], outcome="state_changed" if res.get("ok") else "no_change",
            notes="" if res.get("ok") else "Runner reported a non-zero exit status.", raw_output=_raw(res.get("results", [])),
        )

    def run_diagnostic(self, session, execution, topo: Topology, action: str, target: dict, params: dict) -> DiagnosticResult:
        if action == "cable_trace":  # registry-only, identical in both modes
            r = COLLECTORS["cable_trace"](SimContext(topo=topo, model=None, optics_db={}, rng=None), target, params)  # type: ignore[arg-type]
            r.limitations.append("Linux lab: the real link between these endpoints is a veth pair.")
            return r
        res = self.client.call({"op": "diagnostic", "action": action, "target": target, "params": params})
        results = res.get("results", [])
        raw = _raw(results)
        out = results[0]["stdout"] if results else ""
        err = results[0]["stderr"] if results else ""
        payload: dict[str, Any] = {}
        verdict, interp, obs = "info", "", []
        if action == "reachability":
            payload = {**target, **params, "packet_bytes": params["payload_bytes"] + (28 if params["ip_version"] == 4 else 48), **parsers.parse_ping(out, err)}
            payload["count"] = params["count"]
            verdict = "ok" if payload["failure_mode"] == "none" else ("warning" if payload["failure_mode"] == "partial_loss" else "fail")
            interp = f"{payload['received']}/{payload['transmitted']} replies ({payload['loss_pct']:g}% loss). Failure mode: {payload['failure_mode']}."
            obs = [{"kind": "reachability", "id": f"{target['src']}->{target['dst']}", "status": {"ok": "up", "warning": "degraded"}.get(verdict, "down"), "label": f"{payload['loss_pct']:g}% loss"}]
        elif action == "interface_state":
            info = topo.ifaces[target["interface"]]
            payload = {"interface": target["interface"], "intended_mtu": info.intended_mtu, **parsers.parse_link(out)}
            verdict = "ok" if payload["oper_state"] == "up" else "fail"
            interp = f"admin {payload['admin_state']} / oper {payload['oper_state']}, MTU {payload['mtu']} (intended {info.intended_mtu})."
            obs = [{"kind": "interface", "id": target["interface"], "status": "up" if verdict == "ok" else ("admin_down" if payload["admin_state"] == "down" else "down"), "label": interp}]
        elif action == "interface_counters":
            payload = {"interface": target["interface"], **parsers.parse_link_stats(out)}
            interp = "Kernel interface counters (cumulative). netem drops appear in qdisc statistics, not interface errors."
        elif action == "vlan_membership":
            ports = parsers.parse_bridge_vlans(out) if target["device"].startswith("asw-") else {}
            rows, mismatches = [], []
            lab_names = {"asw-1": {"p1": "Ethernet1/1", "up": "Ethernet1/49", "gw": "Ethernet1/50"}, "asw-2": {"p1": "Ethernet1/1", "up": "Ethernet1/49"}}.get(target["device"], {})
            for dev, logical in lab_names.items():
                iid = f"{target['device']}:{logical}"
                info = topo.ifaces[iid]
                p = ports.get(dev, {"pvid": None, "tagged": []})
                row = {"interface": iid, "port": logical, "mode": info.switchport_mode,
                       "running_vlan": p["pvid"] if info.switchport_mode == "access" else None,
                       "running_allowed": p["tagged"] if info.switchport_mode == "trunk" else None,
                       "intended_vlan": info.intended_vlan, "intended_allowed": list(info.intended_allowed_vlans) if info.intended_allowed_vlans else None}
                row["matches_intent"] = row["running_vlan"] == row["intended_vlan"] and (row["running_allowed"] or None) == (row["intended_allowed"] or None)
                rows.append(row)
                if not row["matches_intent"]:
                    mismatches.append(row)
            payload = {"device": target["device"], "ports": rows, "mismatches": mismatches}
            verdict = "fail" if mismatches else "ok"
            interp = ("Mismatch vs intent: " + "; ".join(f"{r['port']} VLAN {r['running_vlan']}≠{r['intended_vlan']}" for r in mismatches)) if mismatches else "Bridge VLAN membership matches intent."
        elif action == "neighbor_table":
            payload = {"device": target["device"], "neighbors": parsers.parse_neigh(out)} if not target["device"].startswith("asw-") else {"device": target["device"], "fdb_raw": out[:4000]}
            interp = "Kernel neighbor table." if "neighbors" in payload else "Bridge forwarding database."
        elif action == "routing":
            payload = {"device": target["device"], "routes_raw": out[:4000]}
            interp = "Kernel routing table for the lab namespace."
        elif action == "throughput":
            payload = {**target, **params, **parsers.parse_iperf(out)}
            verdict = "ok" if payload.get("connected") and not payload.get("stalled") else "fail"
            interp = f"{payload.get('sender_gbps', 0):.2f} Gbit/s, {payload.get('retransmits')} retransmits (veth throughput reflects CPU, not optics)."
        elif action == "mtu_probe":
            overhead = 28 if params["ip_version"] == 4 else 48
            rs = []
            for size, r in zip(params["payload_sizes"], results):
                p = parsers.parse_ping(r["stdout"], r["stderr"])
                rs.append({"payload_bytes": size, "packet_bytes": size + overhead, "sent": p["transmitted"] or params["count"], "received": p["received"],
                           "outcome": "local_error" if p["failure_mode"] == "local_mtu" else ("pass" if p["failure_mode"] == "none" else ("partial" if p["received"] else "no_reply"))})
            payload = {**target, "ip_version": params["ip_version"], "dont_fragment": True, "overhead_bytes": overhead, "results": rs}
            verdict = "ok" if all(r["outcome"] == "pass" for r in rs) else "fail"
            interp = ", ".join(f"{r['payload_bytes']} B {r['outcome']}" for r in rs)
        elif action == "impairment_inspect":
            payload = {"interface": target["interface"], "rules": parsers.parse_qdisc(out)}
            verdict = "fail" if payload["rules"] else "ok"
            interp = f"{len(payload['rules'])} netem rule(s) present." if payload["rules"] else "No netem rules."
        timed_out = any(r.get("timed_out") for r in results)
        return DiagnosticResult(
            title=f"{action.replace('_', ' ').title()} — {' '.join(str(v) for v in target.values())} (Linux lab)",
            command=" ; ".join(" ".join(r["argv"]) for r in results), purpose=action, raw_output=raw, payload=payload,
            interpretation=interp, limitations=[LAB_NOTE] + (["Command hit its timeout; output may be partial."] if timed_out else []),
            observations=obs, verdict=verdict, source_id=f"lab:{target.get('device') or target.get('src') or target.get('interface')}",
            sim_duration_ms=0, status="partial" if timed_out else "completed",
        )


_BACKEND: LinuxLabBackend | None = None


def get_linux_lab_backend() -> LinuxLabBackend:
    global _BACKEND
    if not settings.linux_lab_enabled:
        raise ActionError("lab_disabled", "Linux lab mode is disabled. Set FIBERSCOPE_LINUX_LAB_ENABLED=1 and configure the runner token.")
    if _BACKEND is None:
        _BACKEND = LinuxLabBackend()
    return _BACKEND


def lab_status() -> dict[str, Any]:
    out: dict[str, Any] = {"enabled": settings.linux_lab_enabled, "runner_url": settings.lab_runner_url, "token_configured": bool(settings.lab_runner_token)}
    if not settings.linux_lab_enabled:
        out.update({"available": False, "reason": "Disabled (default). Simulation mode is fully functional without it."})
        return out
    try:
        st = RunnerClient().status()
        out.update({"available": bool(st.get("ready")), "runner": st, "reason": None if st.get("ready") else "Runner reachable but lab not set up."})
    except ActionError as exc:
        out.update({"available": False, "reason": exc.message})
    return out
