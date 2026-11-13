"""Investigation report builder.

Reports are assembled exclusively from *stored historical records* (evidence, repairs,
verification runs, audit events). They never read the live simulation state.
"""
from __future__ import annotations

import csv
import io
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from .. import models as m
from ..scenarios import DIAGNOSIS_CATEGORIES
from .investigations import WorkflowError, serialize_investigation

REPORT_VERSION = "fiberscope.report.v1"

STANDARD_LIMITATIONS = {
    "SIMULATED": [
        "All device output in this report is SIMULATED, generated from a deterministic scenario model — not captured from real equipment.",
        "Patch panels, trunk and optics are modeled; no physical fiber was tested. Optical loss figures are estimates from modeled DOM readings, not OTDR or certified results.",
        "Throughput and RTT values come from simplified models and are not performance predictions.",
        "Simulated time (probe intervals, field procedures) is distinct from the wall-clock time of operator interaction.",
    ],
    "LINUX_LAB": [
        "Evidence was collected from isolated Linux network namespaces and veth pairs created by FiberScope. Virtual Ethernet does not exercise physical optics or fiber.",
        "Patch panels and trunk segments shown in the path are documentation models only.",
    ],
}


def build_report(session: Session, inv_id: str) -> dict[str, Any]:
    inv = session.get(m.Investigation, inv_id)
    if inv is None:
        raise WorkflowError("not_found", f"Investigation {inv_id} not found.", 404)
    data = serialize_investigation(session, inv)
    ev = data["evidence"]
    by_id = {e["id"]: e for e in ev}
    traces = [e for e in ev if e["collector"] == "cable_trace"]
    path = traces[-1]["payload"]["path"] if traces else None
    mode = data["execution"]["source_mode"]
    diag = None
    if inv.diagnosis:
        diag = {
            "category": inv.diagnosis_category, "category_label": DIAGNOSIS_CATEGORIES.get(inv.diagnosis_category or "", ""),
            "statement": inv.diagnosis, "recorded_at": inv.diagnosis_at,
            "cited_evidence": [{"id": i, "title": by_id[i]["title"], "verdict": by_id[i]["verdict"]} for i in inv.diagnosis_evidence_ids if i in by_id],
        }
    report = {
        "report_version": REPORT_VERSION,
        "generated_at": datetime.now(UTC),
        "title": inv.title,
        "investigation": {k: data[k] for k in ("id", "status", "mode", "created_at", "resolved_at", "abandoned_at", "failed_verifications")},
        "scenario": {**data["scenario"], "source_mode": mode, "execution_id": data["execution"]["id"]},
        "network_path": {
            "source": "cable_trace evidence " + traces[-1]["id"] if traces else "no cable trace was collected during this investigation",
            "path": path,
        },
        "initial_symptom": inv.symptom,
        "scope": inv.scope,
        "baseline": [_summary(e) for e in ev if e["phase"] == "baseline"],
        "diagnostic_actions": [_summary(e) for e in ev if e["phase"] == "investigation"],
        "evidence": ev,
        "hypotheses": data["hypotheses"],
        "diagnosis": diag,
        "corrective_actions": data["repairs"],
        "verification": data["verifications"],
        "timeline": data["timeline"],
        "metrics": data["metrics"],
        "limitations": STANDARD_LIMITATIONS.get(mode, []) + _evidence_limitations(ev),
        "lessons_learned": inv.lessons_learned or "",
        "answer_key": data.get("answer_key"),
        "resolution_criteria": data["resolution_criteria"],
        "provenance": {
            "evidence_count": len(ev),
            "source_modes": sorted({e["source_mode"] for e in ev}),
            "integrity": "Each evidence item carries a SHA-256 of its content at collection time; evidence rows are append-only.",
        },
    }
    return report


def _summary(e: dict[str, Any]) -> dict[str, Any]:
    return {k: e[k] for k in ("id", "title", "collector", "phase", "verdict", "collected_at", "sim_time_ms", "source_mode", "interpretation", "command")}


def _evidence_limitations(ev: list[dict[str, Any]]) -> list[str]:
    seen: list[str] = []
    for e in ev:
        for lim in e["limitations"]:
            if lim not in seen and not lim.startswith("Simulated output generated"):
                seen.append(lim)
    return seen


CSV_FIELDS = ["evidence_id", "phase", "source_mode", "collector", "target", "metric", "value", "unit", "collected_at_utc", "sim_time_ms", "test_parameters"]


def measurement_rows(report: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for e in report["evidence"]:
        p, base = e["payload"], {
            "evidence_id": e["id"], "phase": e["phase"], "source_mode": e["source_mode"], "collector": e["collector"],
            "target": " ".join(f"{k}={v}" for k, v in e["target"].items()),
            "collected_at_utc": e["collected_at"].isoformat() if hasattr(e["collected_at"], "isoformat") else e["collected_at"],
            "sim_time_ms": e["sim_time_ms"], "test_parameters": " ".join(f"{k}={v}" for k, v in e["params"].items()),
        }
        if e["collector"] == "reachability":
            rows.append({**base, "metric": "loss", "value": p["loss_pct"], "unit": "%"})
            rows.append({**base, "metric": "probes_received", "value": p["received"], "unit": f"of {p['transmitted']}"})
            if p.get("rtt_ms"):
                rows.append({**base, "metric": "rtt_avg", "value": p["rtt_ms"]["avg"], "unit": "ms"})
        elif e["collector"] == "throughput":
            rows.append({**base, "metric": "throughput_sender", "value": p.get("sender_gbps"), "unit": "Gbit/s"})
            rows.append({**base, "metric": "retransmits", "value": p.get("retransmits"), "unit": "segments"})
        elif e["collector"] == "mtu_probe":
            for r in p["results"]:
                rows.append({**base, "metric": f"df_probe_{r['packet_bytes']}B", "value": r["outcome"], "unit": f"{r['received']}/{r['sent']} received"})
        elif e["collector"] in ("optical_telemetry",):
            for side in (p.get("local"), p.get("remote")):
                if side and side.get("present"):
                    for key, unit in (("tx_power_dbm", "dBm"), ("rx_power_dbm", "dBm"), ("temperature_c", "°C")):
                        rows.append({**base, "target": side["interface"], "metric": key, "value": side["metrics"][key]["value"], "unit": unit})
            for est in p.get("loss_estimates", []):
                rows.append({**base, "target": est["direction"], "metric": "estimated_loss (ESTIMATE)", "value": est["estimated_loss_db"], "unit": "dB"})
    return rows


def report_csv(report: dict[str, Any]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=CSV_FIELDS, extrasaction="ignore")
    w.writeheader()
    for r in measurement_rows(report):
        # neutralize spreadsheet formula injection in any text cell
        w.writerow({k: (f"'{v}" if isinstance(v, str) and v[:1] in "=+-@" else v) for k, v in r.items()})
    return buf.getvalue()
