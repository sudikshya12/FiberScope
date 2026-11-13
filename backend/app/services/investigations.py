"""Investigation lifecycle, evidence recording, verification and resolution criteria.

Lifecycle: opened → baseline_reviewed → investigating → diagnosis_recorded → repair_applied
→ verifying → resolved, with verification_failed (loop back), reopen, and abandoned.
Resolution is never granted by a repair alone: it requires a recorded diagnosis, a repair, and a
*passing scenario-specific verification run that started after the latest repair*.
"""
from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models as m
from ..domain.topology import Topology, build_topology
from ..scenarios import DIAGNOSIS_CATEGORIES, SCENARIOS, BaselineLookup, Scenario, get_scenario
from ..sim.diagnostics import DiagnosticResult
from .catalog import DIAGNOSTIC_ACTIONS, REPAIR_ACTIONS, ActionError, validate_action
from .executor import backend_for


class WorkflowError(Exception):
    def __init__(self, code: str, message: str, status: int = 409, details: Any = None):
        super().__init__(message)
        self.code, self.message, self.status, self.details = code, message, status, details


def now() -> datetime:
    return datetime.now(UTC)


# ----------------------------------------------------------------------------- ids & audit


def next_id(session: Session, name: str, prefix: str, width: int) -> str:
    c = session.get(m.Counter, name)
    if c is None:
        c = m.Counter(name=name, value=0)
        session.add(c)
    c.value += 1
    session.flush()
    return f"{prefix}-{c.value:0{width}d}"


def audit(session: Session, kind: str, message: str, inv: m.Investigation | None = None,
          execution: m.ScenarioExecution | None = None, data: dict | None = None) -> m.AuditEvent:
    ev = m.AuditEvent(
        investigation_id=inv.id if inv else None,
        execution_id=execution.id if execution else (inv.execution_id if inv else None),
        kind=kind, message=message, data=data or {}, at=now(),
        sim_time_ms=execution.sim_clock_ms if execution else None,
    )
    session.add(ev)
    return ev


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def evidence_hash(fields: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(fields).encode()).hexdigest()


def record_evidence(
    session: Session, inv: m.Investigation | None, execution: m.ScenarioExecution | None, run: m.DiagnosticRun | None,
    result: DiagnosticResult, phase: str, source_mode: str, collector: str, target: dict, params: dict,
    collected_at: datetime | None = None,
) -> m.EvidenceItem:
    eid = next_id(session, "evidence", "EV", 5)
    seq = int(eid.split("-")[1])
    collected_at = collected_at or now()
    payload = dict(result.payload)
    payload["_next_steps"] = result.next_steps
    fields = {
        "id": eid, "investigation_id": inv.id if inv else None, "execution_id": execution.id if execution else None,
        "phase": phase, "source_mode": source_mode, "source_id": result.source_id, "collector": collector,
        "target": target, "params": params, "command": result.command, "raw_output": result.raw_output,
        "payload": payload, "interpretation": result.interpretation, "collected_at": collected_at.isoformat(),
    }
    ev = m.EvidenceItem(
        id=eid, seq=seq, investigation_id=fields["investigation_id"], execution_id=fields["execution_id"],
        diagnostic_run_id=run.id if run else None, phase=phase, source_mode=source_mode, source_id=result.source_id,
        collector=collector, title=result.title, target=target, params=params, command=result.command,
        purpose=result.purpose, raw_output=result.raw_output[:65536], payload=payload, interpretation=result.interpretation,
        limitations=result.limitations, observations=result.observations, verdict=result.verdict,
        collection_status=result.status, collected_at=collected_at,
        sim_time_ms=execution.sim_clock_ms if execution else None, content_sha256=evidence_hash(fields),
    )
    session.add(ev)
    session.flush()
    if collector == "optical_telemetry":
        for side in (payload.get("local"), payload.get("remote")):
            if side and side.get("present") and side.get("dom_supported"):
                mt = side["metrics"]
                session.add(m.OpticalObservation(
                    interface_id=side["interface"], evidence_id=eid, investigation_id=ev.investigation_id,
                    source_mode=source_mode, observed_at=collected_at, sim_time_ms=ev.sim_time_ms,
                    tx_power_dbm=mt["tx_power_dbm"]["value"], rx_power_dbm=mt["rx_power_dbm"]["value"],
                    temperature_c=mt["temperature_c"]["value"], voltage_v=mt["voltage_v"]["value"], bias_ma=mt["bias_ma"]["value"],
                    flags=side.get("flags", {}), raw={k: v["value"] for k, v in mt.items()},
                ))
    return ev


