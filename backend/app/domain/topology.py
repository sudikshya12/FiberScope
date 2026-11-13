"""Topology index: path tracing and inventory validation over the documented cable registry.

Path tracing walks cable segments and *passive* patch-panel front↔rear mappings. It never
invents links: if a patch port has no cable, the trace stops and reports a gap.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import models as m
from .fixture import FIBER_ATTENUATION_DB_PER_KM, MATED_PAIR_LOSS_DB


@dataclass(frozen=True)
class IfaceInfo:
    id: str
    device_id: str
    name: str
    kind: str
    media: str
    speed_gbps: float | None
    mac: str | None
    ipv4_cidr: str | None
    ipv6_cidr: str | None
    switchport_mode: str | None
    intended_vlan: int | None
    intended_allowed_vlans: tuple[int, ...] | None
    intended_mtu: int | None
    description: str

    @property
    def ipv4(self) -> str | None:
        return self.ipv4_cidr.split("/")[0] if self.ipv4_cidr else None

    @property
    def ipv6(self) -> str | None:
        return self.ipv6_cidr.split("/")[0] if self.ipv6_cidr else None


@dataclass(frozen=True)
class CableInfo:
    id: str
    kind: str
    media: str
    fiber_type: str | None
    nominal_length_m: float | None
    label_status: str
    a: str | None
    b: str | None
    trunk_id: str | None
    connector_a: str
    connector_b: str
    is_modeled_only: bool


@dataclass
class PathHop:
    kind: str  # interface | cable | patch_mapping | gap
    id: str
    label: str
    device_id: str | None = None
    detail: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "id": self.id, "label": self.label, "device_id": self.device_id, "detail": self.detail}


@dataclass
class TracedPath:
    start: str
    end: str | None
    hops: list[PathHop]
    complete: bool
    cables: list[str]
    mated_points: list[str]  # patch-panel ports where connectors are mated
    gap_reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "start": self.start,
            "end": self.end,
            "complete": self.complete,
            "cables": self.cables,
            "mated_points": self.mated_points,
            "gap_reason": self.gap_reason,
            "hops": [h.as_dict() for h in self.hops],
            "text": self.text(),
        }

    def text(self) -> str:
        parts = []
        for h in self.hops:
            if h.kind == "patch_mapping":
                parts.append(f"[{h.label}]")
            elif h.kind == "gap":
                parts.append(f"⟂ {h.label}")
            else:
                parts.append(h.label)
        return " → ".join(parts)


@dataclass
class L1Link:
    id: str
    a: str
    b: str
    path: TracedPath
    media: str

    def as_dict(self) -> dict[str, Any]:
        return {"id": self.id, "a": self.a, "b": self.b, "media": self.media, "path": self.path.as_dict()}


@dataclass
class Topology:
    devices: dict[str, dict[str, Any]]
    ifaces: dict[str, IfaceInfo]
    cables: dict[str, CableInfo]
    cable_at: dict[str, tuple[str, str]]  # iface_id -> (cable_id, end)
    patch_peer: dict[str, str]  # front<->rear (both directions)
    links: dict[str, L1Link] = field(default_factory=dict)
    link_of: dict[str, str] = field(default_factory=dict)  # active iface -> link id

    # ---------------------------------------------------------------- queries
    def device_of(self, iface_id: str) -> dict[str, Any]:
        return self.devices[self.ifaces[iface_id].device_id]

    def is_passive(self, iface_id: str) -> bool:
        return bool(self.device_of(iface_id)["is_passive"])

    def label(self, iface_id: str) -> str:
        i = self.ifaces[iface_id]
        return f"{i.device_id} {i.name}"

    def trace(self, start_iface: str, max_hops: int = 32) -> TracedPath:
        if start_iface not in self.ifaces:
            raise KeyError(f"unknown interface {start_iface}")
        hops = [PathHop("interface", start_iface, self.label(start_iface), self.ifaces[start_iface].device_id)]
        cables: list[str] = []
        mated: list[str] = []
        current = start_iface
        visited = {start_iface}
        for _ in range(max_hops):
            at = self.cable_at.get(current)
            if at is None:
                if len(hops) == 1:
                    return TracedPath(start_iface, None, hops, False, cables, mated, "no cable recorded on this port")
                hops.append(PathHop("gap", f"gap@{current}", "no cable recorded", self.ifaces[current].device_id))
                return TracedPath(start_iface, None, hops, False, cables, mated, f"no cable recorded at {current}")
            cable_id, end = at
            cable = self.cables[cable_id]
            far = cable.b if end == "A" else cable.a
            length = f"{cable.nominal_length_m:g} m" if cable.nominal_length_m else "length unknown"
            hops.append(PathHop("cable", cable_id, cable_id, None, f"{cable.media} · {cable.fiber_type or cable.connector_a} · {length}"))
            cables.append(cable_id)
            if far is None:
                hops.append(PathHop("gap", f"gap@{cable_id}", "cable far end not recorded"))
                return TracedPath(start_iface, None, hops, False, cables, mated, f"{cable_id} far end not recorded")
            if far in visited:
                return TracedPath(start_iface, None, hops, False, cables, mated, "loop detected in records")
            visited.add(far)
            hops.append(PathHop("interface", far, self.label(far), self.ifaces[far].device_id))
            if not self.is_passive(far):
                return TracedPath(start_iface, far, hops, True, cables, mated)
            # passive patch panel: mated connection at `far`, cross to its mapped peer port
            mated.append(far)
            peer = self.patch_peer.get(far)
            if peer is None:
                hops.append(PathHop("gap", f"gap@{far}", "no front/rear mapping recorded", self.ifaces[far].device_id))
                return TracedPath(start_iface, None, hops, False, cables, mated, f"no patch mapping for {far}")
            visited.add(peer)
            hops.append(
                PathHop(
                    "patch_mapping",
                    f"{far}~{peer}",
                    f"{self.ifaces[far].device_id.upper()} {self.ifaces[far].name}⇄{self.ifaces[peer].name}",
                    self.ifaces[far].device_id,
                    "passive front↔rear mapping (modeled)",
                )
            )
            hops.append(PathHop("interface", peer, self.label(peer), self.ifaces[peer].device_id))
            mated.append(peer)
            current = peer
        return TracedPath(start_iface, None, hops, False, cables, mated, "trace exceeded hop limit")

    def link_between(self, a: str, b: str) -> L1Link | None:
        lid = self.link_of.get(a)
        if lid and (self.links[lid].a == b or self.links[lid].b == b):
            return self.links[lid]
        return None

    def peer_of(self, iface_id: str) -> str | None:
        lid = self.link_of.get(iface_id)
        if not lid:
            return None
        link = self.links[lid]
        return link.b if link.a == iface_id else link.a

    def path_loss_db(self, link: L1Link) -> float:
        """Modeled insertion loss along a link (same in both directions, excluding faults)."""
        loss = 0.0
        for cid in link.path.cables:
            c = self.cables[cid]
            if c.media == "fiber" and c.nominal_length_m and c.fiber_type in FIBER_ATTENUATION_DB_PER_KM:
                loss += FIBER_ATTENUATION_DB_PER_KM[c.fiber_type] * c.nominal_length_m / 1000.0
        # each passive panel crossing contributes two mated pairs (front + rear)
        loss += MATED_PAIR_LOSS_DB * len(link.path.mated_points)
        return round(loss, 2)

    def find_iface_by_ip(self, ip: str) -> IfaceInfo | None:
        for i in self.ifaces.values():
            if i.ipv4 == ip or i.ipv6 == ip:
                return i
        return None

    def as_dict(self) -> dict[str, Any]:
        return {
            "devices": list(self.devices.values()),
            "links": [l.as_dict() for l in self.links.values()],
        }


def link_id_for(a: str, b: str) -> str:
    x, y = sorted([a, b])
    return f"{x}~{y}"


def build_topology(session: Session) -> Topology:
    devices = {
        d.id: {
            "id": d.id,
            "name": d.name,
            "role": d.role,
            "rack": d.rack,
            "rack_unit": d.rack_unit,
            "model": d.model,
            "is_passive": d.is_passive,
            "is_modeled_only": d.is_modeled_only,
            "mgmt_address": d.mgmt_address,
            "notes": d.notes,
        }
        for d in session.scalars(select(m.Device))
    }
    ifaces = {
        i.id: IfaceInfo(
            id=i.id,
            device_id=i.device_id,
            name=i.name,
            kind=i.kind,
            media=i.media,
            speed_gbps=i.speed_gbps,
            mac=i.mac,
            ipv4_cidr=i.ipv4_cidr,
            ipv6_cidr=i.ipv6_cidr,
            switchport_mode=i.switchport_mode,
            intended_vlan=i.intended_vlan,
            intended_allowed_vlans=tuple(i.intended_allowed_vlans) if i.intended_allowed_vlans else None,
            intended_mtu=i.intended_mtu,
            description=i.description,
        )
        for i in session.scalars(select(m.Interface).order_by(m.Interface.sort_key))
    }
    cables: dict[str, CableInfo] = {}
    cable_at: dict[str, tuple[str, str]] = {}
    for c in session.scalars(select(m.CableSegment).options(selectinload(m.CableSegment.endpoints))):
        ends = {e.end: e.interface_id for e in c.endpoints}
        cables[c.id] = CableInfo(
            id=c.id,
            kind=c.kind,
            media=c.media,
            fiber_type=c.fiber_type,
            nominal_length_m=c.nominal_length_m,
            label_status=c.label_status,
            a=ends.get("A"),
            b=ends.get("B"),
            trunk_id=c.trunk_id,
            connector_a=c.connector_a,
            connector_b=c.connector_b,
            is_modeled_only=c.is_modeled_only,
        )
        for end, iid in ends.items():
            cable_at[iid] = (c.id, end)
    patch_peer: dict[str, str] = {}
    for pm in session.scalars(select(m.PatchMapping)):
        patch_peer[pm.front_interface_id] = pm.rear_interface_id
        patch_peer[pm.rear_interface_id] = pm.front_interface_id
    topo = Topology(devices, ifaces, cables, cable_at, patch_peer)
    _compute_links(topo)
    return topo


def _compute_links(topo: Topology) -> None:
    for iid, info in topo.ifaces.items():
        if topo.is_passive(iid) or iid in topo.link_of or info.kind == "mgmt":
            continue
        path = topo.trace(iid)
        if not path.complete or path.end is None:
            continue
        lid = link_id_for(iid, path.end)
        a, b = sorted([iid, path.end])
        if a != iid:
            path = topo.trace(a)
        media = topo.cables[path.cables[0]].media if path.cables else "unknown"
        topo.links[lid] = L1Link(lid, a, b, path, media)
        topo.link_of[a] = lid
        topo.link_of[b] = lid


# ---------------------------------------------------------------- validation


@dataclass
class CableValidationIssue:
    severity: str  # error | warning
    code: str
    message: str
    cable_id: str | None = None
    interface_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


def validate_new_cable(
    topo: Topology, cable_id: str, endpoint_a: str, endpoint_b: str | None
) -> list[CableValidationIssue]:
    issues: list[CableValidationIssue] = []
    if cable_id in topo.cables:
        issues.append(CableValidationIssue("error", "duplicate_id", f"Cable ID {cable_id} already exists.", cable_id))
    for label, ep in (("A", endpoint_a), ("B", endpoint_b)):
        if ep is None:
            continue
        if ep not in topo.ifaces:
            issues.append(CableValidationIssue("error", "invalid_endpoint", f"Endpoint {label} '{ep}' is not a known interface.", cable_id, ep))
            continue
        if topo.ifaces[ep].kind == "mgmt":
            issues.append(CableValidationIssue("warning", "mgmt_port", f"Endpoint {label} '{ep}' is an out-of-band management port; it is outside this lab's data path.", cable_id, ep))
        if ep in topo.cable_at:
            other = topo.cable_at[ep][0]
            issues.append(CableValidationIssue("error", "occupied", f"Endpoint {label} '{ep}' is already occupied by {other}.", cable_id, ep))
    if endpoint_b is not None and endpoint_a == endpoint_b:
        issues.append(CableValidationIssue("error", "same_endpoint", "A cable cannot connect a port to itself.", cable_id, endpoint_a))
    return issues


def inventory_audit(topo: Topology) -> list[CableValidationIssue]:
    """Warnings derived only from recorded fields: missing labels, open ends, unpatched ports."""
    issues: list[CableValidationIssue] = []
    for c in topo.cables.values():
        if c.label_status == "missing":
            issues.append(CableValidationIssue("warning", "label_missing", f"{c.id} is recorded with a missing label.", c.id))
        elif c.label_status == "mismatch":
            issues.append(CableValidationIssue("warning", "label_mismatch", f"{c.id} label does not match records.", c.id))
        if c.a is None or c.b is None:
            issues.append(CableValidationIssue("error", "open_end", f"{c.id} has an unrecorded endpoint.", c.id))
    for pid, peer in topo.patch_peer.items():
        if topo.ifaces[pid].kind == "patch_front" and pid not in topo.cable_at and peer in topo.cable_at:
            issues.append(
                CableValidationIssue(
                    "info", "unpatched_front", f"{topo.label(pid)} has no patch cord; rear is connected to {topo.cable_at[peer][0]}.", interface_id=pid
                )
            )
    return issues

