#!/usr/bin/env python3
"""FiberScope Linux lab runner — the ONLY privileged component.

Creates an isolated lab of Linux network namespaces + veth pairs + VLAN-aware bridges and
executes a *fixed, allowlisted* set of actions against those owned resources.

Safety properties
-----------------
* Explicit activation: requires Linux, root, env FIBERSCOPE_LAB_ENABLE=1 AND a CLI flag.
* Never touches the host's interfaces, default route, DNS or firewall: every command runs
  inside a ``fslab-*`` namespace (``ip -n <ns>`` / ``ip netns exec <ns>``); veth pairs are
  created directly inside lab namespaces (no root-namespace interfaces are created).
* Ownership: namespaces are recorded in a state file and every lab link carries the alias
  ``fiberscope-owned``. Mutations verify ownership first; teardown deletes only recorded
  ``fslab-*`` namespaces.
* No shell: commands are argv lists built from templates (``shell=False``). Request
  parameters are validated against fixed schemas; free-form strings are never executed.
* Bounded: per-action timeouts, output truncation, probe-count/duration limits.
* Narrow channel: HTTP on 127.0.0.1 only, bearer token (file mode 0600), constant-time
  comparison, 8 KiB request limit, JSONL audit log.

Usage (inside a dedicated Linux VM):
    sudo FIBERSCOPE_LAB_ENABLE=1 python3 fiberscope_labrunner.py check
    sudo FIBERSCOPE_LAB_ENABLE=1 python3 fiberscope_labrunner.py setup --i-understand
    sudo FIBERSCOPE_LAB_ENABLE=1 python3 fiberscope_labrunner.py serve --token-file /etc/fiberscope-lab/token --i-understand
    sudo FIBERSCOPE_LAB_ENABLE=1 python3 fiberscope_labrunner.py teardown --i-understand
"""
from __future__ import annotations

import argparse
import hmac
import ipaddress
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

PREFIX = "fslab-"
OWNER_ALIAS = "fiberscope-owned"
STATE_DIR = Path(os.environ.get("FIBERSCOPE_LAB_STATE_DIR", "/run/fiberscope-lab"))
AUDIT_LOG = Path(os.environ.get("FIBERSCOPE_LAB_AUDIT_LOG", "/var/log/fiberscope-lab/audit.jsonl"))
MAX_OUTPUT = 64 * 1024
MAX_REQUEST = 8 * 1024

NAMESPACES = ("fslab-srva", "fslab-srvb", "fslab-sw1", "fslab-sw2", "fslab-gw")

# logical interface id (as used by the FiberScope UI) -> (namespace, device name)
IFACE_MAP: dict[str, tuple[str, str]] = {
    "srv-a:eth0": ("fslab-srva", "eth0"),
    "srv-b:eth0": ("fslab-srvb", "eth0"),
    "asw-1:Ethernet1/1": ("fslab-sw1", "p1"),
    "asw-1:Ethernet1/49": ("fslab-sw1", "up"),
    "asw-1:Ethernet1/50": ("fslab-sw1", "gw"),
    "asw-2:Ethernet1/1": ("fslab-sw2", "p1"),
    "asw-2:Ethernet1/49": ("fslab-sw2", "up"),
    "gw-1:xe-0/0/0": ("fslab-gw", "xe0"),
}
DEVICE_NS = {"srv-a": "fslab-srva", "srv-b": "fslab-srvb", "asw-1": "fslab-sw1", "asw-2": "fslab-sw2", "gw-1": "fslab-gw"}
HOST_IP4 = {"srv-a": "192.0.2.11", "srv-b": "192.0.2.12", "gw-1": "192.0.2.1"}
HOST_IP6 = {"srv-a": "2001:db8:20::11", "srv-b": "2001:db8:20::12", "gw-1": "2001:db8:20::1"}
ACCESS_PORTS = {"asw-1:Ethernet1/1", "asw-2:Ethernet1/1"}
LAB_VLANS = {20, 30}