# ----------------------------------------------------------------------------- creation


def scenario_definition_row(session: Session, scenario: Scenario) -> m.ScenarioDefinition:
    row = session.get(m.ScenarioDefinition, scenario.id)
    if row is None:
        raise WorkflowError("scenario_not_seeded", f"Scenario {scenario.id} is not seeded; run the seed command.", 500)
    return row


def create_investigation(session: Session, scenario_key: str, mode: str = "guided", source_mode: str = "SIMULATED",
                         title: str | None = None) -> m.Investigation:
    if scenario_key == "random":
        import secrets

        pool = sorted(k for k, sc in SCENARIOS.items() if source_mode in sc.definition["modes"])
        scenario_key = pool[secrets.randbelow(len(pool))]
    try:
        scenario = get_scenario(scenario_key)
    except KeyError as exc:
        raise WorkflowError("unknown_scenario", f"Unknown scenario '{scenario_key}'.", 404) from exc
    if mode not in ("guided", "challenge"):
        raise WorkflowError("invalid_mode", "Mode must be 'guided' or 'challenge'.", 422)
    if source_mode not in scenario.definition["modes"]:
        raise WorkflowError("unsupported_in_mode", f"Scenario '{scenario_key}' does not support {source_mode}.", 422)
    backend = backend_for(source_mode)
    topo = build_topology(session)
    defrow = scenario_definition_row(session, scenario)
    exe_id = next_id(session, "execution", "EXE", 4)
    seed = int(hashlib.sha256(exe_id.encode()).hexdigest()[:8], 16)
    execution = m.ScenarioExecution(
        id=exe_id, scenario_definition_id=defrow.id, source_mode=source_mode, status="baseline", seed=seed,
        state=backend.initial_state(topo), sim_clock_ms=0, run_counter=0, created_at=now(),
    )
    session.add(execution)
    inv_id = next_id(session, "investigation", "INV", 4)
    display_title = title or (
        scenario.definition["title"] if mode == "guided" else f"Incident drill — {scenario.definition['short']}"
    )
    inv = m.Investigation(
        id=inv_id, title=display_title[:200], execution_id=exe_id, mode=mode, status="opened",
        symptom="", scope="", created_at=now(), diagnosis_evidence_ids=[],
    )
    session.add(inv)
    session.flush()
    audit(session, "investigation_opened", f"{inv_id} opened ({mode}, {source_mode}) for scenario {scenario.id}", inv, execution,
          {"scenario": scenario.id, "mode": mode, "source_mode": source_mode})
    session.commit()
    return inv


def _load(session: Session, inv_id: str) -> tuple[m.Investigation, m.ScenarioExecution, Scenario]:
    inv = session.get(m.Investigation, inv_id)
    if inv is None:
        raise WorkflowError("not_found", f"Investigation {inv_id} not found.", 404)
    execution = session.get(m.ScenarioExecution, inv.execution_id)
    scenario = SCENARIOS[execution.scenario.key]
    return inv, execution, scenario


def _require_active(inv: m.Investigation) -> None:
    if inv.status in ("resolved", "abandoned"):
        raise WorkflowError("investigation_closed", f"Investigation is {inv.status}. Reopen it to continue.")


def _advance_clock(execution: m.ScenarioExecution, ms: int) -> None:
    execution.sim_clock_ms = (execution.sim_clock_ms or 0) + max(0, int(ms))


# ----------------------------------------------------------------------------- execution of actions


def _run(session: Session, inv: m.Investigation, execution: m.ScenarioExecution, topo: Topology,
         action: str, target: dict, params: dict, phase: str) -> m.EvidenceItem:
    backend = backend_for(execution.source_mode)
    t, p = validate_action(DIAGNOSTIC_ACTIONS, action, target, params, execution.source_mode)
    started = now()
    sim_start = execution.sim_clock_ms
    result = backend.run_diagnostic(session, execution, topo, action, t, p)
    _advance_clock(execution, result.sim_duration_ms)
    completed = now()
    if execution.source_mode == "SIMULATED":
        # simulated wall-clock cost is not real; record completion as real time of computation
        completed = max(completed, started)
    run = m.DiagnosticRun(
        id=next_id(session, "run", "DR", 5), investigation_id=inv.id, execution_id=execution.id, action=action,
        target=t, params=p, phase=phase, source_mode=execution.source_mode, status=result.status,
        started_at=started, completed_at=completed, sim_started_ms=sim_start, sim_duration_ms=result.sim_duration_ms,
    )
    session.add(run)
    session.flush()
    return record_evidence(session, inv, execution, run, result, phase, execution.source_mode, action, t, p, completed)


