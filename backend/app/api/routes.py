"""REST API. All errors use the envelope {"error": {"code", "message", "details"}}."""
from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import PlainTextResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models as m
from ..db import SessionLocal, get_session
from ..domain.topology import build_topology, inventory_audit, validate_new_cable
from ..lab.backend import lab_status
from ..scenarios import DIAGNOSIS_CATEGORIES, SCENARIOS
from ..services import investigations as svc
from ..services import reports
from ..services.catalog import DIAGNOSTIC_ACTIONS, REPAIR_ACTIONS, catalog_for_client
from ..sim.diagnostics import _budget, inspection_points

router = APIRouter(prefix="/api")


class In(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ----------------------------------------------------------------------------- health / overview


@router.get("/health", tags=["system"])
def health(session: Session = Depends(get_session)):
    n = session.scalar(select(func.count()).select_from(m.Device))
    return {"status": "ok", "seeded": bool(n), "time": datetime.now(UTC)}


@router.get("/overview", tags=["system"])
def overview(session: Session = Depends(get_session)):
    rows = session.execute(select(m.Investigation.status, func.count()).group_by(m.Investigation.status)).all()
    return {
        "investigations_by_status": {s: c for s, c in rows},
        "evidence_items": session.scalar(select(func.count()).select_from(m.EvidenceItem)) or 0,
        "evidence_by_source": dict(session.execute(select(m.EvidenceItem.source_mode, func.count()).group_by(m.EvidenceItem.source_mode)).all()),
        "scenarios": len(SCENARIOS),
        "lab": lab_status(),
    }


# ----------------------------------------------------------------------------- topology & inventory


def _iface_dict(i: m.Interface, topo, optic: m.Optic | None) -> dict[str, Any]:
    cab = topo.cable_at.get(i.id)
    return {
        "id": i.id, "device_id": i.device_id, "name": i.name, "kind": i.kind, "media": i.media, "speed_gbps": i.speed_gbps,
        "mac": i.mac, "ipv4_cidr": i.ipv4_cidr, "ipv6_cidr": i.ipv6_cidr, "switchport_mode": i.switchport_mode,
        "intended_vlan": i.intended_vlan, "intended_allowed_vlans": i.intended_allowed_vlans, "intended_mtu": i.intended_mtu,
        "description": i.description, "cable_id": cab[0] if cab else None, "link_id": topo.link_of.get(i.id),
        "peer": topo.peer_of(i.id), "patch_peer": topo.patch_peer.get(i.id),
        "optic": ({"id": optic.id, "standard": optic.standard, "dom_supported": optic.dom_supported, "thresholds_available": optic.thresholds is not None,
                   "vendor": optic.vendor, "part_number": optic.part_number, "serial": optic.serial, "wavelength_nm": optic.wavelength_nm,
                   "form_factor": optic.form_factor, "threshold_source": optic.threshold_source, "thresholds": optic.thresholds} if optic else None),
    }


@router.get("/topology", tags=["inventory"])
def topology(session: Session = Depends(get_session)):
    topo = build_topology(session)
    optics = {o.interface_id: o for o in session.scalars(select(m.Optic))}
    ifaces = [_iface_dict(i, topo, optics.get(i.id)) for i in session.scalars(select(m.Interface).order_by(m.Interface.sort_key))]
    env = session.scalars(select(m.LabEnvironment)).first()
    return {
        "environment": {"id": env.id, "name": env.name, "description": env.description} if env else None,
        "devices": list(topo.devices.values()),
        "interfaces": ifaces,
        "vlans": [{"id": v.id, "name": v.name, "ipv4_subnet": v.ipv4_subnet, "ipv6_subnet": v.ipv6_subnet, "gateway_ipv4": v.gateway_ipv4, "description": v.description}
                  for v in session.scalars(select(m.Vlan))],
        "cables": [c.__dict__ for c in topo.cables.values()],
        "patch_mappings": [{"front": f, "rear": r} for f, r in topo.patch_peer.items() if topo.ifaces[f].kind == "patch_front"],
        "links": [{**l.as_dict(), "planning_budget": _budget_for(topo, l.a)} for l in topo.links.values()],
        "inspection_points": inspection_points(topo),
        "source": "documented inventory (seed fixture)",
    }


def _budget_for(topo, iid):
    from ..sim.diagnostics import SimContext

    return _budget(SimContext(topo=topo, model=None, optics_db={}, rng=None), iid)  # type: ignore[arg-type]


@router.get("/topology/trace", tags=["inventory"])
def trace(interface: str, session: Session = Depends(get_session)):
    topo = build_topology(session)
    if interface not in topo.ifaces:
        raise svc.WorkflowError("invalid_endpoint", f"Unknown interface '{interface}'.", 404)
    return topo.trace(interface).as_dict()


@router.get("/devices/{device_id}", tags=["inventory"])
def device(device_id: str, session: Session = Depends(get_session)):
    topo = build_topology(session)
    if device_id not in topo.devices:
        raise svc.WorkflowError("not_found", f"Device {device_id} not found.", 404)
    optics = {o.interface_id: o for o in session.scalars(select(m.Optic))}
    ifaces = [_iface_dict(i, topo, optics.get(i.id)) for i in session.scalars(select(m.Interface).where(m.Interface.device_id == device_id).order_by(m.Interface.sort_key))]
    recent = session.scalars(select(m.EvidenceItem).where(m.EvidenceItem.source_id.like(f"%{device_id}%")).order_by(m.EvidenceItem.seq.desc()).limit(15))
    return {
        "device": topo.devices[device_id], "interfaces": ifaces,
        "recent_evidence": [{"id": e.id, "title": e.title, "verdict": e.verdict, "collected_at": e.collected_at, "investigation_id": e.investigation_id, "source_mode": e.source_mode} for e in recent],
    }


@router.get("/cables", tags=["inventory"])
def cables(q: str | None = None, endpoint_device: str | None = None, session: Session = Depends(get_session)):
    topo = build_topology(session)
    items = []
    for c in topo.cables.values():
        a_dev = topo.ifaces[c.a].device_id if c.a else None
        b_dev = topo.ifaces[c.b].device_id if c.b else None
        if endpoint_device and endpoint_device not in (a_dev, b_dev):
            continue
        hay = " ".join(str(x) for x in (c.id, c.a, c.b, c.fiber_type, c.connector_a, c.media, c.trunk_id) if x).lower()
        if q and q.lower() not in hay:
            continue
        items.append({**c.__dict__, "a_device": a_dev, "b_device": b_dev,
                      "notes": session.get(m.CableSegment, c.id).notes, "source": session.get(m.CableSegment, c.id).source})
    return {"cables": items, "audit": [i.as_dict() for i in inventory_audit(topo)], "total": len(topo.cables)}


class CableIn(In):
    id: str = Field(pattern=r"^(CBL|TRK)-[A-Z0-9-]{2,20}$")
    kind: Literal["patch", "direct", "trunk_pair"] = "patch"
    media: Literal["fiber", "copper", "dac"]
    fiber_type: str | None = Field(default=None, max_length=64)
    connector_a: str = Field(max_length=64)
    connector_b: str = Field(max_length=64)
    nominal_length_m: float | None = Field(default=None, gt=0, le=10000)
    label_status: Literal["labeled", "missing", "mismatch"] = "labeled"
    endpoint_a: str = Field(max_length=96)
    endpoint_b: str | None = Field(default=None, max_length=96)
    notes: str = Field(default="", max_length=2000)


@router.post("/cables/validate", tags=["inventory"])
def validate_cable(body: CableIn, session: Session = Depends(get_session)):
    topo = build_topology(session)
    issues = [i.as_dict() for i in validate_new_cable(topo, body.id, body.endpoint_a, body.endpoint_b)]
    return {"valid": not any(i["severity"] == "error" for i in issues), "issues": issues}


@router.post("/cables", tags=["inventory"], status_code=201)
def create_cable(body: CableIn, session: Session = Depends(get_session)):
    topo = build_topology(session)
    issues = [i.as_dict() for i in validate_new_cable(topo, body.id, body.endpoint_a, body.endpoint_b)]
    if any(i["severity"] == "error" for i in issues):
        raise svc.WorkflowError("invalid_cable", "Cable record rejected by inventory validation.", 422, issues)
    c = m.CableSegment(id=body.id, kind=body.kind, media=body.media, fiber_type=body.fiber_type, connector_a=body.connector_a,
                       connector_b=body.connector_b, nominal_length_m=body.nominal_length_m, label_status=body.label_status,
                       is_modeled_only=True, notes=body.notes, source="operator-entered record")
    c.endpoints.append(m.CableEndpoint(end="A", interface_id=body.endpoint_a))
    if body.endpoint_b:
        c.endpoints.append(m.CableEndpoint(end="B", interface_id=body.endpoint_b))
    session.add(c)
    svc.audit(session, "cable_created", f"Cable {body.id} recorded ({body.endpoint_a} ↔ {body.endpoint_b or 'unrecorded'})")
    session.commit()
    return {"id": c.id, "issues": issues}


@router.delete("/cables/{cable_id}", tags=["inventory"])
def delete_cable(cable_id: str, session: Session = Depends(get_session)):
    c = session.get(m.CableSegment, cable_id)
    if c is None:
        raise svc.WorkflowError("not_found", "Cable not found.", 404)
    if c.source != "operator-entered record":
        raise svc.WorkflowError("protected", "Seeded inventory records cannot be deleted from the UI.", 409)
    session.delete(c)
    session.commit()
    return {"deleted": cable_id}


# ----------------------------------------------------------------------------- optics


@router.get("/optics", tags=["optics"])
def optics(session: Session = Depends(get_session)):
    topo = build_topology(session)
    out = []
    for o in session.scalars(select(m.Optic)):
        latest = session.scalars(select(m.OpticalObservation).where(m.OpticalObservation.interface_id == o.interface_id).order_by(m.OpticalObservation.id.desc())).first()
        out.append({"interface_id": o.interface_id, "id": o.id, "standard": o.standard, "vendor": o.vendor, "dom_supported": o.dom_supported,
                    "thresholds_available": o.thresholds is not None, "link_id": topo.link_of.get(o.interface_id), "peer": topo.peer_of(o.interface_id),
                    "latest": _obs(latest) if latest else None})
    links = [{"id": l.id, "a": l.a, "b": l.b, "media": l.media, "has_optics": any(x in {o["interface_id"] for o in out} for x in (l.a, l.b))} for l in topo.links.values()]
    return {"optics": out, "links": links}


def _obs(o: m.OpticalObservation) -> dict[str, Any]:
    return {"id": o.id, "interface_id": o.interface_id, "evidence_id": o.evidence_id, "investigation_id": o.investigation_id, "source_mode": o.source_mode,
            "observed_at": o.observed_at, "sim_time_ms": o.sim_time_ms, "tx_power_dbm": o.tx_power_dbm, "rx_power_dbm": o.rx_power_dbm,
            "temperature_c": o.temperature_c, "voltage_v": o.voltage_v, "bias_ma": o.bias_ma, "flags": o.flags}


@router.get("/optics/observations", tags=["optics"])
def optic_observations(interface: list[str] = Query(...), investigation: str | None = None, limit: int = Query(60, ge=1, le=500),
                       session: Session = Depends(get_session)):
    q = select(m.OpticalObservation).where(m.OpticalObservation.interface_id.in_(interface))
    if investigation:
        q = q.where(m.OpticalObservation.investigation_id == investigation)
    rows = session.scalars(q.order_by(m.OpticalObservation.id.desc()).limit(limit)).all()
    return {"observations": [_obs(o) for o in reversed(rows)]}


# ----------------------------------------------------------------------------- scenarios & catalog


@router.get("/scenarios", tags=["scenarios"])
def scenarios():
    return {"scenarios": [s.definition for s in SCENARIOS.values()]}


@router.get("/scenarios/{key}", tags=["scenarios"])
def scenario(key: str):
    if key not in SCENARIOS:
        raise svc.WorkflowError("not_found", f"Unknown scenario '{key}'.", 404)
    return SCENARIOS[key].definition


@router.get("/catalog", tags=["scenarios"])
def catalog(session: Session = Depends(get_session)):
    topo = build_topology(session)
    data_ifaces = [i for i, info in topo.ifaces.items() if not topo.is_passive(i) and info.kind != "mgmt"]
    return {
        "diagnostics": catalog_for_client(DIAGNOSTIC_ACTIONS),
        "repairs": catalog_for_client(REPAIR_ACTIONS),
        "targets": {
            "hosts": ["srv-a", "srv-b", "gw-1"],
            "devices": ["srv-a", "srv-b", "asw-1", "asw-2", "gw-1"],
            "interfaces": data_ifaces,
            "trace_interfaces": [i for i in topo.ifaces if topo.ifaces[i].kind != "mgmt"],
            "optic_interfaces": [o.interface_id for o in session.scalars(select(m.Optic))],
            "access_ports": [i for i in data_ifaces if topo.ifaces[i].switchport_mode == "access"],
            "locations": inspection_points(topo),
            "patch_cables": [c.id for c in topo.cables.values() if c.kind != "trunk_pair"],
            "vlans": [20, 30],
            "intended_mtu": {i: topo.ifaces[i].intended_mtu for i in data_ifaces},
        },
        "diagnosis_categories": DIAGNOSIS_CATEGORIES,
    }


# ----------------------------------------------------------------------------- investigations


class CreateInvestigation(In):
    scenario_key: str = Field(max_length=64)
    mode: Literal["guided", "challenge"] = "guided"
    source_mode: Literal["SIMULATED", "LINUX_LAB"] = "SIMULATED"
    title: str | None = Field(default=None, max_length=200)


@router.get("/investigations", tags=["investigations"])
def list_investigations(session: Session = Depends(get_session)):
    invs = session.scalars(select(m.Investigation).order_by(m.Investigation.created_at.desc())).all()
    return {"investigations": [svc.serialize_investigation(session, i, detail=False) for i in invs]}


@router.post("/investigations", tags=["investigations"], status_code=201)
def create(body: CreateInvestigation, session: Session = Depends(get_session)):
    inv = svc.create_investigation(session, body.scenario_key, body.mode, body.source_mode, body.title)
    return svc.serialize_investigation(session, inv)


def _detail(session: Session, inv_id: str):
    inv = session.get(m.Investigation, inv_id)
    if inv is None:
        raise svc.WorkflowError("not_found", f"Investigation {inv_id} not found.", 404)
    session.refresh(inv)
    return svc.serialize_investigation(session, inv)


@router.get("/investigations/{inv_id}", tags=["investigations"])
def get_investigation(inv_id: str, session: Session = Depends(get_session)):
    return _detail(session, inv_id)


@router.post("/investigations/{inv_id}/baseline", tags=["investigations"])
def baseline(inv_id: str, session: Session = Depends(get_session)):
    items = svc.capture_baseline(session, inv_id)
    return {"evidence_ids": [e.id for e in items], "investigation": _detail(session, inv_id)}


@router.post("/investigations/{inv_id}/inject-fault", tags=["investigations"])
def inject(inv_id: str, session: Session = Depends(get_session)):
    svc.inject_fault(session, inv_id)
    return _detail(session, inv_id)


class DiagnosticIn(In):
    action: str = Field(max_length=48)
    target: dict[str, Any]
    params: dict[str, Any] = Field(default_factory=dict)


@router.post("/investigations/{inv_id}/diagnostics", tags=["investigations"])
def diagnostic(inv_id: str, body: DiagnosticIn, session: Session = Depends(get_session)):
    ev = svc.run_diagnostic(session, inv_id, body.action, body.target, body.params)
    inv = session.get(m.Investigation, inv_id)
    return {"evidence": svc.serialize_evidence(ev, inv.mode == "challenge" and inv.status not in ("resolved", "abandoned")), "investigation": _detail(session, inv_id)}


class NotesIn(In):
    symptom: str | None = Field(default=None, max_length=4000)
    scope: str | None = Field(default=None, max_length=4000)
    lessons_learned: str | None = Field(default=None, max_length=4000)
    title: str | None = Field(default=None, max_length=200)


@router.patch("/investigations/{inv_id}/notes", tags=["investigations"])
def notes(inv_id: str, body: NotesIn, session: Session = Depends(get_session)):
    svc.update_notes(session, inv_id, body.symptom, body.scope, body.lessons_learned, body.title)
    return _detail(session, inv_id)


class HypothesisIn(In):
    statement: str = Field(min_length=1, max_length=2000)
    supporting_evidence_ids: list[str] = Field(default_factory=list, max_length=50)
    contradicting_evidence_ids: list[str] = Field(default_factory=list, max_length=50)


class HypothesisPatch(In):
    status: Literal["open", "supported", "refuted", "confirmed"] | None = None
    supporting_evidence_ids: list[str] | None = Field(default=None, max_length=50)
    contradicting_evidence_ids: list[str] | None = Field(default=None, max_length=50)


@router.post("/investigations/{inv_id}/hypotheses", tags=["investigations"])
def hypothesis(inv_id: str, body: HypothesisIn, session: Session = Depends(get_session)):
    svc.add_hypothesis(session, inv_id, body.statement, body.supporting_evidence_ids, body.contradicting_evidence_ids)
    return _detail(session, inv_id)


@router.patch("/investigations/{inv_id}/hypotheses/{hyp_id}", tags=["investigations"])
def hypothesis_patch(inv_id: str, hyp_id: str, body: HypothesisPatch, session: Session = Depends(get_session)):
    svc.update_hypothesis(session, inv_id, hyp_id, body.status, body.supporting_evidence_ids, body.contradicting_evidence_ids)
    return _detail(session, inv_id)


class DiagnosisIn(In):
    category: str = Field(max_length=48)
    statement: str = Field(min_length=1, max_length=4000)
    evidence_ids: list[str] = Field(min_length=1, max_length=50)


@router.post("/investigations/{inv_id}/diagnosis", tags=["investigations"])
def diagnosis(inv_id: str, body: DiagnosisIn, session: Session = Depends(get_session)):
    svc.record_diagnosis(session, inv_id, body.category, body.statement, body.evidence_ids)
    return _detail(session, inv_id)


class RepairIn(In):
    action: str = Field(max_length=48)
    target: dict[str, Any]
    params: dict[str, Any] = Field(default_factory=dict)
    notes: str = Field(default="", max_length=2000)


@router.post("/investigations/{inv_id}/repairs", tags=["investigations"])
def repair(inv_id: str, body: RepairIn, session: Session = Depends(get_session)):
    svc.apply_repair(session, inv_id, body.action, body.target, body.params, body.notes)
    return _detail(session, inv_id)


@router.post("/investigations/{inv_id}/verify", tags=["investigations"])
def verify(inv_id: str, session: Session = Depends(get_session)):
    vr = svc.verify(session, inv_id)
    return {"verification": {"id": vr.id, "passed": vr.passed, "checks": vr.checks}, "investigation": _detail(session, inv_id)}


class ResolveIn(In):
    lessons_learned: str | None = Field(default=None, max_length=4000)


@router.post("/investigations/{inv_id}/resolve", tags=["investigations"])
def resolve(inv_id: str, body: ResolveIn | None = None, session: Session = Depends(get_session)):
    svc.resolve(session, inv_id, body.lessons_learned if body else None)
    return _detail(session, inv_id)


class ReasonIn(In):
    reason: str = Field(default="", max_length=1000)


@router.post("/investigations/{inv_id}/reopen", tags=["investigations"])
def reopen(inv_id: str, body: ReasonIn | None = None, session: Session = Depends(get_session)):
    svc.reopen(session, inv_id, body.reason if body else "")
    return _detail(session, inv_id)


@router.post("/investigations/{inv_id}/abandon", tags=["investigations"])
def abandon(inv_id: str, body: ReasonIn | None = None, session: Session = Depends(get_session)):
    svc.abandon(session, inv_id, body.reason if body else "")
    return _detail(session, inv_id)


@router.post("/investigations/{inv_id}/reset", tags=["investigations"])
def reset(inv_id: str, session: Session = Depends(get_session)):
    svc.reset_execution(session, inv_id)
    return _detail(session, inv_id)


@router.post("/investigations/{inv_id}/restart", tags=["investigations"], status_code=201)
def restart(inv_id: str, session: Session = Depends(get_session)):
    new = svc.restart(session, inv_id)
    return svc.serialize_investigation(session, new)


@router.get("/investigations/{inv_id}/events", tags=["investigations"])
async def events(inv_id: str, request: Request, after: int = 0):
    """Server-sent events: one `audit` event per new audit record (polls the DB; restart-safe)."""

    async def stream():
        last = after
        idle = 0
        yield "retry: 3000\n\n"
        while not await request.is_disconnected():
            with SessionLocal() as s:
                rows = s.scalars(select(m.AuditEvent).where(m.AuditEvent.investigation_id == inv_id, m.AuditEvent.id > last).order_by(m.AuditEvent.id)).all()
                for a in rows:
                    last = a.id
                    data = json.dumps({"id": a.id, "kind": a.kind, "message": a.message, "at": a.at.isoformat()})
                    yield f"id: {a.id}\nevent: audit\ndata: {data}\n\n"
            idle = 0 if rows else idle + 1
            if idle and idle % 15 == 0:
                yield ": keepalive\n\n"
            await asyncio.sleep(1.0)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ----------------------------------------------------------------------------- reports & evidence


@router.get("/reports/{inv_id}", tags=["reports"])
def report(inv_id: str, session: Session = Depends(get_session)):
    return reports.build_report(session, inv_id)


@router.get("/reports/{inv_id}/export.json", tags=["reports"])
def report_json(inv_id: str, session: Session = Depends(get_session)):
    rep = reports.build_report(session, inv_id)
    body = json.dumps(rep, default=lambda o: o.isoformat() if hasattr(o, "isoformat") else str(o), indent=2)
    return Response(body, media_type="application/json", headers={"Content-Disposition": f'attachment; filename="fiberscope-{inv_id}.json"'})


@router.get("/reports/{inv_id}/measurements.csv", tags=["reports"])
def report_csv(inv_id: str, session: Session = Depends(get_session)):
    rep = reports.build_report(session, inv_id)
    return PlainTextResponse(reports.report_csv(rep), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="fiberscope-{inv_id}-measurements.csv"'})


@router.get("/evidence/{evidence_id}", tags=["evidence"])
def evidence(evidence_id: str, session: Session = Depends(get_session)):
    e = session.get(m.EvidenceItem, evidence_id)
    if e is None:
        raise svc.WorkflowError("not_found", "Evidence not found.", 404)
    fields = {"id": e.id, "investigation_id": e.investigation_id, "execution_id": e.execution_id, "phase": e.phase, "source_mode": e.source_mode,
              "source_id": e.source_id, "collector": e.collector, "target": e.target, "params": e.params, "command": e.command,
              "raw_output": e.raw_output, "payload": e.payload, "interpretation": e.interpretation, "collected_at": e.collected_at.isoformat()}
    out = svc.serialize_evidence(e, hide_hints=True)
    out["integrity_ok"] = svc.evidence_hash(fields) == e.content_sha256
    return out


class ImportedObservation(In):
    interface_id: str = Field(max_length=96)
    observed_at: datetime
    tx_power_dbm: float | None = Field(default=None, ge=-40, le=10)
    rx_power_dbm: float | None = Field(default=None, ge=-40, le=10)
    temperature_c: float | None = Field(default=None, ge=-40, le=125)
    voltage_v: float | None = Field(default=None, ge=0, le=5)
    bias_ma: float | None = Field(default=None, ge=0, le=200)


class ImportIn(In):
    format: Literal["fiberscope.optical-observation.v1"]
    source_note: str = Field(max_length=500)
    investigation_id: str | None = Field(default=None, max_length=32)
    observations: list[ImportedObservation] = Field(min_length=1, max_length=200)


@router.post("/evidence/import", tags=["evidence"], status_code=201)
def import_evidence(body: ImportIn, session: Session = Depends(get_session)):
    """Import optical observations as UNTRUSTED sample evidence (validated, labeled IMPORTED_SAMPLE)."""
    from ..sim.diagnostics import DiagnosticResult

    topo = build_topology(session)
    optic_ifaces = {o.interface_id for o in session.scalars(select(m.Optic))}
    inv = session.get(m.Investigation, body.investigation_id) if body.investigation_id else None
    if body.investigation_id and inv is None:
        raise svc.WorkflowError("not_found", "Investigation not found.", 404)
    future = datetime.now(UTC) + timedelta(minutes=5)
    for o in body.observations:
        if o.interface_id not in topo.ifaces or o.interface_id not in optic_ifaces:
            raise svc.WorkflowError("invalid_import", f"{o.interface_id} is not a known optic-bearing interface.", 422)
        ts = o.observed_at if o.observed_at.tzinfo else o.observed_at.replace(tzinfo=UTC)
        if ts > future:
            raise svc.WorkflowError("invalid_import", "observed_at is in the future.", 422)
    rows = [o.model_dump(mode="json") for o in body.observations]
    raw = json.dumps({"format": body.format, "observations": rows}, indent=1)[:65536]
    res = DiagnosticResult(
        title=f"Imported optical sample ({len(rows)} observation{'s' if len(rows) != 1 else ''})",
        command="POST /api/evidence/import", purpose="Import externally collected optical readings for comparison.",
        raw_output=raw, payload={"format": body.format, "source_note": body.source_note, "observations": rows},
        interpretation="Imported values are untrusted external data: validated for type and range only. They were not collected by FiberScope.",
        limitations=["IMPORTED SAMPLE — provenance is the importer's statement; FiberScope cannot verify the original source.",
                     "Thresholds are not imported; status is evaluated only against the recorded optic's thresholds where available."],
        observations=[], verdict="info", source_id="import:untrusted", sim_duration_ms=0,
    )
    ev = svc.record_evidence(session, inv, None, None, res, "investigation", "IMPORTED_SAMPLE", "import:optical", {"interfaces": sorted({r["interface_id"] for r in rows})}, {"count": len(rows)})
    for o in body.observations:
        session.add(m.OpticalObservation(interface_id=o.interface_id, evidence_id=ev.id, investigation_id=inv.id if inv else None, source_mode="IMPORTED_SAMPLE",
                                         observed_at=o.observed_at if o.observed_at.tzinfo else o.observed_at.replace(tzinfo=UTC),
                                         tx_power_dbm=o.tx_power_dbm, rx_power_dbm=o.rx_power_dbm, temperature_c=o.temperature_c,
                                         voltage_v=o.voltage_v, bias_ma=o.bias_ma, flags={"imported": True}, raw=o.model_dump(mode="json")))
    svc.audit(session, "evidence_imported", f"Imported {len(rows)} optical observation(s) as {ev.id} (untrusted sample)", inv)
    session.commit()
    return {"evidence_id": ev.id, "source_mode": "IMPORTED_SAMPLE", "count": len(rows)}


# ----------------------------------------------------------------------------- profile & lab


class ProfileIn(In):
    name: str = Field(min_length=1, max_length=120)
    target_role: str = Field(max_length=160)
    summary: str = Field(max_length=4000)
    links: list[dict[str, str]] = Field(default_factory=list, max_length=8)


@router.get("/profile", tags=["system"])
def profile(session: Session = Depends(get_session)):
    p = session.get(m.CandidateProfile, 1)
    return {"name": p.name, "target_role": p.target_role, "summary": p.summary, "links": p.links, "updated_at": p.updated_at} if p else None


@router.put("/profile", tags=["system"])
def put_profile(body: ProfileIn, session: Session = Depends(get_session)):
    for link in body.links:
        url = link.get("url", "")
        if url and not url.startswith(("https://", "http://", "mailto:")):
            raise svc.WorkflowError("invalid_link", "Links must be http(s) or mailto URLs.", 422)
    p = session.get(m.CandidateProfile, 1) or m.CandidateProfile(id=1)
    p.name, p.target_role, p.summary, p.links = body.name, body.target_role, body.summary, body.links
    session.add(p)
    session.commit()
    return profile(session)


@router.get("/lab/status", tags=["system"])
def lab():
    return lab_status()