# veth pairs: (ns_a, dev_a, ns_b, dev_b)
LINKS = [
    ("fslab-srva", "eth0", "fslab-sw1", "p1"),
    ("fslab-sw1", "up", "fslab-sw2", "up"),
    ("fslab-sw2", "p1", "fslab-srvb", "eth0"),
    ("fslab-sw1", "gw", "fslab-gw", "xe0"),
]

FAULTS = {
    "wrong-vlan": "asw-2:Ethernet1/1 access VLAN 20 → 30",
    "admin-down": "asw-1:Ethernet1/1 administratively down",
    "packet-loss": "netem 15% loss on asw-1:Ethernet1/49 egress (impairment fs-imp-0001)",
    "mtu-mismatch": "asw-2:Ethernet1/49 MTU 9216 → 1500",
}
DIAG_ACTIONS = ("reachability", "interface_state", "interface_counters", "vlan_membership", "neighbor_table",
                "routing", "throughput", "mtu_probe", "impairment_inspect")
REPAIR_ACTIONS = ("set_access_vlan", "enable_interface", "remove_impairment", "set_mtu")


class LabError(Exception):
    def __init__(self, code: str, message: str, http: int = 400):
        super().__init__(message)
        self.code, self.message, self.http = code, message, http


# --------------------------------------------------------------------------- execution


@dataclass
class CmdResult:
    argv: list[str]
    rc: int
    stdout: str
    stderr: str
    duration_s: float
    timed_out: bool = False


def run_argv(argv: list[str], timeout: float, check: bool = False) -> CmdResult:
    """Run an argv list (never a shell string) with a hard timeout and bounded output."""
    if not isinstance(argv, list) or not all(isinstance(a, str) for a in argv):
        raise LabError("internal", "argv must be a list of strings")
    if any("\x00" in a for a in argv):
        raise LabError("internal", "NUL byte in argv")
    t0 = time.monotonic()
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, shell=False,
                           env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"})
        res = CmdResult(argv, p.returncode, p.stdout[:MAX_OUTPUT], p.stderr[:MAX_OUTPUT], round(time.monotonic() - t0, 3))
    except subprocess.TimeoutExpired as exc:
        out = (exc.stdout or b"")
        out = out.decode(errors="replace") if isinstance(out, bytes) else out
        res = CmdResult(argv, -1, out[:MAX_OUTPUT], f"timed out after {timeout}s", round(time.monotonic() - t0, 3), True)
    audit({"event": "exec", "argv": argv, "rc": res.rc, "duration_s": res.duration_s, "timed_out": res.timed_out})
    if check and res.rc != 0:
        raise LabError("command_failed", f"{' '.join(argv)} failed: {res.stderr.strip()[:300]}", 500)
    return res


def audit(record: dict[str, Any]) -> None:
    try:
        AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
        with AUDIT_LOG.open("a") as fh:
            fh.write(json.dumps({"ts": time.time(), **record}) + "\n")
    except OSError:
        pass  # auditing must never crash the runner (e.g. in unit tests)


def ns_ip(ns: str, *args: str) -> list[str]:
    _assert_lab_ns(ns)
    return ["ip", "-n", ns, *args]


def ns_exec(ns: str, *args: str) -> list[str]:
    _assert_lab_ns(ns)
    return ["ip", "netns", "exec", ns, *args]


def _assert_lab_ns(ns: str) -> None:
    if ns not in NAMESPACES:
        raise LabError("not_owned", f"namespace {ns!r} is not a FiberScope lab namespace", 403)


# --------------------------------------------------------------------------- ownership


def state_file() -> Path:
    return STATE_DIR / "owned.json"


def load_owned() -> dict[str, Any]:
    try:
        return json.loads(state_file().read_text())
    except (OSError, ValueError):
        return {"namespaces": [], "impairments": {}}