def capture_baseline(session: Session, inv_id: str) -> list[m.EvidenceItem]:
    inv, execution, scenario = _load(session, inv_id)
    _require_active(inv)
    if execution.status != "baseline":
        raise WorkflowError("fault_already_injected", "Baseline can only be captured before the fault is injected.")
    topo = build_topology(session)
    items = [_run(session, inv, execution, topo, a, t, p, "baseline") for a, t, p in scenario.baseline]
    inv.status = "baseline_reviewed"
    inv.baseline_at = now()
    audit(session, "baseline_captured", f"Healthy baseline captured ({len(items)} observations)", inv, execution,
          {"evidence_ids": [e.id for e in items]})
    session.commit()
    return items


def inject_fault(session: Session, inv_id: str) -> None:
    inv, execution, scenario = _load(session, inv_id)
    _require_active(inv)
    if execution.status != "baseline":
        raise WorkflowError("fault_already_injected", "The fault has already been injected for this execution.")
    if inv.baseline_at is None:
        raise WorkflowError("baseline_required", "Capture the healthy baseline before injecting the fault.")
    topo = build_topology(session)
    backend = backend_for(execution.source_mode)
    _advance_clock(execution, 30_000)
    changed = backend.inject_fault(execution, scenario, topo)
    execution.status = "faulted"
    execution.fault_injected_at = now()
    execution.fault_injected_sim_ms = execution.sim_clock_ms
    inv.status = "investigating"
    if not inv.symptom:
        inv.symptom = scenario.definition["symptom_report"]
    audit(session, "fault_injected", "Scenario fault injected (location withheld until resolution)", inv, execution,
          {"hidden": True, "changed_resources": changed})
    if scenario.key == "low-rx-power":
        # Implemented detection mechanism: simulated DOM poll at a fixed 60 s interval.
        _advance_clock(execution, 60_000)
        res = backend.run_diagnostic(session, execution, topo, "optical_telemetry", {"interface": "asw-1:Ethernet1/1"}, {})
        local = res.payload["local"]
        rx = local["metrics"]["rx_power_dbm"]
        alarm = DiagnosticResult(
            title="Monitoring alarm — DOM Rx low-warning (asw-1 Ethernet1/1)",
            command="dom-poller --interval 60s   # simulated monitoring",
            purpose="Simulated monitoring system polling transceiver DOM every 60 s.",
            raw_output=f"ALARM  asw-1 Ethernet1/1  rx_power_dbm={rx['value']}  state={rx['status']}  threshold_low_warning={rx['thresholds']['low_warning']}",
            payload={"interface": "asw-1:Ethernet1/1", "metric": "rx_power_dbm", "value": rx["value"], "status": rx["status"],
                     "threshold": rx["thresholds"], "poll_interval_s": 60, "detected_sim_ms": execution.sim_clock_ms,
                     "fault_onset_sim_ms": execution.fault_injected_sim_ms},
            interpretation="A monitoring threshold crossing is the trigger for investigation, not a diagnosis.",
            limitations=["Simulated monitoring poll; detection latency is bounded by the 60 s simulated poll interval."],
            observations=[{"kind": "optic", "id": "asw-1:Ethernet1/1", "status": "degraded", "label": "DOM low-warning alarm"}],
            verdict="warning", source_id="sim:monitoring", sim_duration_ms=0,
        )
        record_evidence(session, inv, execution, None, alarm, "investigation", execution.source_mode, "monitoring_alarm",
                        {"interface": "asw-1:Ethernet1/1"}, {"poll_interval_s": 60})
        audit(session, "alarm", "Simulated monitoring alarm: DOM Rx low-warning on asw-1 Ethernet1/1", inv, execution,
              {"detection_latency_sim_ms": execution.sim_clock_ms - execution.fault_injected_sim_ms})
    session.commit()


