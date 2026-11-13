"""Parse real iproute2 / ping / iperf3 / tc output into the normalized payloads used by checks.

Every parser is pure (text in, dict out) so it is unit-testable without a Linux host.
"""
from __future__ import annotations

import json
import re
from typing import Any

PING_SUMMARY = re.compile(r"(\d+) packets transmitted, (\d+) received(?:, \+(\d+) errors)?, ([\d.]+)% packet loss")
PING_RTT = re.compile(r"rtt min/avg/max/mdev = ([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+) ms")


def parse_ping(text: str, stderr: str = "") -> dict[str, Any]:
    m = PING_SUMMARY.search(text)
    tx = int(m.group(1)) if m else 0
    rx = int(m.group(2)) if m else 0
    errors = int(m.group(3) or 0) if m else 0
    loss = float(m.group(4)) if m else 100.0
    rtt = PING_RTT.search(text)
    unreachable = "Destination Host Unreachable" in text
    local_mtu = "message too long" in (text + stderr)
    if local_mtu:
        mode = "local_mtu"
    elif rx == tx and tx > 0:
        mode = "none"
    elif rx > 0:
        mode = "partial_loss"
    elif unreachable:
        mode = "neighbor_unresolved"
    else:
        mode = "timeout"
    return {
        "transmitted": tx, "received": rx, "errors": errors, "loss_pct": loss, "failure_mode": mode,
        "neighbor_resolved": not unreachable,
        "rtt_ms": {"min": float(rtt.group(1)), "avg": float(rtt.group(2)), "max": float(rtt.group(3)), "mdev": float(rtt.group(4))} if rtt else None,
    }


def _first(js: str) -> dict[str, Any]:
    data = json.loads(js or "[]")
    if not data:
        raise ValueError("empty JSON output")
    return data[0]


def parse_link(js: str) -> dict[str, Any]:
    d = _first(js)
    flags = d.get("flags", [])
    admin = "up" if "UP" in flags else "down"
    oper = "up" if (d.get("operstate") == "UP" or ("LOWER_UP" in flags and admin == "up")) else "down"
    return {"admin_state": admin, "oper_state": oper, "mtu": d.get("mtu"), "carrier": "NO-CARRIER" not in flags,
            "reason": "Administratively down" if admin == "down" else ("Link up" if oper == "up" else "No carrier"),
            "ifalias": d.get("ifalias"), "flags": flags}


def parse_link_stats(js: str) -> dict[str, Any]:
    d = _first(js)
    s = d.get("stats64") or d.get("stats") or {}
    rx, tx = s.get("rx", {}), s.get("tx", {})
    return {"counters": {"rx_packets": rx.get("packets"), "tx_packets": tx.get("packets"), "rx_errors": rx.get("errors"),
                         "rx_crc": rx.get("crc_errors"), "rx_discards": rx.get("dropped"), "tx_discards": tx.get("dropped"),
                         "rx_oversize": rx.get("over_errors")}}


def parse_bridge_vlans(js: str) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for port in json.loads(js or "[]"):
        name = port.get("ifname")
        vlans = port.get("vlans", [])
        pvid = next((v["vlan"] for v in vlans if "PVID" in v.get("flags", [])), None)
        out[name] = {"pvid": pvid, "tagged": sorted(v["vlan"] for v in vlans if "Egress Untagged" not in v.get("flags", []))}
    return out


def parse_neigh(js: str) -> list[dict[str, Any]]:
    out = []
    for n in json.loads(js or "[]"):
        st = n.get("state", ["NONE"])
        out.append({"ip": n.get("dst"), "mac": n.get("lladdr"), "state": st[0] if isinstance(st, list) and st else str(st)})
    return out


def parse_iperf(js: str) -> dict[str, Any]:
    try:
        d = json.loads(js or "{}")
    except ValueError:
        return {"connected": False, "sender_gbps": 0.0, "receiver_gbps": 0.0, "retransmits": None, "intervals": [], "error": "unparseable output"}
    if d.get("error"):
        return {"connected": False, "sender_gbps": 0.0, "receiver_gbps": 0.0, "retransmits": None, "intervals": [], "error": d["error"]}
    end = d.get("end", {})
    sent = end.get("sum_sent", {})
    recv = end.get("sum_received", {})
    intervals = [{"start_s": round(i["sum"]["start"], 2), "end_s": round(i["sum"]["end"], 2), "gbps": round(i["sum"]["bits_per_second"] / 1e9, 3)} for i in d.get("intervals", [])]
    return {"connected": True, "sender_gbps": round(sent.get("bits_per_second", 0) / 1e9, 3), "receiver_gbps": round(recv.get("bits_per_second", 0) / 1e9, 3),
            "retransmits": sent.get("retransmits"), "intervals": intervals, "stalled": sent.get("bits_per_second", 0) < 1e6}


def parse_qdisc(js: str) -> list[dict[str, Any]]:
    rules = []
    for q in json.loads(js or "[]"):
        if q.get("kind") != "netem":
            continue
        opts = q.get("options", {})
        loss = (opts.get("loss-random") or opts.get("loss_random") or {}).get("loss")
        rules.append({"kind": "netem", "handle": q.get("handle"), "loss_pct": round(float(loss) * 100, 2) if loss is not None else None,
                      "dropped": q.get("drops"), "sent": q.get("packets")})
    return rules
