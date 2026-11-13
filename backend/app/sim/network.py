"""Deterministic simulated network model for North Lab Fabric.

The simulation *state* (a JSON document owned by a ScenarioExecution) holds configuration and
physical conditions. Every observable — link state, optical readings, forwarding, probe
results, counters — is *derived* from that state here. Faults mutate state; they never write
symptoms directly.

Randomness (probe loss sampling, RTT jitter) uses ``random.Random`` seeded from the execution
seed and a per-execution run counter, so a given action sequence always reproduces.
"""
from __future__ import annotations

import copy
import math
import random
from dataclasses import dataclass, field
from typing import Any

from ..domain.fixture import OPTIC_BASELINE, RX_LOS_DBM
from ..domain.topology import Topology

ICMP_V4_OVERHEAD = 28  # 20-byte IPv4 header + 8-byte ICMP header
ICMP_V6_OVERHEAD = 48  # 40-byte IPv6 header + 8-byte ICMPv6 header
TCP_V4_OVERHEAD = 40  # IPv4 + TCP headers without options
ETH_WIRE_OVERHEAD = 38  # Ethernet header+FCS (18) + preamble/SFD (8) + inter-frame gap (12)
RX_FLOOR_DBM = -40.0  # value a module typically reports at its measurement floor


# ----------------------------------------------------------------------------- baseline


def baseline_state(topo: Topology) -> dict[str, Any]:
    ifaces: dict[str, Any] = {}
    counters: dict[str, Any] = {}
    for idx, (iid, info) in enumerate(sorted(topo.ifaces.items())):
        if topo.is_passive(iid):
            continue
        ifaces[iid] = {
            "admin_up": True,
            "mtu": info.intended_mtu or 1500,
            "vlan": info.intended_vlan,
            "allowed_vlans": list(info.intended_allowed_vlans) if info.intended_allowed_vlans else None,
        }
        # fixed, plausible cumulative counters for the baseline (fixture values)
        base = 1_000_000 + idx * 73_421
        counters[iid] = {
            "rx_packets": base * 3,
            "tx_packets": base * 3 + 1_337,
            "rx_errors": 0,
            "rx_crc": 0,
            "rx_discards": 0,
            "tx_discards": 0,
            "rx_oversize": 0,
        }
    optics = {
        iid: {**vals, "tx_enabled": True, "module_replacements": 0}
        for iid, vals in OPTIC_BASELINE.items()
        if iid in topo.ifaces
    }
    return {
        "schema": 1,
        "ifaces": ifaces,
        "optics": optics,
        "contamination": [],
        "impairments": [],
        "counters": counters,
        "neighbors": {
            "srv-a": {"192.0.2.12": {"mac": "02:00:5e:10:00:12", "state": "REACHABLE"},
                      "192.0.2.1": {"mac": "02:00:5e:30:00:01", "state": "REACHABLE"}},
            "srv-b": {"192.0.2.11": {"mac": "02:00:5e:10:00:11", "state": "REACHABLE"},
                      "192.0.2.1": {"mac": "02:00:5e:30:00:01", "state": "REACHABLE"}},
            "gw-1": {"192.0.2.11": {"mac": "02:00:5e:10:00:11", "state": "REACHABLE"},
                     "192.0.2.12": {"mac": "02:00:5e:10:00:12", "state": "REACHABLE"}},
        },
        "impairment_stats": {},
    }


def clone(state: dict[str, Any]) -> dict[str, Any]:
    return copy.deepcopy(state)


# ----------------------------------------------------------------------------- results


@dataclass
class OpticReading:
    iface: str
    present: bool
    dom_supported: bool
    tx_power_dbm: float | None
    rx_power_dbm: float | None
    temperature_c: float | None
    voltage_v: float | None
    bias_ma: float | None
    flags: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


@dataclass
class ForwardResult:
    delivered: bool
    stage: str  # ok | src_down | no_l2_path | mtu_local | mtu_drop | loss
    detail: str
    path: list[str]  # ordered interfaces traversed (src ... dst)
    egress: list[str]  # egress interfaces where an impairment could apply
    drop_iface: str | None = None
    vlan: int | None = None