def save_owned(data: dict[str, Any]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = state_file().with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    os.chmod(tmp, 0o600)
    tmp.replace(state_file())


def existing_namespaces() -> set[str]:
    res = run_argv(["ip", "netns", "list"], timeout=5)
    return {line.split()[0] for line in res.stdout.splitlines() if line.strip()}


def verify_owned_iface(iface_id: str, alias_lookup=None) -> tuple[str, str]:
    """Return (ns, dev) for a logical interface after verifying the FiberScope ownership alias."""
    if iface_id not in IFACE_MAP:
        raise LabError("not_owned", f"{iface_id!r} is not an allowlisted lab interface", 403)
    ns, dev = IFACE_MAP[iface_id]
    if ns not in load_owned().get("namespaces", []):
        raise LabError("not_owned", f"namespace {ns} is not recorded as owned (run setup)", 403)
    alias = alias_lookup(ns, dev) if alias_lookup else _alias(ns, dev)
    if not (alias or "").startswith(OWNER_ALIAS):
        raise LabError("not_owned", f"{ns}/{dev} lacks the {OWNER_ALIAS} alias; refusing to touch it", 403)
    return ns, dev


def _alias(ns: str, dev: str) -> str | None:
    res = run_argv(ns_ip(ns, "-j", "link", "show", "dev", dev), timeout=5)
    try:
        return json.loads(res.stdout or "[]")[0].get("ifalias")
    except (ValueError, IndexError):
        return None


# --------------------------------------------------------------------------- setup / teardown


def environment_check() -> dict[str, Any]:
    tools = {t: bool(shutil.which(t)) for t in ("ip", "bridge", "tc", "ping", "iperf3")}
    return {
        "platform": platform.system(),
        "is_linux": platform.system() == "Linux",
        "is_root": hasattr(os, "geteuid") and os.geteuid() == 0,
        "enabled_by_env": os.environ.get("FIBERSCOPE_LAB_ENABLE") == "1",
        "tools": tools,
        "required_ok": all(tools[t] for t in ("ip", "bridge", "tc", "ping")),
        "iperf3_optional": tools["iperf3"],
    }


def require_environment() -> None:
    env = environment_check()
    problems = []
    if not env["is_linux"]:
        problems.append("Linux is required (use a dedicated Linux VM on macOS/Windows)")
    if not env["is_root"]:
        problems.append("root is required to create network namespaces")
    if not env["enabled_by_env"]:
        problems.append("set FIBERSCOPE_LAB_ENABLE=1 to explicitly activate the lab")
    if not env["required_ok"]:
        problems.append(f"missing tools: {[t for t, ok in env['tools'].items() if not ok and t != 'iperf3']}")
    if problems:
        raise LabError("environment", "; ".join(problems), 412)


def setup() -> dict[str, Any]:
    """Create the lab. Idempotent and recovers from partial setup (tears down owned leftovers first)."""
    require_environment()
    owned = load_owned()
    present = existing_namespaces()
    foreign = [ns for ns in NAMESPACES if ns in present and ns not in owned.get("namespaces", [])]
    if foreign:
        raise LabError("conflict", f"namespaces {foreign} exist but are not recorded as FiberScope-owned; refusing to modify", 409)
    teardown(quiet=True)
    owned = {"namespaces": [], "impairments": {}, "created_at": time.time()}
    for ns in NAMESPACES:
        run_argv(["ip", "netns", "add", ns], timeout=5, check=True)
        owned["namespaces"].append(ns)
        save_owned(owned)  # record ownership immediately for partial-failure recovery
        run_argv(ns_ip(ns, "link", "set", "lo", "up"), timeout=5, check=True)
    for ns_a, dev_a, ns_b, dev_b in LINKS:
        run_argv(["ip", "-n", ns_a, "link", "add", dev_a, "type", "veth", "peer", "name", dev_b, "netns", ns_b], timeout=5, check=True)
        for ns, dev in ((ns_a, dev_a), (ns_b, dev_b)):
            run_argv(ns_ip(ns, "link", "set", "dev", dev, "alias", f"{OWNER_ALIAS}:{ns}:{dev}"), timeout=5, check=True)
    for sw, ports in (("fslab-sw1", ("p1", "up", "gw")), ("fslab-sw2", ("p1", "up"))):
        run_argv(ns_ip(sw, "link", "add", "br0", "type", "bridge", "vlan_filtering", "1"), timeout=5, check=True)
        run_argv(ns_ip(sw, "link", "set", "dev", "br0", "alias", f"{OWNER_ALIAS}:{sw}:br0", "mtu", "9216"), timeout=5, check=True)
        for p in ports:
            run_argv(ns_ip(sw, "link", "set", "dev", p, "mtu", "9216", "master", "br0"), timeout=5, check=True)
            run_argv(ns_exec(sw, "bridge", "vlan", "del", "dev", p, "vid", "1"), timeout=5)
        run_argv(ns_exec(sw, "bridge", "vlan", "add", "dev", "p1", "vid", "20", "pvid", "untagged"), timeout=5, check=True)
        for vid in ("20", "30"):
            run_argv(ns_exec(sw, "bridge", "vlan", "add", "dev", "up", "vid", vid), timeout=5, check=True)
        if sw == "fslab-sw1":
            run_argv(ns_exec(sw, "bridge", "vlan", "add", "dev", "gw", "vid", "20"), timeout=5, check=True)
        for p in (*ports, "br0"):
            run_argv(ns_ip(sw, "link", "set", "dev", p, "up"), timeout=5, check=True)
    for host, ns, ip4, ip6 in (("srv-a", "fslab-srva", "192.0.2.11/24", "2001:db8:20::11/64"), ("srv-b", "fslab-srvb", "192.0.2.12/24", "2001:db8:20::12/64")):
        run_argv(ns_ip(ns, "link", "set", "dev", "eth0", "mtu", "9000", "up"), timeout=5, check=True)
        run_argv(ns_ip(ns, "addr", "add", ip4, "dev", "eth0"), timeout=5, check=True)
        run_argv(ns_ip(ns, "addr", "add", ip6, "dev", "eth0", "nodad"), timeout=5, check=True)
        run_argv(ns_ip(ns, "route", "add", "default", "via", "192.0.2.1"), timeout=5)
    run_argv(ns_ip("fslab-gw", "link", "set", "dev", "xe0", "mtu", "9216", "up"), timeout=5, check=True)
    run_argv(ns_ip("fslab-gw", "link", "add", "link", "xe0", "name", "xe0.20", "type", "vlan", "id", "20"), timeout=5, check=True)
    run_argv(ns_ip("fslab-gw", "link", "set", "dev", "xe0.20", "alias", f"{OWNER_ALIAS}:fslab-gw:xe0.20", "mtu", "9216", "up"), timeout=5, check=True)
    run_argv(ns_ip("fslab-gw", "addr", "add", "192.0.2.1/24", "dev", "xe0.20"), timeout=5, check=True)
    if shutil.which("iperf3"):
        for ns in ("fslab-srva", "fslab-srvb"):
            run_argv(ns_exec(ns, "iperf3", "-s", "-D", "-I", str(STATE_DIR / f"iperf3-{ns}.pid")), timeout=5)
    save_owned(owned)
    audit({"event": "setup", "namespaces": owned["namespaces"]})
    return {"ok": True, "namespaces": owned["namespaces"]}


def _stop_owned_iperf(ns: str) -> None:
    """Stop only the iperf3 server this runner started (by its pidfile) — never pkill by name."""
    pidfile = STATE_DIR / f"iperf3-{ns}.pid"
    try:
        pid = int(pidfile.read_text().strip())
        cmdline = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        if cmdline and cmdline[0].endswith(b"iperf3") and str(pidfile).encode() in cmdline:
            os.kill(pid, 15)
    except (OSError, ValueError):
        pass
    pidfile.unlink(missing_ok=True)


def teardown(quiet: bool = False) -> dict[str, Any]:
    """Delete only namespaces that are recorded as owned AND carry the fslab- prefix."""
    owned = load_owned()
    removed = []
    present = existing_namespaces() if owned.get("namespaces") else set()
    for ns in owned.get("namespaces", []):
        if not ns.startswith(PREFIX) or ns not in NAMESPACES:
            continue  # never delete anything outside the fixed allowlist
        if ns in present:
            _stop_owned_iperf(ns)
            run_argv(["ip", "netns", "del", ns], timeout=10)
            removed.append(ns)
    save_owned({"namespaces": [], "impairments": {}})
    audit({"event": "teardown", "removed": removed})
    return {"ok": True, "removed": removed}


def status() -> dict[str, Any]:
    owned = load_owned()
    present = existing_namespaces() if environment_check()["is_linux"] else set()
    ready = all(ns in present for ns in NAMESPACES) and set(owned.get("namespaces", [])) == set(NAMESPACES)
    return {"ready": ready, "owned": owned.get("namespaces", []), "present": sorted(n for n in present if n.startswith(PREFIX)),
            "impairments": owned.get("impairments", {}), "env": environment_check()}


# --------------------------------------------------------------------------- request validation


def _int(params: dict, key: str, default: int, lo: int, hi: int) -> int:
    v = params.get(key, default)
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise LabError("invalid_params", f"{key} must be an integer in [{lo}, {hi}]")
    return v


def _host(target: dict, key: str) -> str:
    v = target.get(key)
    if v not in HOST_IP4:
        raise LabError("invalid_target", f"{key} must be one of {sorted(HOST_IP4)}")
    return v


def _only_keys(d: Any, allowed: set[str], what: str) -> dict:
    if not isinstance(d, dict):
        raise LabError("invalid_request", f"{what} must be an object")
    extra = set(d) - allowed
    if extra:
        raise LabError("invalid_request", f"unexpected {what} fields: {sorted(extra)}")
    return d


def build_diagnostic(action: str, target: dict, params: dict) -> tuple[list[list[str]], float]:
    """Translate a validated diagnostic request into argv lists + a total timeout."""
    if action not in DIAG_ACTIONS:
        raise LabError("unsupported_action", f"unsupported diagnostic {action!r}")
    if action in ("reachability", "throughput", "mtu_probe"):
        _only_keys(target, {"src", "dst"}, "target")
        src, dst = _host(target, "src"), _host(target, "dst")
        if src == dst:
            raise LabError("invalid_target", "src and dst must differ")
        ns = DEVICE_NS[src]
        if action == "reachability":
            _only_keys(params, {"count", "payload_bytes", "dont_fragment", "ip_version"}, "params")
            count = _int(params, "count", 10, 1, 200)
            size = _int(params, "payload_bytes", 56, 0, 8972)
            v = _int(params, "ip_version", 4, 4, 6)
            if v not in (4, 6):
                raise LabError("invalid_params", "ip_version must be 4 or 6")
            df = params.get("dont_fragment", False)
            if not isinstance(df, bool):
                raise LabError("invalid_params", "dont_fragment must be boolean")
            dst_ip = HOST_IP4[dst] if v == 4 else HOST_IP6[dst]
            ipaddress.ip_address(dst_ip)
            argv = ns_exec(ns, "ping", *(["-6"] if v == 6 else []), "-c", str(count), "-i", "0.2", "-W", "1", "-s", str(size), *(["-M", "do"] if df else []), dst_ip)
            return [argv], min(60.0, count * 0.2 + 3)
        if action == "throughput":
            _only_keys(params, {"duration_s", "parallel"}, "params")
            dur = _int(params, "duration_s", 10, 1, 10)
            par = _int(params, "parallel", 1, 1, 4)
            return [ns_exec(ns, "iperf3", "-c", HOST_IP4[dst], "-t", str(dur), "-P", str(par), "-J", "--connect-timeout", "3000")], dur + 8.0
        _only_keys(params, {"payload_sizes", "ip_version", "count"}, "params")
        sizes = params.get("payload_sizes", [56, 1472, 8972])
        if not isinstance(sizes, list) or not 1 <= len(sizes) <= 6 or not all(isinstance(s, int) and not isinstance(s, bool) and 0 <= s <= 8972 for s in sizes):
            raise LabError("invalid_params", "payload_sizes must be 1–6 integers in [0, 8972]")
        count = _int(params, "count", 3, 1, 5)
        v = _int(params, "ip_version", 4, 4, 6)
        dst_ip = HOST_IP4[dst] if v == 4 else HOST_IP6[dst]
        return [ns_exec(ns, "ping", *(["-6"] if v == 6 else []), "-c", str(count), "-i", "0.2", "-W", "1", "-M", "do", "-s", str(s), dst_ip) for s in sizes], min(60.0, len(sizes) * (count * 0.2 + 2))
    if action in ("interface_state", "interface_counters", "impairment_inspect"):
        _only_keys(target, {"interface"}, "target")
        _only_keys(params, set(), "params")
        iface = target.get("interface")
        if iface not in IFACE_MAP:
            raise LabError("not_owned", f"{iface!r} is not an allowlisted lab interface", 403)
        ns, dev = IFACE_MAP[iface]
        if action == "interface_state":
            return [ns_ip(ns, "-j", "-d", "link", "show", "dev", dev)], 5.0
        if action == "interface_counters":
            return [ns_ip(ns, "-j", "-s", "link", "show", "dev", dev)], 5.0
        return [ns_exec(ns, "tc", "-j", "-s", "qdisc", "show", "dev", dev)], 5.0
    _only_keys(target, {"device"}, "target")
    _only_keys(params, set(), "params")
    dev = target.get("device")
    if dev not in DEVICE_NS:
        raise LabError("not_owned", f"{dev!r} is not an allowlisted lab device", 403)
    ns = DEVICE_NS[dev]
    if action == "vlan_membership":
        if dev.startswith("asw-"):
            return [ns_exec(ns, "bridge", "-j", "vlan", "show")], 5.0
        return [ns_ip(ns, "-j", "-d", "link", "show")], 5.0
    if action == "neighbor_table":
        if dev.startswith("asw-"):
            return [ns_exec(ns, "bridge", "-j", "fdb", "show", "br", "br0")], 5.0
        return [ns_ip(ns, "-j", "neigh", "show")], 5.0
    return [ns_ip(ns, "-j", "route", "show")], 5.0


def _iface_param(target: dict) -> str:
    _only_keys(target, {"interface"}, "target")
    return target.get("interface")


def build_repair(action: str, target: dict, params: dict, alias_lookup=None) -> list[list[str]]:
    if action not in REPAIR_ACTIONS:
        raise LabError("unsupported_action", f"unsupported repair {action!r}")
    if action == "remove_impairment":
        _only_keys(target, {"impairment_id"}, "target")
        imp = target.get("impairment_id")
        if not isinstance(imp, str) or not re.fullmatch(r"fs-imp-[0-9]{4}", imp):
            raise LabError("invalid_target", "impairment_id must look like fs-imp-0001")
        rec = load_owned().get("impairments", {}).get(imp)
        if rec is None:
            raise LabError("not_owned", f"impairment {imp} is not recorded as FiberScope-owned", 403)
        ns, dev = verify_owned_iface(rec["iface"], alias_lookup)
        return [ns_exec(ns, "tc", "qdisc", "del", "dev", dev, "root")]
    iface = _iface_param(target)
    ns, dev = verify_owned_iface(iface, alias_lookup)
    if action == "enable_interface":
        _only_keys(params, set(), "params")
        return [ns_ip(ns, "link", "set", "dev", dev, "up")]
    if action == "set_mtu":
        _only_keys(params, {"mtu"}, "params")
        mtu = _int(params, "mtu", 0, 576, 9216)
        return [ns_ip(ns, "link", "set", "dev", dev, "mtu", str(mtu))]
    _only_keys(params, {"vlan"}, "params")
    vlan = _int(params, "vlan", 0, 1, 4094)
    if iface not in ACCESS_PORTS:
        raise LabError("invalid_target", f"{iface} is not an access port")
    if vlan not in LAB_VLANS:
        raise LabError("invalid_params", f"VLAN {vlan} is not defined in the lab")
    other = [str(v) for v in sorted(LAB_VLANS - {vlan})]
    return [ns_exec(ns, "bridge", "vlan", "del", "dev", dev, "vid", o) for o in other] + [
        ns_exec(ns, "bridge", "vlan", "add", "dev", dev, "vid", str(vlan), "pvid", "untagged")]


def build_fault(scenario: str, alias_lookup=None) -> list[list[str]]:
    if scenario not in FAULTS:
        raise LabError("unsupported_scenario", f"scenario {scenario!r} has no Linux lab fault")
    if scenario == "wrong-vlan":
        ns, dev = verify_owned_iface("asw-2:Ethernet1/1", alias_lookup)
        return [ns_exec(ns, "bridge", "vlan", "del", "dev", dev, "vid", "20"), ns_exec(ns, "bridge", "vlan", "add", "dev", dev, "vid", "30", "pvid", "untagged")]
    if scenario == "admin-down":
        ns, dev = verify_owned_iface("asw-1:Ethernet1/1", alias_lookup)
        return [ns_ip(ns, "link", "set", "dev", dev, "down")]
    if scenario == "packet-loss":
        ns, dev = verify_owned_iface("asw-1:Ethernet1/49", alias_lookup)
        return [ns_exec(ns, "tc", "qdisc", "replace", "dev", dev, "root", "netem", "loss", "15%")]
    ns, dev = verify_owned_iface("asw-2:Ethernet1/49", alias_lookup)
    return [ns_ip(ns, "link", "set", "dev", dev, "mtu", "1500")]


def restore_baseline() -> dict[str, Any]:
    """Return every owned resource to the healthy baseline (idempotent)."""
    cmds = []
    for iface in ("asw-1:Ethernet1/1", "asw-2:Ethernet1/1"):
        cmds += build_repair("set_access_vlan", {"interface": iface}, {"vlan": 20})
        cmds += build_repair("enable_interface", {"interface": iface}, {})
    for iface in ("asw-1:Ethernet1/49", "asw-2:Ethernet1/49"):
        cmds += build_repair("set_mtu", {"interface": iface}, {"mtu": 9216})
        ns, dev = verify_owned_iface(iface)
        cmds.append(ns_exec(ns, "tc", "qdisc", "del", "dev", dev, "root"))
    results = [run_argv(c, timeout=5) for c in cmds]
    owned = load_owned()
    owned["impairments"] = {}
    save_owned(owned)
    return {"ok": True, "commands": len(results)}


# --------------------------------------------------------------------------- dispatch


def handle(req: Any) -> dict[str, Any]:
    req = _only_keys(req, {"op", "action", "target", "params", "scenario", "request_id"}, "request")
    op = req.get("op")
    rid = req.get("request_id") if isinstance(req.get("request_id"), str) and len(req.get("request_id", "")) <= 64 else None
    audit({"event": "request", "op": op, "action": req.get("action"), "request_id": rid})
    if op == "status":
        return status()
    if op == "restore_baseline":
        return restore_baseline()
    if op == "fault":
        scenario = req.get("scenario")
        cmds = build_fault(scenario)
        res = [run_argv(c, timeout=5, check=True) for c in cmds]
        if scenario == "packet-loss":
            owned = load_owned()
            owned.setdefault("impairments", {})["fs-imp-0001"] = {"iface": "asw-1:Ethernet1/49", "kind": "netem", "loss_pct": 15.0}
            save_owned(owned)
        return {"ok": True, "description": FAULTS[scenario], "commands": [r.argv for r in res]}
    target = req.get("target") or {}
    params = req.get("params") or {}
    action = req.get("action")
    if op == "diagnostic":
        cmds, timeout = build_diagnostic(action, target, params)
        per = timeout / max(1, len(cmds))
        outs = [run_argv(c, timeout=per) for c in cmds]
        return {"ok": True, "results": [{"argv": o.argv, "rc": o.rc, "stdout": o.stdout, "stderr": o.stderr, "duration_s": o.duration_s, "timed_out": o.timed_out} for o in outs]}
    if op == "repair":
        cmds = build_repair(action, target, params)
        outs = [run_argv(c, timeout=5) for c in cmds]
        if action == "remove_impairment":
            owned = load_owned()
            owned.get("impairments", {}).pop(target["impairment_id"], None)
            save_owned(owned)
        return {"ok": all(o.rc == 0 or "del" in o.argv for o in outs), "results": [{"argv": o.argv, "rc": o.rc, "stdout": o.stdout, "stderr": o.stderr} for o in outs]}
    raise LabError("unsupported_op", f"unsupported op {op!r}")


def make_handler(token: str):
    class Handler(BaseHTTPRequestHandler):
        server_version = "fiberscope-labrunner/1"

        def log_message(self, *_a):  # use the audit log instead of stderr noise
            return

        def _send(self, code: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):  # noqa: N802
            auth = self.headers.get("Authorization", "")
            if not hmac.compare_digest(auth.encode(), f"Bearer {token}".encode()):
                audit({"event": "auth_failed", "client": self.client_address[0]})
                return self._send(401, {"error": "unauthorized"})
            if self.path != "/v1/run":
                return self._send(404, {"error": "not_found"})
            length = int(self.headers.get("Content-Length", "0") or 0)
            if length <= 0 or length > MAX_REQUEST:
                return self._send(413, {"error": "request_too_large"})
            try:
                body = json.loads(self.rfile.read(length))
                return self._send(200, handle(body))
            except LabError as exc:
                return self._send(exc.http, {"error": exc.code, "message": exc.message})
            except ValueError:
                return self._send(400, {"error": "invalid_json"})

        def do_GET(self):  # noqa: N802
            return self._send(405, {"error": "use POST /v1/run"})

    return Handler


def read_token(path: str) -> str:
    st = os.stat(path)
    if st.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise SystemExit(f"token file {path} must not be group/world accessible (chmod 600)")
    tok = Path(path).read_text().strip()
    if len(tok) < 32:
        raise SystemExit("token must be at least 32 characters")
    return tok


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="FiberScope Linux lab runner (privileged, isolated namespaces only)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check", help="report environment readiness")
    for name in ("setup", "teardown", "restore"):
        p = sub.add_parser(name)
        p.add_argument("--i-understand", action="store_true", help="confirm this creates/deletes fslab-* network namespaces")
    sub.add_parser("status")
    sp = sub.add_parser("serve")
    sp.add_argument("--token-file", required=True)
    sp.add_argument("--port", type=int, default=8765)
    sp.add_argument("--i-understand", action="store_true")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "check":
            print(json.dumps(environment_check(), indent=2))
            return 0
        if args.cmd == "status":
            print(json.dumps(status(), indent=2))
            return 0
        if not getattr(args, "i_understand", False):
            print("Refusing: pass --i-understand to confirm explicit operator activation.", file=sys.stderr)
            return 2
        require_environment()
        if args.cmd == "setup":
            print(json.dumps(setup(), indent=2))
        elif args.cmd == "teardown":
            print(json.dumps(teardown(), indent=2))
        elif args.cmd == "restore":
            print(json.dumps(restore_baseline(), indent=2))
        elif args.cmd == "serve":
            token = read_token(args.token_file)
            srv = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(token))  # loopback only, by design
            print(f"lab runner listening on 127.0.0.1:{args.port}")
            srv.serve_forever()
        return 0
    except LabError as exc:
        print(f"error [{exc.code}]: {exc.message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