def run_diagnostic(session: Session, inv_id: str, action: str, target: dict, params: dict | None) -> m.EvidenceItem:
    inv, execution, _ = _load(session, inv_id)
    _require_active(inv)
    topo = build_topology(session)
    phase = "baseline" if execution.status == "baseline" else "investigation"
    ev = _run(session, inv, execution, topo, action, target, params or {}, phase)
    if phase == "investigation":
        if inv.first_action_at is None:
            inv.first_action_at = ev.collected_at
        if inv.status == "verification_failed":
            inv.status = "investigating"
            audit(session, "additional_investigation", "Additional investigation after failed verification", inv, execution)
    audit(session, "diagnostic", f"{ev.title}: {ev.verdict.upper()}", inv, execution, {"evidence_id": ev.id, "action": action})
    session.commit()
    return ev


# ----------------------------------------------------------------------------- case notes


def update_notes(session: Session, inv_id: str, symptom: str | None, scope: str | None, lessons: str | None, title: str | None) -> None:
    inv, execution, _ = _load(session, inv_id)
    changed = []
    for attr, val in (("symptom", symptom), ("scope", scope), ("lessons_learned", lessons), ("title", title)):
        if val is not None:
            setattr(inv, attr, val[:4000])
            changed.append(attr)
    if changed:
        audit(session, "notes_updated", f"Updated {', '.join(changed)}", inv, execution)
    session.commit()


def _validate_evidence_ids(session: Session, inv: m.Investigation, ids: list[str]) -> list[str]:
    ids = list(dict.fromkeys(ids))
    if not ids:
        return []
    found = set(session.scalars(select(m.EvidenceItem.id).where(m.EvidenceItem.investigation_id == inv.id, m.EvidenceItem.id.in_(ids))))
    missing = [i for i in ids if i not in found]
    if missing:
        raise WorkflowError("invalid_evidence", f"Evidence not part of this investigation: {', '.join(missing)}", 422)
    return ids


def add_hypothesis(session: Session, inv_id: str, statement: str, supporting: list[str], contradicting: list[str]) -> m.Hypothesis:
    inv, execution, _ = _load(session, inv_id)
    _require_active(inv)
    if not statement.strip():
        raise WorkflowError("invalid_hypothesis", "Hypothesis statement is required.", 422)
    h = m.Hypothesis(
        id=next_id(session, "hypothesis", "HYP", 4), investigation_id=inv.id, statement=statement.strip()[:2000],
        status="open", supporting_evidence_ids=_validate_evidence_ids(session, inv, supporting),
        contradicting_evidence_ids=_validate_evidence_ids(session, inv, contradicting),
    )
    session.add(h)
    audit(session, "hypothesis_added", f"Hypothesis {h.id}: {h.statement}", inv, execution)
    session.commit()
    return h


def update_hypothesis(session: Session, inv_id: str, hyp_id: str, status: str | None,
                      supporting: list[str] | None, contradicting: list[str] | None) -> m.Hypothesis:
    inv, execution, _ = _load(session, inv_id)
    h = session.get(m.Hypothesis, hyp_id)
    if h is None or h.investigation_id != inv.id:
        raise WorkflowError("not_found", "Hypothesis not found.", 404)
    if status is not None:
        if status not in ("open", "supported", "refuted", "confirmed"):
            raise WorkflowError("invalid_status", "Invalid hypothesis status.", 422)
        h.status = status
    if supporting is not None:
        h.supporting_evidence_ids = _validate_evidence_ids(session, inv, supporting)
    if contradicting is not None:
        h.contradicting_evidence_ids = _validate_evidence_ids(session, inv, contradicting)
    audit(session, "hypothesis_updated", f"Hypothesis {h.id} → {h.status}", inv, execution)
    session.commit()
    return h


def record_diagnosis(session: Session, inv_id: str, category: str, statement: str, evidence_ids: list[str]) -> None:
    inv, execution, _ = _load(session, inv_id)
    _require_active(inv)
    if execution.status != "faulted":
        raise WorkflowError("no_fault", "There is no active fault to diagnose yet (inject the scenario fault first).")
    if category not in DIAGNOSIS_CATEGORIES:
        raise WorkflowError("invalid_category", f"Unknown diagnosis category '{category}'.", 422)
    if not statement.strip():
        raise WorkflowError("invalid_diagnosis", "Diagnosis statement is required.", 422)
    ids = _validate_evidence_ids(session, inv, evidence_ids)
    inv_ev = [e for e in session.scalars(select(m.EvidenceItem).where(m.EvidenceItem.id.in_(ids))) if e.phase == "investigation"]
    if not inv_ev:
        raise WorkflowError("evidence_required", "Cite at least one piece of evidence collected after the fault was introduced.", 422)
    previous = inv.diagnosis
    inv.diagnosis_category = category
    inv.diagnosis = statement.strip()[:4000]
    inv.diagnosis_evidence_ids = ids
    inv.diagnosis_at = now()
    inv.status = "diagnosis_recorded"
    audit(session, "diagnosis_recorded", f"Diagnosis: {DIAGNOSIS_CATEGORIES[category]} — {inv.diagnosis}", inv, execution,
          {"category": category, "evidence_ids": ids, "previous": previous})
    session.commit()