class NetworkModel:
    def __init__(self, topo: Topology, state: dict[str, Any]):
        self.topo = topo
        self.state = state

    # ------------------------------------------------------------------ physical layer
    def iface_state(self, iid: str) -> dict[str, Any]:
        return self.state["ifaces"][iid]

    def optic_present(self, iid: str) -> bool:
        return iid in self.state["optics"]

    def tx_power(self, iid: str) -> float | None:
        o = self.state["optics"].get(iid)
        if o is None:
            return None
        if not self.iface_state(iid)["admin_up"] or not o.get("tx_enabled", True):
            return None
        return o["tx_power_dbm"]

    def rx_power(self, iid: str) -> tuple[float | None, bool]:
        """Return (rx_dbm, los). rx is None when this port has no DOM-capable optic."""
        if iid not in self.state["optics"]:
            return None, False
        peer = self.topo.peer_of(iid)
        if peer is None:
            return RX_FLOOR_DBM, True
        peer_tx = self.tx_power(peer)
        if peer_tx is None:
            return RX_FLOOR_DBM, True
        link = self.topo.links[self.topo.link_of[iid]]
        loss = self.topo.path_loss_db(link)
        for c in self.state["contamination"]:
            if c["affects_rx_of"] == iid and c["point"] in link.path.mated_points + [link.a, link.b]:
                loss += c["extra_loss_db"]
        rx = round(peer_tx - loss, 2)
        if rx < RX_LOS_DBM:
            return RX_FLOOR_DBM, True
        return rx, False

    def carrier(self, iid: str) -> bool:
        """Physical carrier detected at this port (independent of its own admin state)."""
        peer = self.topo.peer_of(iid)
        if peer is None:
            return False
        if not self.iface_state(peer)["admin_up"]:
            return False
        if self.topo.ifaces[iid].media == "fiber":
            _, los = self.rx_power(iid)
            if los:
                return False
        return True

    def oper_up(self, iid: str) -> bool:
        if self.topo.ifaces[iid].kind == "mgmt":
            return self.iface_state(iid)["admin_up"]
        return self.iface_state(iid)["admin_up"] and self.carrier(iid) and self._peer_carrier(iid)

    def _peer_carrier(self, iid: str) -> bool:
        peer = self.topo.peer_of(iid)
        if peer is None:
            return False
        if not self.iface_state(iid)["admin_up"]:
            return False
        if self.topo.ifaces[peer].media == "fiber" and peer in self.state["optics"]:
            _, los = self.rx_power(peer)
            return not los
        return True

    def oper_reason(self, iid: str) -> str:
        st = self.iface_state(iid)
        if not st["admin_up"]:
            return "Administratively down"
        if self.topo.peer_of(iid) is None:
            return "No cable recorded / not connected"
        if not self.carrier(iid):
            return "Link not connected (no carrier / Rx LOS)"
        if not self._peer_carrier(iid):
            return "Remote fault (peer not receiving)"
        return "Link up"

    def optic_reading(self, iid: str, dom_supported: bool) -> OpticReading:
        if iid not in self.state["optics"]:
            return OpticReading(iid, False, False, None, None, None, None, None, {"no_optic": True})
        o = self.state["optics"][iid]
        if not dom_supported:
            return OpticReading(iid, True, False, None, None, None, None, None, {"dom_unsupported": True})
        tx = self.tx_power(iid)
        rx, los = self.rx_power(iid)
        flags: dict[str, Any] = {}
        if tx is None:
            flags["tx_disabled"] = True
        if los:
            flags["rx_los"] = True
        return OpticReading(
            iid, True, True, tx, rx, o["temperature_c"], o["voltage_v"], o["bias_ma"] if tx is not None else 0.0, flags
        )

    # ------------------------------------------------------------------ L2 forwarding
    def _carries(self, iid: str, vlan: int) -> bool:
        st = self.iface_state(iid)
        info = self.topo.ifaces[iid]
        mode = info.switchport_mode
        if mode == "access":
            return st["vlan"] == vlan
        if mode == "trunk":
            return vlan in (st["allowed_vlans"] or [])
        if mode == "routed":  # 802.1Q sub-interface on gateway
            return st["vlan"] == vlan
        return False

    def forward(self, src: str, dst: str, packet_bytes: int, df: bool) -> ForwardResult:
        """Forward one IP packet of ``packet_bytes`` from interface src to interface dst."""
        if not self.oper_up(src):
            return ForwardResult(False, "src_down", f"{src} is not operationally up", [src], [], src)
        src_mtu = self.iface_state(src)["mtu"]
        if packet_bytes > src_mtu and df:
            return ForwardResult(False, "mtu_local", f"packet {packet_bytes} B exceeds local MTU {src_mtu}", [src], [], src)
        first = self.topo.peer_of(src)
        if first is None:
            return ForwardResult(False, "no_l2_path", "no peer", [src], [], src)
        # VLAN classification at first switch port
        info = self.topo.ifaces[first]
        src_info = self.topo.ifaces[src]
        if info.switchport_mode == "access":
            vlan = self.iface_state(first)["vlan"]
        else:
            vlan = self.iface_state(src)["vlan"] if src_info.switchport_mode == "routed" else None
            if vlan is None or not self._carries(first, vlan):
                return ForwardResult(False, "no_l2_path", f"frame not admitted on {first}", [src, first], [src])
        # BFS through switches
        start = (first, [src, first], [src])
        queue = [start]
        seen = {first}
        while queue:
            ingress, path, egress_list = queue.pop(0)
            if ingress == dst:
                return self._check_mtu_and_finish(path, egress_list, packet_bytes, vlan)
            dev = self.topo.ifaces[ingress].device_id
            if self.topo.devices[dev]["role"] != "access_switch":
                continue
            if not self.oper_up(ingress):
                continue
            for eg_id, eg in self.topo.ifaces.items():
                if eg.device_id != dev or eg_id == ingress or eg.kind == "mgmt":
                    continue
                if eg_id not in self.state["ifaces"] or not self._carries(eg_id, vlan) or not self.oper_up(eg_id):
                    continue
                nxt = self.topo.peer_of(eg_id)
                if nxt is None or nxt in seen:
                    continue
                nxt_info = self.topo.ifaces[nxt]
                eg_mode = self.topo.ifaces[eg_id].switchport_mode
                # receiving end admission
                if nxt_info.kind in ("data",) and self.topo.devices[nxt_info.device_id]["role"] == "server":
                    if eg_mode != "access":
                        continue
                elif nxt_info.switchport_mode == "routed":
                    if eg_mode != "trunk" or self.iface_state(nxt)["vlan"] != vlan:
                        continue
                elif not self._carries(nxt, vlan):
                    continue
                if not self.oper_up(nxt):
                    continue
                seen.add(nxt)
                queue.append((nxt, path + [eg_id, nxt], egress_list + [eg_id]))
        return ForwardResult(False, "no_l2_path", f"no Layer 2 path in VLAN {vlan}", [src, first], [src], vlan=vlan)

    def _check_mtu_and_finish(self, path: list[str], egress: list[str], size: int, vlan: int | None) -> ForwardResult:
        for iid in path[1:]:
            if self.iface_state(iid)["mtu"] < size:
                return ForwardResult(
                    False, "mtu_drop", f"{size} B packet exceeds MTU {self.iface_state(iid)['mtu']} at {iid}",
                    path, egress, iid, vlan,
                )
        return ForwardResult(True, "ok", "delivered", path, egress, None, vlan)

    def impairment_loss(self, egress: list[str]) -> list[dict[str, Any]]:
        return [imp for imp in self.state["impairments"] if imp["egress_iface"] in egress]

    def l2_ok(self, src: str, dst: str) -> bool:
        return self.forward(src, dst, 64, df=False).stage in ("ok", "mtu_drop")

    # ------------------------------------------------------------------ probes
    def _bump(self, iid: str, key: str, n: int = 1) -> None:
        c = self.state["counters"].get(iid)
        if c is not None:
            c[key] = c.get(key, 0) + n

    def _account_path(self, path: list[str]) -> None:
        for idx, iid in enumerate(path):
            self._bump(iid, "tx_packets" if idx % 2 == 0 else "rx_packets")

    def send(self, src: str, dst: str, size: int, df: bool, rng: random.Random) -> tuple[bool, ForwardResult]:
        fr = self.forward(src, dst, size, df)
        if fr.stage == "mtu_drop" and fr.drop_iface:
            self._account_path(fr.path[: fr.path.index(fr.drop_iface)])
            self._bump(fr.drop_iface, "rx_oversize")
            return False, fr
        if not fr.delivered:
            return False, fr
        for imp in self.impairment_loss(fr.egress):
            if rng.random() < imp["loss_pct"] / 100.0:
                stats = self.state["impairment_stats"].setdefault(imp["id"], {"sent": 0, "dropped": 0})
                stats["dropped"] += 1
                stats["sent"] += 1
                return False, ForwardResult(False, "loss", f"dropped by {imp['id']}", fr.path, fr.egress, imp["egress_iface"], fr.vlan)
            stats = self.state["impairment_stats"].setdefault(imp["id"], {"sent": 0, "dropped": 0})
            stats["sent"] += 1
        self._account_path(fr.path)
        return True, fr

    def resolve_neighbor(self, src_dev: str, src: str, dst_ip: str) -> tuple[bool, str | None]:
        dst_iface = self.topo.find_iface_by_ip(dst_ip)
        table = self.state["neighbors"].setdefault(src_dev, {})
        if dst_iface is None:
            table[dst_ip] = {"mac": None, "state": "FAILED"}
            return False, None
        ok = self.forward(src, dst_iface.id, 64, df=False).stage in ("ok", "mtu_drop")
        if ok:
            table[dst_ip] = {"mac": dst_iface.mac, "state": "REACHABLE"}
            return True, dst_iface.mac
        table[dst_ip] = {"mac": None, "state": "FAILED"}
        return False, None

    def mac_table(self, switch: str) -> list[dict[str, Any]]:
        """MAC entries derived from endpoint links that are up, per current VLAN config."""
        entries = []
        for host_dev in ("srv-a", "srv-b", "gw-1"):
            hif = {"srv-a": "srv-a:eth0", "srv-b": "srv-b:eth0", "gw-1": "gw-1:xe-0/0/0"}[host_dev]
            if hif not in self.topo.ifaces or not self.oper_up(hif):
                continue
            att = self.topo.peer_of(hif)
            if att is None:
                continue
            att_info = self.topo.ifaces[att]
            vlan = self.iface_state(att)["vlan"] if att_info.switchport_mode == "access" else self.iface_state(hif)["vlan"]
            if vlan is None:
                continue
            if att_info.device_id == switch:
                entries.append({"vlan": vlan, "mac": self.topo.ifaces[hif].mac, "port": att_info.name, "host": host_dev})
                continue
            # learned via uplink if the uplink carries the VLAN on both ends
            for uplink in ("asw-1:Ethernet1/49", "asw-2:Ethernet1/49"):
                if self.topo.ifaces[uplink].device_id != switch:
                    continue
                peer = self.topo.peer_of(uplink)
                if (
                    peer
                    and self.topo.ifaces[peer].device_id == att_info.device_id
                    and self.oper_up(uplink)
                    and self._carries(uplink, vlan)
                    and self._carries(peer, vlan)
                ):
                    entries.append({"vlan": vlan, "mac": self.topo.ifaces[hif].mac, "port": self.topo.ifaces[uplink].name, "host": host_dev})
        return sorted(entries, key=lambda e: (e["vlan"], e["mac"]))


def rtt_ms(hops: int, size: int, rng: random.Random) -> float:
    base = 0.085 + 0.042 * hops
    serialization = (size * 8) / 25e9 * 1000 * max(hops, 1) * 2
    jitter = rng.uniform(-0.018, 0.024)
    return round(max(0.04, base + serialization + jitter), 3)


def tcp_efficiency(mss: int) -> float:
    return mss / (mss + TCP_V4_OVERHEAD + ETH_WIRE_OVERHEAD)


def loss_throughput_factor(loss_pct: float) -> float:
    """Simplified, monotonic degradation model — NOT a TCP performance prediction."""
    if loss_pct <= 0:
        return 1.0
    return max(0.004, math.exp(-loss_pct / 100.0 * 25))
