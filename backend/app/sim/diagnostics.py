"""Simulated diagnostic collectors.

Each collector reads the simulated network model and returns a ``DiagnosticResult`` with:
raw (simulated) command output, a normalized payload, a fact-level interpretation, explicit
limitations, topology observations, and optional guided-mode next steps (hints are stored
separately so challenge mode can withhold them).

Switch output imitates a *generic* NOS CLI; it is not any vendor's real format.
"""
from __future__ import annotations

import random
import statistics
from dataclasses import dataclass, field
from typing import Any

from ..domain.fixture import FIBER_ATTENUATION_DB_PER_KM, MATED_PAIR_LOSS_DB, SERVER_DATA_IFACE
from ..domain.topology import Topology
from ..services.catalog import ActionError
from .network import (
    ICMP_V4_OVERHEAD,
    ICMP_V6_OVERHEAD,
    TCP_V4_OVERHEAD,
    NetworkModel,
    loss_throughput_factor,
    rtt_ms,
    tcp_efficiency,
)

SIM_SOURCE_NOTE = "Simulated output generated from the scenario state — not captured from real equipment."


@dataclass
class DiagnosticResult:
    title: str
    command: str
    purpose: str
    raw_output: str
    payload: dict[str, Any]
    interpretation: str
    limitations: list[str]
    observations: list[dict[str, Any]]
    verdict: str  # ok | warning | fail | info
    source_id: str
    sim_duration_ms: int = 1000
    next_steps: list[str] = field(default_factory=list)
    status: str = "completed"


@dataclass
class SimContext:
    topo: Topology
    model: NetworkModel
    optics_db: dict[str, dict[str, Any]]  # iface -> optic record (thresholds etc.)
    rng: random.Random


# ----------------------------------------------------------------------------- helpers


def _host_iface(ctx: SimContext, host: str) -> str:
    return SERVER_DATA_IFACE[host]


def _ip(ctx: SimContext, host: str, version: int) -> str:
    info = ctx.topo.ifaces[_host_iface(ctx, host)]
    ip = info.ipv4 if version == 4 else info.ipv6
    if ip is None:
        raise ActionError("invalid_target", f"{host} has no IPv{version} address in this lab.")
    return ip


def _require_iface(ctx: SimContext, iid: str, allow_passive: bool = False) -> None:
    if iid not in ctx.topo.ifaces:
        raise ActionError("invalid_target", f"Unknown interface '{iid}'.")
    if not allow_passive and ctx.topo.is_passive(iid):
        raise ActionError(
            "invalid_target",
            f"{iid} is a passive patch-panel port. It has no state or counters to query — use 'Trace documented cable path'.",
        )


def _is_switch(ctx: SimContext, dev: str) -> bool:
    return ctx.topo.devices[dev]["role"] in ("access_switch", "gateway")


def _short(name: str) -> str:
    return name.replace("Ethernet", "Eth")


def _clip(lines: list[str], limit: int = 24) -> list[str]:
    if len(lines) <= limit:
        return lines
    return lines[: limit - 1] + [f"... ({len(lines) - limit + 1} lines omitted for display; totals below are complete)"]


# ----------------------------------------------------------------------------- reachability