def apply_repair(session: Session, inv_id: str, action: str, target: dict, params: dict | None, notes: str = "") -> m.RepairAction:
    inv, execution, _ = _load(session, inv_id)
    _require_active(inv)
    if inv.diagnosis is None:
        raise WorkflowError("diagnosis_required", "Record a diagnosis (with evidence) before applying a corrective action.")
    t, p = validate_action(REPAIR_ACTIONS, action, target, params or {}, execution.source_mode)
    topo = build_topology(session)
    backend = backend_for(execution.source_mode)
    result = backend.apply_repair(execution, topo, action, t, p)
    _advance_clock(execution, result.sim_duration_ms)
    ev_result = DiagnosticResult(
        title=f"Corrective action — {result.description}", command=result.command, purpose=REPAIR_ACTIONS[action]["description"],
        raw_output=result.raw_output, payload={"action": action, "changed_resources": result.changed_resources, "outcome": result.outcome, "notes": result.notes},
        interpretation=(result.notes or f"Outcome: {result.outcome}. A repair is not a resolution — run verification."),
        limitations=(["Simulated change to scenario state."] if execution.source_mode == "SIMULATED" else ["Executed by the Linux lab runner on owned lab resources only."]),
        observations=result.observations, verdict="info", source_id=f"{'sim' if execution.source_mode == 'SIMULATED' else 'lab'}:repair", sim_duration_ms=result.sim_duration_ms,
    )
    ev = record_evidence(session, inv, execution, None, ev_result, "repair", execution.source_mode, f"repair:{action}", t, p)
    r = m.RepairAction(
        id=next_id(session, "repair", "RPR", 4), investigation_id=inv.id, execution_id=execution.id, action=action,
        target=t, params=p, description=result.description, command=result.command, source_mode=execution.source_mode,
        changed_resources=result.changed_resources, outcome=result.outcome, notes=(notes or result.notes)[:2000],
        evidence_id=ev.id, applied_at=now(), sim_time_ms=execution.sim_clock_ms,
    )
    session.add(r)
    inv.repair_at = r.applied_at
    inv.status = "repair_applied"
    audit(session, "repair_applied", f"{result.description} ({result.outcome})", inv, execution, {"repair_id": r.id, "evidence_id": ev.id})
    session.commit()
    return r


def verify(session: Session, inv_id: str) -> m.VerificationRun:
    inv, execution, scenario = _load(session, inv_id)
    _require_active(inv)
    last_repair = session.scalars(select(m.RepairAction).where(m.RepairAction.investigation_id == inv.id).order_by(m.RepairAction.applied_at.desc())).first()
    if last_repair is None:
        raise WorkflowError("repair_required", "Apply a corrective action before running verification.")
    topo = build_topology(session)
    baseline = BaselineLookup([
        {"action": e.collector, "target": e.target, "params": e.params, "payload": e.payload}
        for e in session.scalars(select(m.EvidenceItem).where(m.EvidenceItem.investigation_id == inv.id, m.EvidenceItem.phase == "baseline").order_by(m.EvidenceItem.seq))
    ])
    inv.status = "verifying"
    started = now()
    checks_out = []
    all_ok = True
    for check in scenario.checks:
        evs = [_run(session, inv, execution, topo, a, t, p, "verification") for a, t, p in check.steps]
        try:
            ok, detail = check.evaluate([e.payload for e in evs], baseline)
        except Exception as exc:  # defensive: a malformed payload must fail closed
            ok, detail = False, f"Check could not be evaluated: {exc}"
        all_ok &= ok
        checks_out.append({"id": check.id, "label": check.label, "rationale": check.rationale, "passed": ok, "detail": detail,
                           "evidence_ids": [e.id for e in evs]})
    vr = m.VerificationRun(id=next_id(session, "verification", "VR", 4), investigation_id=inv.id, started_at=started,
                           completed_at=now(), passed=all_ok, checks=checks_out)
    session.add(vr)
    if all_ok:
        inv.verified_at = vr.completed_at
        inv.status = "verifying"
        audit(session, "verification_passed", f"Verification {vr.id} passed ({len(checks_out)}/{len(checks_out)} checks)", inv, execution, {"verification_id": vr.id})
    else:
        inv.failed_verifications += 1
        inv.status = "verification_failed"
        failed = [c["label"] for c in checks_out if not c["passed"]]
        audit(session, "verification_failed", f"Verification {vr.id} failed: {', '.join(failed)}", inv, execution, {"verification_id": vr.id})
    session.commit()
    return vr


