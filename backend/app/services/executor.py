"""Adapter boundary: the investigation workflow talks to an ``ExecutionBackend``.

* ``SimulationBackend`` — default; deterministic, unprivileged, state in the database.
* ``LinuxLabBackend`` (app.lab.backend) — optional; delegates to a separate privileged lab
  runner over an authenticated local channel. The web API itself is never privileged.
"""
from __future__ import annotations

import random
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from ..domain.topology import Topology
from ..scenarios import Scenario
from ..sim import network as simnet
from ..sim.diagnostics import COLLECTORS, DiagnosticResult, SimContext
from ..sim.repairs import REPAIRS, RepairResult
from .catalog import ActionError


def optics_records(session: Session) -> dict[str, dict[str, Any]]:
    return {
        o.interface_id: {
            "id": o.id, "vendor": o.vendor, "part_number": o.part_number, "serial": o.serial,
            "form_factor": o.form_factor, "standard": o.standard, "wavelength_nm": o.wavelength_nm,
            "dom_supported": o.dom_supported, "thresholds": o.thresholds, "threshold_source": o.threshold_source,
        }
        for o in session.scalars(select(m.Optic))
    }


class ExecutionBackend(Protocol):
    source_mode: str

    def initial_state(self, topo: Topology) -> dict[str, Any]: ...

    def inject_fault(self, execution: m.ScenarioExecution, scenario: Scenario, topo: Topology) -> list[str]: ...

    def run_diagnostic(
        self, session: Session, execution: m.ScenarioExecution, topo: Topology, action: str, target: dict, params: dict
    ) -> DiagnosticResult: ...

    def apply_repair(
        self, execution: m.ScenarioExecution, topo: Topology, action: str, target: dict, params: dict
    ) -> RepairResult: ...

    def reset(self, execution: m.ScenarioExecution, topo: Topology) -> None: ...


class SimulationBackend:
    source_mode = "SIMULATED"

    def initial_state(self, topo: Topology) -> dict[str, Any]:
        return simnet.baseline_state(topo)

    def _rng(self, execution: m.ScenarioExecution) -> random.Random:
        execution.run_counter = (execution.run_counter or 0) + 1
        return random.Random(f"{execution.seed}:{execution.run_counter}")

    def inject_fault(self, execution, scenario, topo):
        state = simnet.clone(execution.state)
        changed = scenario.inject(state)
        execution.state = state
        return changed

    def run_diagnostic(self, session, execution, topo, action, target, params):
        if action not in COLLECTORS:
            raise ActionError("unsupported_action", f"Unsupported action '{action}'.")
        state = simnet.clone(execution.state)
        ctx = SimContext(topo=topo, model=simnet.NetworkModel(topo, state), optics_db=optics_records(session), rng=self._rng(execution))
        result = COLLECTORS[action](ctx, target, params)
        execution.state = state  # counters / neighbor caches evolve with probes
        return result

    def apply_repair(self, execution, topo, action, target, params):
        if action not in REPAIRS:
            raise ActionError("unsupported_action", f"Unsupported repair '{action}'.")
        state = simnet.clone(execution.state)
        result = REPAIRS[action](topo, simnet.NetworkModel(topo, state), target, params)
        execution.state = state
        return result

    def reset(self, execution, topo):
        execution.state = simnet.baseline_state(topo)


_SIM = SimulationBackend()


def backend_for(source_mode: str) -> ExecutionBackend:
    if source_mode == "SIMULATED":
        return _SIM
    if source_mode == "LINUX_LAB":
        from ..lab.backend import get_linux_lab_backend

        return get_linux_lab_backend()
    raise ActionError("unsupported_mode", f"Unknown source mode {source_mode}")
