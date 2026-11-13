# Architecture

```
 Browser (React SPA)
   │  REST + server-sent events (/api/investigations/:id/events)
   ▼
 FastAPI web API  ── unprivileged, no Docker socket, no NET_ADMIN
   ├─ Topology provider ........ app/domain/topology.py   (registry → traced L1 links, validation)
   ├─ Scenario engine .......... app/scenarios.py         (versioned definitions, fault hooks, checks)
   ├─ Diagnostic executor ┐
   ├─ Repair executor     ├──── app/services/executor.py  (ExecutionBackend adapter boundary)
   │                      ├─ SimulationBackend  → app/sim/{network,diagnostics,repairs}.py
   │                      └─ LinuxLabBackend    → app/lab/{client,parsers,backend}.py ──┐
   ├─ Verification engine ...... app/services/investigations.py (verify, resolution criteria)
   ├─ Evidence repository ...... EvidenceItem (append-only, SHA-256), OpticalObservation
   └─ Report builder ........... app/services/reports.py  (from stored history only)
   │
   ▼
 SQLite (SQLAlchemy 2 + Alembic)                                                         │
                                                                                         │ HTTP on 127.0.0.1,
 Lab runner (OPTIONAL, Linux only, root) ◄───────────────────────────────────────────────┘ bearer token, fixed schema
   labrunner/fiberscope_labrunner.py — creates fslab-* namespaces, veth pairs, VLAN-aware bridges;
   runs allowlisted argv commands with timeouts; JSONL audit log; never touches host networking.
```

## Key design decisions

**One workflow, two backends.** The investigation service never knows which mode it is in. It calls `run_diagnostic`, `inject_fault`, `apply_repair` and `reset` on an `ExecutionBackend`. Both backends return the same `DiagnosticResult` shape: raw output, a normalized payload, an interpretation, limitations, observations and a verdict. The Linux lab parsers normalize real `ping`, `iproute2`, `bridge`, `tc` and `iperf3` output into the payloads that the verification checks consume, so the checks are mode-agnostic.

**State drives symptoms.** In simulation, each `ScenarioExecution` owns a JSON state document covering interface admin state, MTU and VLAN, optic transmit power, connector contamination, impairment rules, counters and neighbor caches. Faults mutate that state. Every observable is derived from it:

- link carrier from admin state and receive power
- receive power from the peer's Tx minus the modeled path loss (fiber attenuation, mated pairs, contamination)
- forwarding from a VLAN-aware search across switch ports
- probe loss from seeded sampling of impairment rules
- oversize drops from per-hop MTU

Randomness is seeded from the execution seed plus a run counter, so it is reproducible.

**Hidden ground truth.** Clients never receive the execution state. The topology overlay is computed in the browser from the `observations` attached to evidence. If nobody has looked at a link, it shows as *not observed*, and a failed ping marks the target as *unreachable (symptom)*, not as faulty. In challenge mode, the API also withholds the scenario key and title, hints, expected evidence and the answer key until the investigation is resolved or abandoned.

**Evidence is immutable.** An `EvidenceItem` is append-only. ORM `before_update` and `before_delete` hooks raise, and a SHA-256 of the canonical content is stored and re-verified by `GET /api/evidence/:id`. Repairs and verification runs create new evidence and never edit existing evidence. Reports are assembled from these rows, never from live state.

**Resolution is earned.** All five criteria must hold:

1. baseline captured
2. fault present
3. diagnosis with cited post-fault evidence
4. repair after the diagnosis
5. a passing scenario-specific verification that started after the latest repair *and* after the latest reopen

A repair alone or a single ping never resolves an investigation.

**Lab runner isolation.** The privileged runner:

- is a separate process and image
- listens on loopback only and requires a bearer token (file mode 0600, constant-time comparison)
- has an 8 KiB request limit and a fixed op/action schema that rejects unknown fields
- builds argv lists and never uses `shell=True`
- maps every logical target through an allowlist to an `fslab-*` namespace
- verifies the ownership alias (`fiberscope-owned:*`) before any mutation
- enforces per-command timeouts and 64 KiB output caps

Teardown deletes only recorded `fslab-*` namespaces. It stops iperf3 by pidfile, never by name.

## Request flow (diagnostic)

1. `POST /api/investigations/:id/diagnostics {action, target, params}`
2. `catalog.validate_action` checks the allowlisted action, the strict Pydantic target and parameter models with bounds, and that the action is allowed in this mode.
3. The backend runs it. Simulation advances the simulated clock by the modeled duration.
4. A `DiagnosticRun` and an `EvidenceItem` are written, plus an `OpticalObservation` for optics.
5. An `AuditEvent` is written. The SSE stream polls audit rows, and the browser invalidates the investigation query.

## Frontend

React 19, TypeScript, Vite 8, Tailwind v4, React Router 7, TanStack Query 5, React Flow 12 (custom nodes and edges), Recharts 3, Radix primitives, lucide icons, and Motion for animation. Routes are lazy-loaded.

**Animation.** All animation is state-derived and respects `prefers-reduced-motion`:

- Moving dashes appear only on links observed up.
- Degraded links animate slowly; down links are static.
- Path traces sweep hop by hop in path order.
- Verification checks tick in one at a time.
- Optical threshold markers spring to the measured value.