def resolution_criteria(session: Session, inv: m.Investigation) -> list[dict[str, Any]]:
    last_repair = session.scalars(select(m.RepairAction).where(m.RepairAction.investigation_id == inv.id).order_by(m.RepairAction.applied_at.desc())).first()
    last_vr = session.scalars(select(m.VerificationRun).where(m.VerificationRun.investigation_id == inv.id).order_by(m.VerificationRun.started_at.desc())).first()
    execution = session.get(m.ScenarioExecution, inv.execution_id)
    last_reopen = session.scalars(select(m.AuditEvent.at).where(m.AuditEvent.investigation_id == inv.id, m.AuditEvent.kind == "reopened").order_by(m.AuditEvent.id.desc())).first()
    fresh_after = max([t for t in (last_repair.applied_at if last_repair else None, last_reopen) if t is not None], default=None)
    return [
        {"id": "baseline", "label": "Healthy baseline captured", "met": inv.baseline_at is not None},
        {"id": "fault", "label": "Fault introduced and observed", "met": execution.status == "faulted"},
        {"id": "diagnosis", "label": "Diagnosis recorded with cited evidence", "met": bool(inv.diagnosis and inv.diagnosis_evidence_ids)},
        {"id": "repair", "label": "Corrective action applied after diagnosis", "met": bool(last_repair and inv.diagnosis_at and last_repair.applied_at >= inv.diagnosis_at)},
        {"id": "verification", "label": "Scenario-specific verification passed after the latest repair",
         "met": bool(last_vr and last_vr.passed and last_repair and fresh_after and last_vr.started_at >= fresh_after)},
    ]


def resolve(session: Session, inv_id: str, lessons: str | None = None) -> None:
    inv, execution, _ = _load(session, inv_id)
    if inv.status == "abandoned":
        raise WorkflowError("investigation_closed", "An abandoned drill cannot be resolved; restart it instead.")
    if inv.status == "resolved":
        raise WorkflowError("already_resolved", "Investigation is already resolved.")
    crit = resolution_criteria(session, inv)
    unmet = [c for c in crit if not c["met"]]
    if unmet:
        raise WorkflowError("resolution_criteria_unmet", "Resolution criteria not met: " + "; ".join(c["label"] for c in unmet), 409, crit)
    if lessons is not None:
        inv.lessons_learned = lessons[:4000]
    inv.status = "resolved"
    inv.resolved_at = now()
    audit(session, "resolved", "Investigation resolved — all resolution criteria met", inv, execution)
    session.commit()


def reopen(session: Session, inv_id: str, reason: str) -> None:
    inv, execution, _ = _load(session, inv_id)
    if inv.status != "resolved":
        raise WorkflowError("not_resolved", "Only resolved investigations can be reopened.")
    inv.status = "investigating"
    inv.reopen_count += 1
    inv.resolved_at = None
    inv.verified_at = None
    audit(session, "reopened", f"Reopened: {reason or 'no reason given'}", inv, execution)
    session.commit()


def abandon(session: Session, inv_id: str, reason: str) -> None:
    inv, execution, _ = _load(session, inv_id)
    if inv.status in ("resolved", "abandoned"):
        raise WorkflowError("investigation_closed", f"Investigation is already {inv.status}.")
    inv.status = "abandoned"
    inv.abandoned_at = now()
    audit(session, "abandoned", f"Drill abandoned (not marked successful): {reason or 'no reason given'}", inv, execution)
    session.commit()


def reset_execution(session: Session, inv_id: str) -> None:
    """Reset only this investigation's execution to baseline. Evidence is preserved."""
    inv, execution, _ = _load(session, inv_id)
    topo = build_topology(session)
    backend_for(execution.source_mode).reset(execution, topo)
    execution.status = "reset"
    if inv.status not in ("resolved", "abandoned"):
        inv.status = "abandoned"
        inv.abandoned_at = now()
    audit(session, "simulation_reset", f"Execution {execution.id} reset to healthy baseline; evidence preserved", inv, execution)
    session.commit()