def reachability(ctx: SimContext, target: dict, params: dict) -> DiagnosticResult:
    src, dst = target["src"], target["dst"]
    v = params["ip_version"]
    count, payload, df = params["count"], params["payload_bytes"], params["dont_fragment"]
    src_if, dst_if = _host_iface(ctx, src), _host_iface(ctx, dst)
    dst_ip, src_ip = _ip(ctx, dst, v), _ip(ctx, src, v)
    overhead = ICMP_V4_OVERHEAD if v == 4 else ICMP_V6_OVERHEAD
    packet = payload + overhead
    m = ctx.model

    flag6 = " -6" if v == 6 else ""
    dfflag = " -M do" if df else ""
    cmd = f"ping{flag6} -c {count}{dfflag} -s {payload} {dst_ip}"
    if v == 4:
        lines = [f"PING {dst_ip} ({dst_ip}) {payload}({packet}) bytes of data."]
    else:
        lines = [f"PING {dst_ip}({dst_ip}) {payload} data bytes"]

    src_up = m.oper_up(src_if)
    resolved, _mac = (m.resolve_neighbor(src, src_if, dst_ip) if src_up else (False, None))
    received, errors, rtts = 0, 0, []
    mode = "none"
    hops = 0
    for seq in range(1, count + 1):
        if not src_up or not resolved:
            errors += 1
            lines.append(f"From {src_ip} icmp_seq={seq} Destination Host Unreachable")
            mode = "neighbor_unresolved" if src_up else "local_link_down"
            continue
        if df and packet > m.iface_state(src_if)["mtu"]:
            errors += 1
            lines.append(f"ping: local error: message too long, mtu={m.iface_state(src_if)['mtu']}")
            mode = "local_mtu"
            continue
        ok, fr = m.send(src_if, dst_if, packet, df, ctx.rng)
        if ok:
            ok_back, _ = m.send(dst_if, src_if, packet, df, ctx.rng)
            ok = ok_back
        if ok:
            hops = max(1, (len(fr.path) - 2) // 2)
            t = rtt_ms(hops, packet, ctx.rng)
            rtts.append(t)
            received += 1
            reply_bytes = payload + 8
            lines.append(f"{reply_bytes} bytes from {dst_ip}: icmp_seq={seq} ttl=64 time={t:.3f} ms")
        else:
            if mode == "none":
                mode = "timeout"
    loss = round(100.0 * (count - received) / count, 1)
    if received and received < count:
        mode = "partial_loss"
    elif received == count:
        mode = "none"
    lines = _clip(lines)
    lines.append("")
    lines.append(f"--- {dst_ip} ping statistics ---")
    err = f", +{errors} errors" if errors else ""
    lines.append(f"{count} packets transmitted, {received} received{err}, {loss:g}% packet loss, time {count * 1000 - 1000 + 12}ms")
    rtt_stats = None
    if rtts:
        mdev = statistics.pstdev(rtts) if len(rtts) > 1 else 0.0
        rtt_stats = {"min": min(rtts), "avg": round(sum(rtts) / len(rtts), 3), "max": max(rtts), "mdev": round(mdev, 3)}
        lines.append(f"rtt min/avg/max/mdev = {rtt_stats['min']:.3f}/{rtt_stats['avg']:.3f}/{rtt_stats['max']:.3f}/{rtt_stats['mdev']:.3f} ms")

    pl = {
        "src": src, "dst": dst, "src_ip": src_ip, "dst_ip": dst_ip, "ip_version": v, "count": count,
        "payload_bytes": payload, "packet_bytes": packet, "dont_fragment": df, "transmitted": count,
        "received": received, "errors": errors, "loss_pct": loss, "rtt_ms": rtt_stats,
        "neighbor_resolved": bool(resolved), "failure_mode": mode,
    }
    label = f"{src} → {dst}"
    if mode == "none":
        verdict, status = "ok", "up"
        interp = (
            f"All {count} probes from {src} to {dst_ip} were answered ({payload}-byte payload"
            f"{', DF set' if df else ''}). This confirms IP reachability for packets of this size in both directions at the time of the test. "
            "It does not prove that larger packets, sustained throughput, or other flows work."
        )
        nxt: list[str] = []
    elif mode == "partial_loss":
        verdict, status = "warning", "degraded"
        interp = (
            f"{received} of {count} probes were answered ({loss:g}% loss). The path is up but losing packets. "
            "Intermittent loss can come from congestion, a policer/impairment, a degraded physical link, or a "
            "faulty device — this test alone does not say where along the path it happens."
        )
        nxt = ["Inspect interface counters on each hop for errors/discards", "Inspect lab impairment rules on the uplink", "Run a bounded throughput test to quantify impact"]
    elif mode == "neighbor_unresolved":
        verdict, status = "fail", "down"
        interp = (
            f"No replies. The kernel reported 'Destination Host Unreachable', meaning {src} could not resolve "
            f"the link-layer address of {dst_ip} (ARP/ND failed). {dst_ip} is on-link, so this points at Layer 1/Layer 2 "
            "between the hosts — but it does not identify which element. A server that does not respond is a symptom, not proof of a broken cable."
        )
        nxt = ["Inspect interface state at both ends (admin vs operational)", "Inspect the neighbor table on the source", "Inspect VLAN membership on the access switches"]
    elif mode == "local_link_down":
        verdict, status = "fail", "down"
        interp = (
            f"No replies and 'Destination Host Unreachable' from the local host. {src}'s data interface is not operationally up, "
            "so it cannot send. The cause could be the local NIC, cabling, optics, or the far-end port's state."
        )
        nxt = ["Inspect interface state on the source NIC", "Inspect interface state on the attached switch port", "Read optical telemetry at both ends"]
    elif mode == "local_mtu":
        verdict, status = "fail", "degraded"
        interp = f"The local host refused to send: a {packet}-byte packet with DF set exceeds its own interface MTU. This is a parameter limit on the sender, not a path failure."
        nxt = ["Choose a payload that fits the source MTU", "Run the MTU probe"]
    else:
        verdict, status = "fail", "down"
        interp = (
            f"Neighbor resolution succeeded (Layer 2 adjacency exists) but none of the {packet}-byte probes were answered. "
            "Small frames reach the destination; these probes do not. If small probes work, suspect packet size (MTU) or a filter."
        )
        nxt = ["Run the MTU probe with small and large payloads", "Inspect interface MTU along the path"]
    if df:
        interp += " DF was set, so packets could not be fragmented."
    obs = [{"kind": "reachability", "id": f"{src}->{dst}", "status": status, "label": label}]
    lim = [
        SIM_SOURCE_NOTE,
        "ICMP reachability shows only that echo requests/replies of this size were delivered; it is not application verification.",
        f"RTT values come from a simplified latency model; probe interval is simulated at 1 s ({count} s simulated time).",
    ]
    return DiagnosticResult(
        title=f"Reachability {src} → {dst} (IPv{v}, {payload} B{', DF' if df else ''}, ×{count})",
        command=cmd,
        purpose="Test end-to-end IP reachability with ICMP echo probes.",
        raw_output="\n".join(lines),
        payload=pl,
        interpretation=interp,
        limitations=lim,
        observations=obs,
        verdict=verdict,
        source_id=f"sim:{src}",
        sim_duration_ms=count * 1000,
        next_steps=nxt,
    )


# ----------------------------------------------------------------------------- interface state


def interface_state(ctx: SimContext, target: dict, params: dict) -> DiagnosticResult:
    iid = target["interface"]
    _require_iface(ctx, iid)
    m, info = ctx.model, ctx.topo.ifaces[iid]
    st = m.iface_state(iid)
    admin = "up" if st["admin_up"] else "down"
    oper_up = m.oper_up(iid)
    oper = "up" if oper_up else "down"
    reason = m.oper_reason(iid)
    dev = info.device_id
    if _is_switch(ctx, dev):
        cmd = f"show interface {info.name}"
        first = f"{info.name} is {oper}" + ("" if oper_up else f" ({reason})")
        mode_line = (
            f"  Port mode is access, access VLAN {st['vlan']}" if info.switchport_mode == "access"
            else f"  Port mode is trunk, allowed VLANs {','.join(map(str, st['allowed_vlans'] or []))}" if info.switchport_mode == "trunk"
            else f"  Routed sub-interface unit {st['vlan']}, 802.1Q tag {st['vlan']}" if info.switchport_mode == "routed"
            else "  Management port"
        )
        raw = "\n".join([
            first,
            f"  admin state is {admin}",
            f"  Description: {info.description}",
            f"  Hardware: {int((info.speed_gbps or 1) * 1000)} Mbps {info.media}, address: {info.mac}",
            f"  MTU {st['mtu']} bytes",
            mode_line,
            f"  Link state: {reason}",
            f"  Last link flapped: {'never' if oper_up else 'during this scenario'}",
        ])
    else:
        flags = ["BROADCAST", "MULTICAST"]
        if st["admin_up"]:
            flags.append("UP")
            flags.insert(0, "NO-CARRIER") if not oper_up else flags.append("LOWER_UP")
        state_word = "UP" if oper_up else "DOWN"
        cmd = f"ip -d link show dev {info.name}; ethtool {info.name} | grep -E 'Speed|Link detected'"
        raw = "\n".join([
            f"2: {info.name}: <{','.join(flags)}> mtu {st['mtu']} qdisc mq state {state_word} mode DEFAULT group default qlen 1000",
            f"    link/ether {info.mac} brd ff:ff:ff:ff:ff:ff",
            f"\tSpeed: {int((info.speed_gbps or 1) * 1000) if oper_up else 'Unknown!'}{'Mb/s' if oper_up else ''}",
            f"\tLink detected: {'yes' if oper_up else 'no'}",
        ])
    payload = {
        "interface": iid, "device": dev, "admin_state": admin, "oper_state": oper, "reason": reason,
        "mtu": st["mtu"], "intended_mtu": info.intended_mtu, "mode": info.switchport_mode,
        "running_vlan": st["vlan"], "running_allowed_vlans": st["allowed_vlans"],
        "intended_vlan": info.intended_vlan, "speed_gbps": info.speed_gbps if oper_up else None,
        "carrier": m.carrier(iid) if info.kind != "mgmt" else None,
    }
    if admin == "down":
        verdict = "fail"
        interp = (
            f"{iid} is administratively DOWN (configured shutdown). Operational state is {oper.upper()} as a consequence. "
            "Administrative state is what the device is configured to do; operational state is what the link is actually doing."
        )
        nxt = ["Confirm the far end's view (the attached port should show no carrier)", "If the shutdown is unintended, enable only this interface", "Check change records for why it was disabled"]
    elif not oper_up:
        verdict = "fail"
        interp = (
            f"{iid} is administratively UP but operationally DOWN ({reason}). The port is configured to run but has no working link. "
            "Possible causes include the far-end port being disabled, cabling/optics problems, or no signal. Check the far end before touching cables."
        )
        nxt = ["Inspect interface state on the far end of this link", "Read optical telemetry at both ends", "Trace the documented cable path"]
    else:
        verdict = "ok"
        interp = f"{iid} is administratively UP and operationally UP — the physical link is established at this port. A link that is up does not prove Layer 2/3 forwarding is correct."
        nxt = []
    if info.intended_mtu and st["mtu"] != info.intended_mtu:
        verdict = "warning" if verdict == "ok" else verdict
        interp += f" Running MTU {st['mtu']} differs from the documented intended MTU {info.intended_mtu}."
    obs = [{"kind": "interface", "id": iid, "status": "up" if oper_up else ("admin_down" if admin == "down" else "down"),
            "label": f"admin {admin} / oper {oper}", "mtu": st["mtu"]}]
    return DiagnosticResult(
        title=f"Interface state — {iid}",
        command=cmd,
        purpose="Read administrative and operational state separately.",
        raw_output=raw,
        payload=payload,
        interpretation=interp,
        limitations=[SIM_SOURCE_NOTE, "Observes this end only; the far end may report a different view."],
        observations=obs,
        verdict=verdict,
        source_id=f"sim:{dev}",
        next_steps=nxt,
    )


# ----------------------------------------------------------------------------- counters


def interface_counters(ctx: SimContext, target: dict, params: dict) -> DiagnosticResult:
    iid = target["interface"]
    _require_iface(ctx, iid)
    info = ctx.topo.ifaces[iid]
    c = dict(ctx.model.state["counters"][iid])
    dev = info.device_id
    if _is_switch(ctx, dev):
        cmd = f"show interface {info.name} counters detailed"
        raw = "\n".join([
            f"{info.name}",
            f"  RX: {c['rx_packets']:>14,} packets   {c['rx_errors']:>6} input errors   {c['rx_crc']:>6} CRC/FCS",
            f"      {c['rx_discards']:>14} discards  {c['rx_oversize']:>6} oversize (giants)",
            f"  TX: {c['tx_packets']:>14,} packets   {c['tx_discards']:>6} output discards",
        ])
    else:
        cmd = f"ip -s link show dev {info.name}"
        raw = "\n".join([
            f"2: {info.name}: mtu {ctx.model.iface_state(iid)['mtu']}",
            "    RX:  bytes  packets  errors  dropped  missed   mcast",
            f"         -      {c['rx_packets']:<8} {c['rx_errors']:<7} {c['rx_discards']:<8} 0        0",
            "    TX:  bytes  packets  errors  dropped carrier collsns",
            f"         -      {c['tx_packets']:<8} 0       {c['tx_discards']:<7} 0       0",
        ])
    issues = []
    if c["rx_crc"] or c["rx_errors"]:
        issues.append(f"{c['rx_errors']} input errors / {c['rx_crc']} CRC")
    if c["rx_oversize"]:
        issues.append(f"{c['rx_oversize']} oversize frames dropped on receive")
    if c["rx_discards"] or c["tx_discards"]:
        issues.append(f"{c['rx_discards']} rx / {c['tx_discards']} tx discards")
    if issues:
        verdict = "warning"
        interp = (
            f"Non-zero counters on {iid}: {'; '.join(issues)}. "
            + ("Oversize drops mean frames larger than this port's MTU arrived and were discarded — a Layer 2 switch drops them silently without ICMP feedback. " if c["rx_oversize"] else "")
            + "Counters are cumulative since the scenario started (all error counters were 0 at baseline)."
        )
        nxt = ["Compare MTU on both ends of this link", "Re-read counters after a test to confirm they increase"]
    else:
        verdict = "ok"
        interp = (
            f"No input errors, CRC/FCS errors, discards or oversize drops on {iid} since the scenario started. "
            "Clean counters do not rule out loss elsewhere: e.g. packets dropped by a queueing/impairment rule are not interface errors."
        )
        nxt = []
    return DiagnosticResult(
        title=f"Interface counters — {iid}",
        command=cmd,
        purpose="Read packet, error and discard counters.",
        raw_output=raw,
        payload={"interface": iid, "counters": c, "baseline_errors": 0},
        interpretation=interp,
        limitations=[SIM_SOURCE_NOTE, "Counters are cumulative; compare readings over time to see change.", "Software-injected loss (netem) does not create CRC errors."],
        observations=[{"kind": "interface", "id": iid, "status": "degraded" if issues else "up", "label": "counters " + ("non-zero" if issues else "clean")}],
        verdict=verdict,
        source_id=f"sim:{dev}",
        next_steps=nxt,
    )


# ----------------------------------------------------------------------------- VLAN


def vlan_membership(ctx: SimContext, target: dict, params: dict) -> DiagnosticResult:
    dev = target["device"]
    m = ctx.model
    rows = []
    mismatches = []
    for iid, info in ctx.topo.ifaces.items():
        if info.device_id != dev or info.kind == "mgmt" or iid not in m.state["ifaces"]:
            continue
        st = m.iface_state(iid)
        row = {
            "interface": iid, "port": info.name, "mode": info.switchport_mode,
            "running_vlan": st["vlan"], "running_allowed": st["allowed_vlans"],
            "intended_vlan": info.intended_vlan,
            "intended_allowed": list(info.intended_allowed_vlans) if info.intended_allowed_vlans else None,
            "cable_peer": ctx.topo.peer_of(iid),
        }
        row["matches_intent"] = row["running_vlan"] == row["intended_vlan"] and (row["running_allowed"] or None) == (row["intended_allowed"] or None)
        if not row["matches_intent"]:
            mismatches.append(row)
        rows.append(row)
    role = ctx.topo.devices[dev]["role"]
    if role == "access_switch":
        cmd = "show vlan brief; show interface switchport"
        members: dict[int, list[str]] = {20: [], 30: []}
        for r in rows:
            if r["mode"] == "access" and r["running_vlan"]:
                members.setdefault(r["running_vlan"], []).append(_short(r["port"]))
            elif r["mode"] == "trunk":
                for vv in r["running_allowed"] or []:
                    members.setdefault(vv, []).append(_short(r["port"]) + "(T)")
        names = {20: "APP-DATA", 30: "STORAGE"}
        lines = ["VLAN Name         Status    Ports", "---- ------------ --------- -------------------------------"]
        for vv in sorted(members):
            lines.append(f"{vv:<4} {names.get(vv, 'VLAN%04d' % vv):<12} active    {', '.join(members[vv])}")
        lines += ["", "Port      Mode    Access  Trunk-allowed"]
        for r in rows:
            lines.append(f"{_short(r['port']):<9} {r['mode']:<7} {str(r['running_vlan'] or '-'):<7} {','.join(map(str, r['running_allowed'] or [])) or '-'}")
        raw = "\n".join(lines)
    elif role == "gateway":
        cmd = "show interfaces xe-0/0/0 terse; show interfaces xe-0/0/0.20 | match VLAN"
        r = rows[0]
        raw = f"xe-0/0/0.{r['running_vlan']}   up    up   inet 192.0.2.1/24\n  Flags: SNMP-Traps  VLAN-Tag [ 0x8100.{r['running_vlan']} ]"
    else:
        cmd = f"ip -d link show dev eth0 | grep -i vlan || echo 'no 802.1Q sub-interfaces'"
        raw = "no 802.1Q sub-interfaces\n(eth0 sends untagged frames; VLAN is assigned by the attached switch access port)"
    if mismatches:
        verdict = "fail"
        parts = []
        for r in mismatches:
            if r["mode"] == "access":
                parts.append(f"{r['port']} is running access VLAN {r['running_vlan']} but the documented intent is VLAN {r['intended_vlan']} (cabled to {r['cable_peer']})")
            else:
                parts.append(f"{r['port']} allowed VLANs {r['running_allowed']} differ from intent {r['intended_allowed']}")
        interp = (
            "Running VLAN configuration differs from documented intent: " + "; ".join(parts) + ". "
            "A host on the wrong access VLAN keeps a healthy physical link but is in a different broadcast domain, so ARP to peers in the intended VLAN fails."
        )
        nxt = ["Record the diagnosis with this evidence", "Restore the intended access VLAN on only the mismatched port", "Verify: VLAN config, neighbor resolution, bidirectional reachability, throughput"]
    else:
        verdict = "ok"
        interp = f"All data ports on {dev} match the documented VLAN intent." if role != "server" else "Servers in this lab are untagged; check the attached switch port's VLAN instead."
        nxt = []
    obs = [{"kind": "interface", "id": r["interface"], "status": "mismatch", "label": f"VLAN {r['running_vlan']} ≠ intended {r['intended_vlan']}"} for r in mismatches]
    obs += [{"kind": "interface_vlan", "id": r["interface"], "status": "ok", "label": f"VLAN {r['running_vlan'] or r['running_allowed']}"} for r in rows if r["matches_intent"]]
    return DiagnosticResult(
        title=f"VLAN membership — {dev}",
        command=cmd,
        purpose="Compare running VLAN membership to documented intent.",
        raw_output=raw,
        payload={"device": dev, "ports": rows, "mismatches": mismatches},
        interpretation=interp,
        limitations=[SIM_SOURCE_NOTE, "Intent comes from the documented inventory; if the documentation is wrong, a 'mismatch' may be the documentation's error."],
        observations=obs,
        verdict=verdict,
        source_id=f"sim:{dev}",
        next_steps=nxt,
    )


# ----------------------------------------------------------------------------- neighbors


def neighbor_table(ctx: SimContext, target: dict, params: dict) -> DiagnosticResult:
    dev = target["device"]
    m = ctx.model
    role = ctx.topo.devices[dev]["role"]
    if role == "access_switch":
        entries = m.mac_table(dev)
        cmd = "show mac address-table dynamic"
        lines = ["VLAN  MAC Address        Type     Port", "----  -----------------  -------  ---------"]
        lines += [f"{e['vlan']:<5} {e['mac']:<18} dynamic  {_short(e['port'])}" for e in entries]
        raw = "\n".join(lines) if entries else "\n".join(lines + ["(no entries)"])
        expected = [h for h in ("srv-a", "srv-b", "gw-1")]
        notes = []
        for e in entries:
            peer = ctx.topo.find_iface_by_ip({"srv-a": "192.0.2.11", "srv-b": "192.0.2.12", "gw-1": "192.0.2.1"}[e["host"]])
            if e["vlan"] != 20:
                notes.append(f"{e['host']} ({e['mac']}) is learned in VLAN {e['vlan']} on {e['port']}, not VLAN 20")
        verdict = "warning" if notes else "info"
        interp = (
            ("MAC table shows: " + "; ".join(notes) + ". The switch sees the host, but in a different VLAN than its peers.")
            if notes else f"{len(entries)} dynamic entries. Hosts are learned in the expected VLANs where their links are up."
        )
        payload = {"device": dev, "mac_entries": entries, "observations": notes, "expected_hosts": expected}
        nxt = ["Inspect VLAN membership on this switch"] if notes else []
    else:
        table = m.state["neighbors"].get(dev, {})
        cmd = "ip neigh show dev eth0" if role == "server" else "show arp"
        lines = []
        entries = []
        for ip, ent in sorted(table.items()):
            entries.append({"ip": ip, **ent})
            if ent["mac"]:
                lines.append(f"{ip} lladdr {ent['mac']} {ent['state']}")
            else:
                lines.append(f"{ip} {ent['state']}")
        raw = "\n".join(lines) or "(empty)"
        bad = [e for e in entries if e["state"] in ("FAILED", "INCOMPLETE")]
        stale = [e for e in entries if e["state"] == "STALE"]
        if bad:
            verdict = "fail"
            interp = (
                f"Neighbor resolution failed for {', '.join(e['ip'] for e in bad)}: {dev} sent ARP/ND requests and got no answer. "
                "The peer is not reachable at Layer 2 from this host — possible causes include a down link, the peer in a different VLAN, or the peer host itself."
            )
            nxt = ["Inspect interface state along the path", "Inspect VLAN membership on both access switches"]
        elif stale:
            verdict = "info"
            interp = f"Entries for {', '.join(e['ip'] for e in stale)} are STALE: cached but not recently confirmed. STALE is not a failure; run a reachability probe to refresh."
            nxt = ["Run a reachability probe, then re-read the neighbor table"]
        else:
            verdict = "ok"
            interp = "All neighbor entries are resolved (REACHABLE)."
            nxt = []
        payload = {"device": dev, "neighbors": entries}
    obs = []
    if role != "access_switch":
        for e in payload["neighbors"]:
            peer = ctx.topo.find_iface_by_ip(e["ip"])
            if peer:
                obs.append({"kind": "neighbor", "id": f"{dev}->{peer.device_id}", "status": "up" if e["state"] == "REACHABLE" else ("down" if e["state"] in ("FAILED", "INCOMPLETE") else "unknown"), "label": f"ARP {e['state']}"})
    return DiagnosticResult(
        title=f"Neighbor table — {dev}",
        command=cmd,
        purpose="Show ARP/ND or MAC-learning state.",
        raw_output=raw,
        payload=payload,
        interpretation=interp,
        limitations=[SIM_SOURCE_NOTE, "Neighbor/MAC entries age out; absence of an entry can simply mean no recent traffic."],
        observations=obs,
        verdict=verdict,
        source_id=f"sim:{dev}",
        next_steps=nxt,
    )


# ----------------------------------------------------------------------------- routing


def routing(ctx: SimContext, target: dict, params: dict) -> DiagnosticResult:
    dev = target["device"]
    role = ctx.topo.devices[dev]["role"]
    m = ctx.model
    if role == "server":
        iid = _host_iface(ctx, dev)
        info = ctx.topo.ifaces[iid]
        linkdown = "" if m.oper_up(iid) else " linkdown"
        routes = [
            {"prefix": "default", "via": "192.0.2.1", "dev": "eth0", "flags": linkdown.strip() or None},
            {"prefix": "192.0.2.0/24", "via": None, "dev": "eth0", "src": info.ipv4, "flags": linkdown.strip() or None},
            {"prefix": "198.51.100.0/24", "via": None, "dev": "bmc0 (out-of-band, separate)", "flags": None},
        ]
        cmd = "ip route show"
        raw = "\n".join([
            f"default via 192.0.2.1 dev eth0 proto static{linkdown}",
            f"192.0.2.0/24 dev eth0 proto kernel scope link src {info.ipv4}{linkdown}",
        ])
        interp = (
            "The peer server (192.0.2.0/24) is on-link via eth0: traffic between Server A and Server B is switched at Layer 2, "
            "not routed. Routing is not the cause of a same-subnet failure unless the connected route is missing."
            + (" Routes are flagged 'linkdown' because eth0 has no carrier." if linkdown else "")
        )
        verdict = "info" if not linkdown else "warning"
    elif role == "gateway":
        routes = [{"prefix": "192.0.2.0/24", "via": None, "dev": "xe-0/0/0.20"}, {"prefix": "198.51.100.0/24", "via": None, "dev": "mgmt0"}]
        cmd = "show route terse"
        raw = "192.0.2.0/24      *[Direct/0] > via xe-0/0/0.20\n192.0.2.1/32      *[Local/0]  Local via xe-0/0/0.20\n198.51.100.0/24   *[Direct/0] > via mgmt0 (mgmt instance)"
        interp = "Gateway has the connected VLAN 20 subnet. Same-subnet traffic between servers does not traverse the gateway."
        verdict = "info"
    else:
        routes = [{"prefix": "0.0.0.0/0", "via": "198.51.100.254", "dev": "mgmt0", "vrf": "management"}]
        cmd = "show ip route vrf management"
        raw = "0.0.0.0/0, ubest/mbest: 1/0\n    *via 198.51.100.254, mgmt0, [1/0], static\n(Data-plane: Layer 2 access switch — no routed data interfaces)"
        interp = f"{dev} is a Layer 2 access switch; it only has a management-VRF route. Data traffic through it is bridged, so routing tables on this device are not relevant to server-to-server forwarding."
        verdict = "info"
    return DiagnosticResult(
        title=f"Routing information — {dev}",
        command=cmd,
        purpose="Confirm whether the destination is on-link or routed.",
        raw_output=raw,
        payload={"device": dev, "routes": routes},
        interpretation=interp,
        limitations=[SIM_SOURCE_NOTE],
        observations=[],
        verdict=verdict,
        source_id=f"sim:{dev}",
    )


# ----------------------------------------------------------------------------- throughput


def throughput(ctx: SimContext, target: dict, params: dict) -> DiagnosticResult:
    src, dst = target["src"], target["dst"]
    dur, par = params["duration_s"], params["parallel"]
    m = ctx.model
    src_if, dst_if = _host_iface(ctx, src), _host_iface(ctx, dst)
    dst_ip, src_ip = _ip(ctx, dst, 4), _ip(ctx, src, 4)
    cmd = f"iperf3 -c {dst_ip} -t {dur} -P {par} --connect-timeout 3000"
    lines = [f"Connecting to host {dst_ip}, port 5201"]
    syn = m.forward(src_if, dst_if, 60, df=True)
    payload: dict[str, Any] = {"src": src, "dst": dst, "duration_s": dur, "parallel": par, "protocol": "TCP"}
    if not syn.delivered:
        m.resolve_neighbor(src, src_if, dst_ip)
        lines.append("iperf3: error - unable to connect to server - server may have stopped running or use a different port, firewall issue, etc.: No route to host")
        payload.update({"connected": False, "sender_gbps": 0.0, "receiver_gbps": 0.0, "retransmits": None, "intervals": []})
        return DiagnosticResult(
            title=f"Throughput {src} → {dst} ({dur}s, P{par})",
            command=cmd, purpose="Bounded TCP throughput test.", raw_output="\n".join(lines), payload=payload,
            interpretation="The TCP connection could not be established, so no throughput was measured. This is a reachability problem, not a performance result.",
            limitations=[SIM_SOURCE_NOTE, "Simplified throughput model — not a prediction of real TCP performance."],
            observations=[{"kind": "reachability", "id": f"{src}->{dst}", "status": "down", "label": "TCP connect failed"}],
            verdict="fail", source_id=f"sim:{src}", sim_duration_ms=3000,
            next_steps=["Establish basic reachability first"],
        )
    src_mtu, dst_mtu = m.iface_state(src_if)["mtu"], m.iface_state(dst_if)["mtu"]
    mss = min(src_mtu, dst_mtu) - TCP_V4_OVERHEAD
    data = m.forward(src_if, dst_if, mss + TCP_V4_OVERHEAD, df=True)
    speed = min(ctx.topo.ifaces[i].speed_gbps or 25 for i in data.path if ctx.topo.ifaces[i].speed_gbps) if data.path else 25
    lines.append(f"[  5] local {src_ip} port 43122 connected to {dst_ip} port 5201")
    lines.append("[ ID] Interval           Transfer     Bitrate         Retr")
    intervals = []
    loss = sum(i["loss_pct"] for i in m.impairment_loss(data.egress)) if data.delivered else 0.0
    if data.stage == "mtu_drop":
        stalled = True
        rate = 0.0
        retr = 6 * par
    else:
        stalled = False
        stream = min(1.0, 0.94 + 0.02 * (par - 1))
        rate = speed * tcp_efficiency(mss) * stream * loss_throughput_factor(loss)
        pkts = rate * 1e9 * dur / 8 / mss
        retr = int(round(pkts * loss / 100.0))
    for t in range(dur):
        if stalled:
            g = 0.0 if t else 0.0017
        else:
            g = rate * (1 + ctx.rng.uniform(-0.006, 0.006))
        intervals.append({"start_s": t, "end_s": t + 1, "gbps": round(g, 3)})
        gbytes = g / 8
        lines.append(f"[  5]   {t:.2f}-{t + 1:.2f}  sec  {gbytes:.2f} GBytes  {g:.2f} Gbits/sec")
    avg = round(sum(i["gbps"] for i in intervals) / len(intervals), 3)
    if stalled and data.drop_iface:
        m._bump(data.drop_iface, "rx_oversize", 12 * dur)
    total_gb = avg * dur / 8
    lines.append("- - - - - - - - - - - - - - - - - - - - - - - - -")
    lines.append(f"[  5]   0.00-{dur:.2f}  sec  {total_gb:.2f} GBytes  {avg:.2f} Gbits/sec  {retr:>4}             sender")
    lines.append(f"[  5]   0.00-{dur:.2f}  sec  {total_gb:.2f} GBytes  {avg:.2f} Gbits/sec                  receiver")
    payload.update({
        "connected": True, "sender_gbps": avg, "receiver_gbps": avg, "retransmits": retr, "intervals": intervals,
        "mss_bytes": mss, "link_speed_gbps": speed, "stalled": stalled,
    })
    if stalled:
        verdict, status = "fail", "degraded"
        interp = (
            f"The TCP handshake succeeded (small packets get through) but data transfer stalled at ~0 Gbit/s with retransmissions. "
            f"Full-size segments ({mss + TCP_V4_OVERHEAD} B packets, MSS {mss}) are not being delivered. Classic signature of an MTU mismatch along the path."
        )
        nxt = ["Run an MTU probe with small and large DF payloads", "Inspect interface MTU on each hop"]
    elif loss > 0:
        verdict, status = "warning", "degraded"
        interp = f"Average {avg:.2f} Gbit/s with {retr} retransmissions — far below the {speed:g} Gbit/s link rate. Packet loss on the path forces TCP to back off; small amounts of loss have a large throughput impact."
        nxt = ["Compare to the baseline throughput run", "Locate the loss: interface counters per hop, impairment rules"]
    else:
        verdict, status = "ok", "up"
        interp = f"Average {avg:.2f} Gbit/s over {dur} s with {retr} retransmissions on a {speed:g} Gbit/s path (MSS {mss})."
        nxt = []
    return DiagnosticResult(
        title=f"Throughput {src} → {dst} ({dur}s, P{par})",
        command=cmd,
        purpose="Bounded TCP throughput test.",
        raw_output="\n".join(lines),
        payload=payload,
        interpretation=interp,
        limitations=[
            SIM_SOURCE_NOTE,
            "Throughput is computed by a simplified model (link rate × framing efficiency × loss factor). It is not a prediction of real TCP behavior.",
            f"Test bounded to {dur} s simulated time.",
        ],
        observations=[{"kind": "reachability", "id": f"{src}->{dst}", "status": status, "label": f"{avg:.2f} Gbit/s"}],
        verdict=verdict,
        source_id=f"sim:{src}",
        sim_duration_ms=dur * 1000 + 500,
        next_steps=nxt,
    )


# ----------------------------------------------------------------------------- MTU probe


def mtu_probe(ctx: SimContext, target: dict, params: dict) -> DiagnosticResult:
    src, dst = target["src"], target["dst"]
    v, count = params["ip_version"], params["count"]
    m = ctx.model
    src_if, dst_if = _host_iface(ctx, src), _host_iface(ctx, dst)
    dst_ip = _ip(ctx, dst, v)
    overhead = ICMP_V4_OVERHEAD if v == 4 else ICMP_V6_OVERHEAD
    results = []
    lines = []
    cmds = []
    resolved, _ = m.resolve_neighbor(src, src_if, dst_ip) if m.oper_up(src_if) else (False, None)
    for size in sorted(set(params["payload_sizes"])):
        packet = size + overhead
        c = f"ping{' -6' if v == 6 else ''} -M do -c {count} -s {size} {dst_ip}"
        cmds.append(c)
        lines.append(f"$ {c}")
        if not resolved:
            outcome, recv = "unreachable", 0
            lines.append("  Destination Host Unreachable ×%d" % count)
        elif packet > m.iface_state(src_if)["mtu"]:
            outcome, recv = "local_error", 0
            lines.append(f"  ping: local error: message too long, mtu={m.iface_state(src_if)['mtu']}")
        else:
            recv = 0
            for _ in range(count):
                ok, _fr = m.send(src_if, dst_if, packet, True, ctx.rng)
                if ok:
                    ok, _ = m.send(dst_if, src_if, packet, True, ctx.rng)
                recv += int(ok)
            outcome = "pass" if recv == count else ("partial" if recv else "no_reply")
            lines.append(f"  {count} packets transmitted, {recv} received, {round(100 * (count - recv) / count):g}% packet loss")
        results.append({"payload_bytes": size, "packet_bytes": packet, "sent": count, "received": recv, "outcome": outcome})
    passing = [r for r in results if r["outcome"] == "pass"]
    failing = [r for r in results if r["outcome"] in ("no_reply", "partial")]
    largest = max((r["packet_bytes"] for r in passing), default=None)
    smallest_fail = min((r["packet_bytes"] for r in failing), default=None)
    if not resolved:
        verdict, interp = "fail", "Neighbor resolution failed, so no size could be tested. Fix basic reachability first."
        status = "down"
    elif failing and passing:
        verdict, status = "fail", "degraded"
        interp = (
            f"Packets up to {largest} B (IPv{v}, DF) are delivered; {smallest_fail} B packets are not. "
            "Small probes succeeding while larger ones fail is the signature of an MTU mismatch somewhere on the path. "
            "'Ping works' with default 56-byte payloads therefore does not show that all traffic works. "
            "Layer 2 switches discard oversize frames silently — no ICMP 'Fragmentation Needed' is returned."
        )
    elif failing:
        verdict, status = "fail", "down"
        interp = "No tested size was delivered even though neighbor resolution succeeded; investigate filters or loss before MTU."
    else:
        verdict, status = "ok", "up"
        interp = f"All tested sizes up to {largest} B (IPv{v}, DF set) were delivered end-to-end."
    payload = {
        "src": src, "dst": dst, "dst_ip": dst_ip, "ip_version": v, "dont_fragment": True, "count_per_size": count,
        "overhead_bytes": overhead, "overhead_assumption": (
            "IPv4 20 B + ICMP 8 B = 28 B (no IP options)" if v == 4 else "IPv6 40 B + ICMPv6 8 B = 48 B (no extension headers)"
        ),
        "results": results, "largest_passing_packet_bytes": largest, "smallest_failing_packet_bytes": smallest_fail,
        "source_mtu": m.iface_state(src_if)["mtu"],
    }
    return DiagnosticResult(
        title=f"MTU probe {src} → {dst} (IPv{v}, DF)",
        command=" ; ".join(cmds),
        purpose="Find the largest packet the path delivers with fragmentation disabled.",
        raw_output="\n".join(lines),
        payload=payload,
        interpretation=interp,
        limitations=[
            SIM_SOURCE_NOTE,
            "MTU in this lab is modeled as the IP (L3) MTU on every hop; some platforms configure an L2 frame MTU that includes Ethernet headers.",
            "Probe sizes are payload bytes; packet size = payload + stated header overhead.",
        ],
        observations=[{"kind": "reachability", "id": f"{src}->{dst}", "status": status, "label": f"max {largest or '—'} B DF"}],
        verdict=verdict,
        source_id=f"sim:{src}",
        sim_duration_ms=len(results) * count * 1000,
        next_steps=["Inspect interface state (MTU) on each hop of the documented path", "Inspect counters for oversize drops"] if failing else [],
    )


# ----------------------------------------------------------------------------- optics


def classify(value: float | None, th: dict[str, Any] | None) -> str:
    if value is None:
        return "not_reported"
    if not th:
        return "unknown_thresholds"
    la, lw, hw, ha = (th.get(k) for k in ("low_alarm", "low_warning", "high_warning", "high_alarm"))
    if la is not None and value <= la:
        return "low_alarm"
    if ha is not None and value >= ha:
        return "high_alarm"
    if lw is not None and value <= lw:
        return "low_warning"
    if hw is not None and value >= hw:
        return "high_warning"
    if None in (la, lw, hw, ha):
        return "partial_thresholds"
    return "normal"


SEVERITY = {"normal": 0, "partial_thresholds": 1, "unknown_thresholds": 1, "not_reported": 1, "low_warning": 2, "high_warning": 2, "low_alarm": 3, "high_alarm": 3}


def _read_optic(ctx: SimContext, iid: str) -> dict[str, Any]:
    rec = ctx.optics_db.get(iid)
    if rec is None:
        return {"interface": iid, "present": False, "dom_supported": False, "reason": "No pluggable optic on this port (copper/DAC or management)."}
    reading = ctx.model.optic_reading(iid, rec["dom_supported"])
    th = rec.get("thresholds") or None
    metrics = {}
    for key in ("tx_power_dbm", "rx_power_dbm", "temperature_c", "voltage_v", "bias_ma"):
        val = getattr(reading, key)
        mth = (th or {}).get(key)
        metrics[key] = {"value": val, "thresholds": mth, "status": classify(val, mth)}
    worst = max((m["status"] for m in metrics.values()), key=lambda s: SEVERITY.get(s, 0))
    return {
        "interface": iid, "present": True, "dom_supported": rec["dom_supported"],
        "optic": {k: rec[k] for k in ("id", "vendor", "part_number", "serial", "form_factor", "standard", "wavelength_nm", "threshold_source")},
        "thresholds_available": th is not None, "metrics": metrics, "flags": reading.flags, "overall": worst,
    }


def _fmt(v: float | None, unit: str, nd: int = 2) -> str:
    return "N/A" if v is None else f"{v:.{nd}f} {unit}"


def _render_optic(ctx: SimContext, r: dict[str, Any]) -> tuple[str, str]:
    iid = r["interface"]
    info = ctx.topo.ifaces[iid]
    if not r["present"]:
        return f"show interface {info.name} transceiver details", f"{info.name}\n    transceiver is not present (no DOM-capable optic)"
    mt = r["metrics"]
    if _is_switch(ctx, info.device_id):
        cmd = f"show interface {info.name} transceiver details"
        lines = [
            info.name, "    transceiver is present", f"    type is {r['optic']['standard']}", f"    name is {r['optic']['vendor']}",
            f"    part number is {r['optic']['part_number']}", f"    serial number is {r['optic']['serial']}",
            f"    wavelength is {r['optic']['wavelength_nm']} nm", "",
            "               Current        Alarm High   Alarm Low    Warn High    Warn Low",
            "  " + "-" * 76,
        ]
        for key, label, unit in (("temperature_c", "Temperature", "C"), ("voltage_v", "Voltage", "V"), ("bias_ma", "Current", "mA"), ("tx_power_dbm", "Tx Power", "dBm"), ("rx_power_dbm", "Rx Power", "dBm")):
            th = mt[key]["thresholds"] or {}
            flag = {"low_warning": " -", "low_alarm": " --", "high_warning": " +", "high_alarm": " ++"}.get(mt[key]["status"], "")
            row = f"  {label:<12} {_fmt(mt[key]['value'], unit):<14}"
            for tk in ("high_alarm", "low_alarm", "high_warning", "low_warning"):
                row += f" {_fmt(th.get(tk), unit):<12}"
            lines.append(row + flag)
        lines.append("  Note: ++ high-alarm, + high-warning, -- low-alarm, - low-warning")
        if r["flags"].get("tx_disabled"):
            lines.append("  Tx laser disabled (port administratively down)")
        if r["flags"].get("rx_los"):
            lines.append("  Rx loss of signal (value shown is module measurement floor)")
        return cmd, "\n".join(lines)
    cmd = f"ethtool -m {info.name}"

    def mw(dbm):
        return "N/A" if dbm is None else f"{10 ** (dbm / 10):.4f} mW / {dbm:.2f} dBm"

    lines = [
        "\tIdentifier                                : 0x03 (SFP)",
        f"\tTransceiver type                          : {r['optic']['standard']}",
        f"\tVendor name                               : {r['optic']['vendor']}",
        f"\tVendor PN                                 : {r['optic']['part_number']}",
        f"\tVendor SN                                 : {r['optic']['serial']}",
        f"\tLaser wavelength                          : {r['optic']['wavelength_nm']}nm",
        f"\tLaser bias current                        : {_fmt(mt['bias_ma']['value'], 'mA', 3)}",
        f"\tLaser output power                        : {mw(mt['tx_power_dbm']['value'])}",
        f"\tReceiver signal average optical power     : {mw(mt['rx_power_dbm']['value'])}",
        f"\tModule temperature                        : {_fmt(mt['temperature_c']['value'], 'degrees C')}",
        f"\tModule voltage                            : {_fmt(mt['voltage_v']['value'], 'V', 4)}",
        f"\tAlarm/warning flags implemented           : {'Yes' if r['thresholds_available'] else 'No'}",
    ]
    if r["thresholds_available"]:
        for key, label in (("rx_power_dbm", "Laser rx power"), ("tx_power_dbm", "Laser output power")):
            th = mt[key]["thresholds"]
            lines.append(f"\t{label} high alarm threshold   : {th['high_alarm']:.2f} dBm")
            lines.append(f"\t{label} low warning threshold  : {th['low_warning']:.2f} dBm")
            lines.append(f"\t{label} low alarm threshold    : {th['low_alarm']:.2f} dBm")
            status = mt[key]["status"]
            lines.append(f"\t{label} low warning            : {'On' if status in ('low_warning', 'low_alarm') else 'Off'}")
    return cmd, "\n".join(lines)


def _budget(ctx: SimContext, iid: str) -> dict[str, Any] | None:
    lid = ctx.topo.link_of.get(iid)
    if not lid:
        return None
    link = ctx.topo.links[lid]
    fiber_m = sum(ctx.topo.cables[c].nominal_length_m or 0 for c in link.path.cables if ctx.topo.cables[c].media == "fiber")
    ftypes = {ctx.topo.cables[c].fiber_type for c in link.path.cables if ctx.topo.cables[c].fiber_type}
    att = max((FIBER_ATTENUATION_DB_PER_KM.get(f, 0) for f in ftypes), default=0)
    mated = len(link.path.mated_points)
    return {
        "fiber_length_m": fiber_m, "fiber_types": sorted(ftypes), "attenuation_db_per_km": att,
        "mated_pairs": mated, "assumed_loss_per_mated_pair_db": MATED_PAIR_LOSS_DB,
        "estimated_budget_db": round(fiber_m / 1000 * att + mated * MATED_PAIR_LOSS_DB, 2),
        "basis": "Documented registry lengths × nominal attenuation + assumed mated-pair loss. A planning estimate, not a measurement.",
    }


def optical_telemetry(ctx: SimContext, target: dict, params: dict) -> DiagnosticResult:
    iid = target["interface"]
    _require_iface(ctx, iid)
    local = _read_optic(ctx, iid)
    peer_iid = ctx.topo.peer_of(iid)
    remote = _read_optic(ctx, peer_iid) if peer_iid else None
    cmd_l, raw_l = _render_optic(ctx, local)
    blocks = [f"### {iid}\n$ {cmd_l}\n{raw_l}"]
    cmds = [cmd_l]
    if remote is not None:
        cmd_r, raw_r = _render_optic(ctx, remote)
        blocks.append(f"### {peer_iid} (link peer)\n$ {cmd_r}\n{raw_r}")
        cmds.append(f"[{peer_iid}] {cmd_r}")
    estimates = []
    for rx_side, tx_side in ((local, remote), (remote, local)):
        if not rx_side or not tx_side or not rx_side.get("present") or not tx_side.get("present"):
            continue
        tx = tx_side["metrics"]["tx_power_dbm"]["value"]
        rx = rx_side["metrics"]["rx_power_dbm"]["value"]
        if tx is None or rx is None or rx_side["flags"].get("rx_los"):
            continue
        same_wl = tx_side["optic"]["wavelength_nm"] == rx_side["optic"]["wavelength_nm"]
        if not same_wl:
            continue
        estimates.append({
            "direction": f"{tx_side['interface']} → {rx_side['interface']}",
            "tx_interface": tx_side["interface"], "rx_interface": rx_side["interface"],
            "tx_dbm": tx, "rx_dbm": rx, "estimated_loss_db": round(tx - rx, 2),
            "label": "ESTIMATE from DOM readings — not an OTDR trace or certified loss test",
        })
    budget = _budget(ctx, iid)
    statuses = [local.get("overall")] + ([remote.get("overall")] if remote else [])
    worst = max((s for s in statuses if s), key=lambda s: SEVERITY.get(s, 0), default="not_reported")
    parts = []
    nxt: list[str] = []
    for side in (local, remote):
        if side is None:
            continue
        if not side["present"]:
            parts.append(f"{side['interface']}: no DOM-capable optic — optical telemetry unavailable (not zero).")
            continue
        rxm = side["metrics"]["rx_power_dbm"]
        txm = side["metrics"]["tx_power_dbm"]
        th = rxm["thresholds"]
        if side["flags"].get("rx_los"):
            parts.append(f"{side['interface']}: receiver reports loss of signal (no light from the far end).")
        elif rxm["status"] in ("low_warning", "low_alarm"):
            parts.append(
                f"{side['interface']}: Rx {rxm['value']:.2f} dBm is below this module's low-{'warning' if rxm['status'] == 'low_warning' else 'alarm'} threshold "
                f"({th['low_warning' if rxm['status'] == 'low_warning' else 'low_alarm']:.2f} dBm)."
            )
        elif rxm["status"] == "unknown_thresholds":
            parts.append(f"{side['interface']}: Rx {rxm['value']:.2f} dBm reported, but the module provides no thresholds — status UNKNOWN (not assumed healthy).")
        elif rxm["status"] == "normal":
            parts.append(f"{side['interface']}: Rx {rxm['value']:.2f} dBm within its module thresholds.")
        if side["flags"].get("tx_disabled"):
            parts.append(f"{side['interface']}: Tx laser disabled (port administratively down) — Tx power not reported.")
        elif txm["status"] in ("low_warning", "low_alarm"):
            parts.append(f"{side['interface']}: Tx {txm['value']:.2f} dBm is low for this module.")
    for e in estimates:
        b = budget["estimated_budget_db"] if budget else None
        parts.append(
            f"Estimated loss {e['direction']}: {e['estimated_loss_db']:.2f} dB"
            + (f" vs. documented planning budget ≈ {b:.2f} dB" if b is not None else "") + "."
        )
    low = any(s and s.get("present") and s["metrics"]["rx_power_dbm"]["status"] in ("low_warning", "low_alarm") for s in (local, remote))
    if low:
        parts.append(
            "Low receive power is evidence of a degraded optical path toward that receiver. It does not by itself identify the failed component: "
            "candidates include a contaminated or damaged connector, excess loss at a mated pair or bend, a weak remote transmitter, an incorrect optic/fiber type, or a sensor error."
        )
        nxt = [
            "Compare the remote transmitter's Tx power (is light leaving at normal power?)",
            "Compare both directions — is only one fiber of the pair affected?",
            "Trace the documented cable path to list every mated connection point",
            "Inspect connector end-faces with a fiber inspection scope at each mated point (never look into a connector)",
            "Clean only where inspection shows contamination, re-inspect, then re-read optics",
        ]
    verdict = "fail" if worst in ("low_alarm", "high_alarm") else "warning" if worst in ("low_warning", "high_warning") else "info" if worst in ("unknown_thresholds", "not_reported", "partial_thresholds") else "ok"
    obs = []
    for side in (local, remote):
        if side and side.get("present"):
            st = side["overall"]
            obs.append({"kind": "optic", "id": side["interface"], "status": "degraded" if SEVERITY.get(st, 0) >= 2 else ("unknown" if SEVERITY.get(st, 0) == 1 else "up"),
                        "label": f"Rx {_fmt(side['metrics']['rx_power_dbm']['value'], 'dBm')}"})
    return DiagnosticResult(
        title=f"Optical telemetry — {iid}" + (f" ⇄ {peer_iid}" if peer_iid else ""),
        command=" ; ".join(cmds),
        purpose="Read DOM values with each module's own thresholds, from both link ends.",
        raw_output="\n\n".join(blocks),
        payload={"interface": iid, "peer_interface": peer_iid, "local": local, "remote": remote, "loss_estimates": estimates, "planning_budget": budget, "overall": worst},
        interpretation=" ".join(parts) if parts else "No optical telemetry available on this link.",
        limitations=[
            SIM_SOURCE_NOTE,
            "DOM readings have limited accuracy (often a few dB); compare trends and both ends rather than single absolute values.",
            "Thresholds are per module. Where a module reports none, status is UNKNOWN — no universal thresholds are substituted.",
            "Loss estimates pair Tx and Rx read in the same collection, same wavelength; they are not OTDR results or certified tests.",
        ],
        observations=obs,
        verdict=verdict,
        source_id=f"sim:{ctx.topo.ifaces[iid].device_id}",
        sim_duration_ms=2000,
        next_steps=nxt,
    )


# ----------------------------------------------------------------------------- cable trace


def cable_trace(ctx: SimContext, target: dict, params: dict) -> DiagnosticResult:
    iid = target["interface"]
    _require_iface(ctx, iid, allow_passive=True)
    path = ctx.topo.trace(iid)
    lines = [f"Documented path from {iid}:"]
    for h in path.hops:
        prefix = {"interface": "  ●", "cable": "  │", "patch_mapping": "  ⇄", "gap": "  ⟂"}[h.kind]
        lines.append(f"{prefix} {h.label}" + (f"   ({h.detail})" if h.detail else ""))
    lines.append("")
    lines.append("Result: " + ("complete path to " + path.end if path.complete else f"INCOMPLETE — {path.gap_reason}"))
    modeled = [c for c in path.cables if ctx.topo.cables[c].is_modeled_only]
    labels = [c for c in path.cables if ctx.topo.cables[c].label_status != "labeled"]
    interp = (
        f"Records show {len(path.cables)} cable segment(s) and {len(path.mated_points)} patch-panel mated connection(s) between {iid} and {path.end or 'an unrecorded endpoint'}. "
        + ("Every mated point is a place where contamination or excess loss can occur. " if path.mated_points else "")
        + (f"Label issues recorded on: {', '.join(labels)}. " if labels else "")
        + "This is the documented path; it does not prove the physical cabling matches the records."
    )
    return DiagnosticResult(
        title=f"Documented cable path — {iid}",
        command=f"fiberscope trace --from {iid}   # cable registry query",
        purpose="List every documented segment and mated point along the physical path.",
        raw_output="\n".join(lines),
        payload={"path": path.as_dict(), "modeled_cables": modeled, "label_issues": labels},
        interpretation=interp,
        limitations=[
            "Source: documented cable registry (not a live device query).",
            "Patch panels and trunk segments are modeled; in the Linux lab the real link is a veth pair.",
            "Path tracing never infers missing links; gaps are reported as gaps.",
        ],
        observations=[{"kind": "trace", "id": iid, "status": "info", "label": "documented path", "cables": path.cables, "mated_points": path.mated_points}],
        verdict="info" if path.complete else "warning",
        source_id="registry:cable-inventory",
        sim_duration_ms=0,
    )


# ----------------------------------------------------------------------------- impairments


LAB_IFNAMES = {"asw-1:Ethernet1/49": "fs-sw1-up", "asw-2:Ethernet1/49": "fs-sw2-up", "asw-1:Ethernet1/1": "fs-sw1-p1", "asw-2:Ethernet1/1": "fs-sw2-p1"}


def impairment_inspect(ctx: SimContext, target: dict, params: dict) -> DiagnosticResult:
    iid = target["interface"]
    _require_iface(ctx, iid)
    lab_if = LAB_IFNAMES.get(iid, iid.split(":")[1])
    rules = [i for i in ctx.model.state["impairments"] if i["egress_iface"] == iid]
    stats = ctx.model.state["impairment_stats"]
    lines = []
    for r in rules:
        s = stats.get(r["id"], {"sent": 0, "dropped": 0})
        lines.append(f"qdisc netem 8001: root refcnt 2 limit 1000 loss {r['loss_pct']:g}%   # owner={r['owner']} id={r['id']}")
        lines.append(f" Sent {s['sent'] * 98} bytes {s['sent']} pkt (dropped {s['dropped']}, overlimits 0 requeues 0)")
    if not rules:
        lines.append("qdisc mq 0: root")
        lines.append("qdisc fq_codel 0: parent :1 limit 10240p flows 1024 quantum 1514 target 5ms interval 100ms")
    payload = {"interface": iid, "lab_interface": lab_if, "rules": [{**r, **stats.get(r["id"], {"sent": 0, "dropped": 0})} for r in rules]}
    if rules:
        interp = (
            f"An owned netem impairment rule is active on {iid} egress: {', '.join(f'{r['loss_pct']:g}% loss ({r['id']})' for r in rules)}. "
            "This lab rule drops packets in software; it does not create CRC/interface errors, which is why counters can look clean while loss is present."
        )
        verdict, nxt = "fail", ["Record the diagnosis", "Remove only the owned impairment rule", "Re-run the same 100-probe test used at baseline"]
    else:
        interp = f"No impairment rules on {iid}; default queueing only."
        verdict, nxt = "ok", []
    return DiagnosticResult(
        title=f"Lab impairment rules — {iid}",
        command=f"tc -s qdisc show dev {lab_if}   # lab-equivalent interface",
        purpose="List traffic-control rules, including FiberScope-owned impairments.",
        raw_output="\n".join(lines),
        payload=payload,
        interpretation=interp,
        limitations=[SIM_SOURCE_NOTE, "Impairment rules are a lab-control mechanism; production devices do not expose this."],
        observations=[{"kind": "interface", "id": iid, "status": "degraded" if rules else "up", "label": f"netem {rules[0]['loss_pct']:g}% loss" if rules else "no impairment"}],
        verdict=verdict,
        source_id=f"sim:lab-control:{ctx.topo.ifaces[iid].device_id}",
        next_steps=nxt,
    )


# ----------------------------------------------------------------------------- connector inspection


def inspection_points(topo: Topology) -> list[str]:
    pts: list[str] = []
    for link in topo.links.values():
        if link.media != "fiber":
            continue
        for p in [link.a] + link.path.mated_points + [link.b]:
            if p not in pts:
                pts.append(p)
    return pts


def connector_inspection(ctx: SimContext, target: dict, params: dict) -> DiagnosticResult:
    loc = target["location"]
    if loc not in inspection_points(ctx.topo):
        raise ActionError("invalid_target", f"'{loc}' is not a documented fiber connection point.")
    dirty = [c for c in ctx.model.state["contamination"] if c["point"] == loc]
    cable_at = ctx.topo.cable_at.get(loc)
    cable = cable_at[0] if cable_at else "?"
    if dirty:
        result = "FAIL"
        zones = ["Zone A (core):     contamination observed (particulate/film)", "Zone B (cladding): debris present", "Zone C/D:          no defects observed"]
        interp = (
            f"Inspection at {loc} (connector of {cable}) records contamination in the core zone. Contamination at a mated pair adds loss and is a plausible cause of low receive power. "
            "Recommended procedure: clean, then re-inspect before reconnecting; re-read optics afterwards."
        )
        verdict, status = "fail", "degraded"
        nxt = ["Clean the connector at this point (recorded procedure)", "Re-inspect, then re-read optical telemetry"]
    else:
        result = "PASS"
        zones = ["Zone A (core):     no defects observed", "Zone B (cladding): no defects observed", "Zone C/D:          no defects observed"]
        interp = f"Inspection at {loc} (connector of {cable}) records a clean end-face. This point is unlikely to be the source of excess loss."
        verdict, status = "ok", "up"
        nxt = []
    raw = "\n".join([
        f"Fiber inspection record (simulated) — {loc}",
        f"Connector: {cable} at {loc}",
        "Tool: video inspection probe (fiber scope) — operator never looks into connectors or ports",
        *zones,
        f"Result: {result}",
    ])
    return DiagnosticResult(
        title=f"Connector inspection — {loc}",
        command=f"inspection-record --location {loc}   # recorded procedure, video probe",
        purpose="Record an inspection-scope check at a mated connection point.",
        raw_output=raw,
        payload={"location": loc, "cable": cable, "result": result, "zones": zones},
        interpretation=interp,
        limitations=[
            "Simulated inspection record — in a real environment this is a physical step using a video inspection probe.",
            "Safety: never look into a fiber connector or port; treat all fibers as potentially live.",
        ],
        observations=[{"kind": "mated_point", "id": loc, "status": status, "label": f"scope {result}"}],
        verdict=verdict,
        source_id="sim:field-procedure",
        sim_duration_ms=120_000,
        next_steps=nxt,
    )


COLLECTORS = {
    "reachability": reachability,
    "interface_state": interface_state,
    "interface_counters": interface_counters,
    "vlan_membership": vlan_membership,
    "neighbor_table": neighbor_table,
    "routing": routing,
    "throughput": throughput,
    "mtu_probe": mtu_probe,
    "optical_telemetry": optical_telemetry,
    "cable_trace": cable_trace,
    "impairment_inspect": impairment_inspect,
    "connector_inspection": connector_inspection,
}