def restart(session: Session, inv_id: str) -> m.Investigation:
    inv, execution, scenario = _load(session, inv_id)
    if inv.status not in ("resolved", "abandoned"):
        abandon(session, inv_id, "restarted as a new drill")
    return create_investigation(session, scenario.key, inv.mode, execution.source_mode)


# ----------------------------------------------------------------------------- metrics & views


def _secs(a: datetime | None, b: datetime | None) -> float | None:
    if a is None or b is None:
        return None
    return round((b - a).total_seconds(), 1)


def metrics(session: Session, inv: m.Investigation) -> dict[str, Any]:
    execution = session.get(m.ScenarioExecution, inv.execution_id)
    n_diag = session.scalar(select(func.count()).select_from(m.DiagnosticRun).where(m.DiagnosticRun.investigation_id == inv.id, m.DiagnosticRun.phase == "investigation")) or 0
    n_repairs = session.scalar(select(func.count()).select_from(m.RepairAction).where(m.RepairAction.investigation_id == inv.id)) or 0
    alarm = session.scalars(select(m.AuditEvent).where(m.AuditEvent.investigation_id == inv.id, m.AuditEvent.kind == "alarm")).first()
    fault = execution.fault_injected_at
    return {
        "wall_clock": {
            "note": "Real elapsed time of operator interaction (UTC wall clock).",
            "investigation_started_at": inv.created_at,
            "fault_injected_at": fault,
            "first_diagnostic_at": inv.first_action_at,
            "diagnosis_recorded_at": inv.diagnosis_at,
            "repair_applied_at": inv.repair_at,
            "verification_completed_at": inv.verified_at,
            "resolved_at": inv.resolved_at,
            "fault_to_first_action_s": _secs(fault, inv.first_action_at),
            "fault_to_diagnosis_s": _secs(fault, inv.diagnosis_at),
            "diagnosis_to_repair_s": _secs(inv.diagnosis_at, inv.repair_at),
            "repair_to_verified_s": _secs(inv.repair_at, inv.verified_at),
            "fault_to_resolved_s": _secs(fault, inv.resolved_at),
        },
        "simulated_time": {
            "note": "Simulated network time advanced by modeled action durations (probes at 1 s intervals, test durations, field procedures). Not real time.",
            "applies": execution.source_mode == "SIMULATED",
            "clock_ms": execution.sim_clock_ms,
            "fault_onset_ms": execution.fault_injected_sim_ms,
            "simulated_detection_latency_ms": (alarm.data or {}).get("detection_latency_sim_ms") if alarm else None,
            "detection_mechanism": "Simulated DOM poll every 60 s" if alarm else None,
        },
        "counts": {"diagnostic_actions": n_diag, "repairs": n_repairs, "failed_verifications": inv.failed_verifications, "reopened": inv.reopen_count},
    }


def answer_key_visible(inv: m.Investigation) -> bool:
    return inv.mode == "guided" or inv.status in ("resolved", "abandoned")


def serialize_evidence(e: m.EvidenceItem, hide_hints: bool) -> dict[str, Any]:
    payload = dict(e.payload)
    next_steps = payload.pop("_next_steps", [])
    return {
        "id": e.id, "seq": e.seq, "investigation_id": e.investigation_id, "execution_id": e.execution_id,
        "diagnostic_run_id": e.diagnostic_run_id, "phase": e.phase, "source_mode": e.source_mode, "source_id": e.source_id,
        "collector": e.collector, "title": e.title, "target": e.target, "params": e.params, "command": e.command,
        "purpose": e.purpose, "raw_output": e.raw_output, "payload": payload, "interpretation": e.interpretation,
        "limitations": e.limitations, "observations": e.observations, "verdict": e.verdict,
        "collection_status": e.collection_status, "collected_at": e.collected_at, "sim_time_ms": e.sim_time_ms,
        "content_sha256": e.content_sha256, "next_steps": [] if hide_hints else next_steps,
    }


CHALLENGE_VISIBLE = ("short", "difficulty", "symptom_report", "baseline", "modes", "reset_behavior", "safety", "focus", "version")


def public_scenario(scenario: Scenario, reveal: bool, mode: str) -> dict[str, Any]:
    d = dict(scenario.definition)
    if not reveal:
        d = {k: v for k, v in d.items() if k in CHALLENGE_VISIBLE}
        d["key"] = "undisclosed"
        d["title"] = "Undisclosed fault (challenge)"
    if mode == "challenge":
        d.pop("hints", None)
    return d


def serialize_investigation(session: Session, inv: m.Investigation, detail: bool = True) -> dict[str, Any]:
    execution = session.get(m.ScenarioExecution, inv.execution_id)
    scenario = SCENARIOS[execution.scenario.key]
    reveal = answer_key_visible(inv)
    base = {
        "id": inv.id, "title": inv.title, "mode": inv.mode, "status": inv.status, "symptom": inv.symptom, "scope": inv.scope,
        "created_at": inv.created_at, "resolved_at": inv.resolved_at, "abandoned_at": inv.abandoned_at,
        "diagnosis_category": inv.diagnosis_category, "diagnosis": inv.diagnosis,
        "diagnosis_evidence_ids": inv.diagnosis_evidence_ids, "lessons_learned": inv.lessons_learned,
        "failed_verifications": inv.failed_verifications,
        "scenario": {"key": scenario.key if reveal else "undisclosed", "version": scenario.version, "title": scenario.definition["title"] if reveal else "Undisclosed fault (challenge)",
                     "short": scenario.definition["short"]},
        "execution": {"id": execution.id, "status": execution.status, "source_mode": execution.source_mode,
                      "sim_clock_ms": execution.sim_clock_ms, "fault_injected_at": execution.fault_injected_at,
                      "fault_injected_sim_ms": execution.fault_injected_sim_ms, "created_at": execution.created_at},
    }
    if not detail:
        base["counts"] = metrics(session, inv)["counts"]
        return base
    hide = inv.mode == "challenge" and inv.status not in ("resolved", "abandoned")
    evidence = [serialize_evidence(e, hide) for e in session.scalars(select(m.EvidenceItem).where(m.EvidenceItem.investigation_id == inv.id).order_by(m.EvidenceItem.seq))]
    hyps = session.scalars(select(m.Hypothesis).where(m.Hypothesis.investigation_id == inv.id).order_by(m.Hypothesis.created_at))
    repairs = session.scalars(select(m.RepairAction).where(m.RepairAction.investigation_id == inv.id).order_by(m.RepairAction.applied_at))
    vrs = session.scalars(select(m.VerificationRun).where(m.VerificationRun.investigation_id == inv.id).order_by(m.VerificationRun.started_at))
    timeline = session.scalars(select(m.AuditEvent).where(m.AuditEvent.investigation_id == inv.id).order_by(m.AuditEvent.id))
    base.update({
        "scenario_definition": public_scenario(scenario, reveal, inv.mode),
        "answer_key": ({"diagnosis_category": scenario.definition["diagnosis_category"],
                        "diagnosis_label": DIAGNOSIS_CATEGORIES[scenario.definition["diagnosis_category"]],
                        "fault_mutation": scenario.definition["fault_mutation"],
                        "corrective_action": scenario.definition["corrective_action"],
                        "diagnosis_matched": inv.diagnosis_category == scenario.definition["diagnosis_category"] if inv.diagnosis_category else None}
                       if reveal else None),
        "evidence": evidence,
        "hypotheses": [{"id": h.id, "statement": h.statement, "status": h.status, "supporting_evidence_ids": h.supporting_evidence_ids,
                        "contradicting_evidence_ids": h.contradicting_evidence_ids, "created_at": h.created_at, "updated_at": h.updated_at} for h in hyps],
        "repairs": [{"id": r.id, "action": r.action, "target": r.target, "params": r.params, "description": r.description, "command": r.command,
                     "source_mode": r.source_mode, "changed_resources": r.changed_resources, "outcome": r.outcome, "notes": r.notes,
                     "evidence_id": r.evidence_id, "applied_at": r.applied_at, "sim_time_ms": r.sim_time_ms} for r in repairs],
        "verifications": [{"id": v.id, "started_at": v.started_at, "completed_at": v.completed_at, "passed": v.passed, "checks": v.checks} for v in vrs],
        "timeline": [{"id": a.id, "kind": a.kind, "message": a.message, "at": a.at, "sim_time_ms": a.sim_time_ms,
                      "data": {k: v for k, v in (a.data or {}).items() if not (k == "changed_resources" and not reveal)}} for a in timeline],
        "metrics": metrics(session, inv),
        "resolution_criteria": resolution_criteria(session, inv),
        "diagnosis_categories": DIAGNOSIS_CATEGORIES,
        "focus": scenario.definition.get("focus"),
    })
    return base


def stale_threshold() -> timedelta:
    return timedelta(minutes=10)
