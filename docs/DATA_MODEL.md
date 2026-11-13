# Data model

SQLite via SQLAlchemy 2; schema in `backend/app/models.py`, migration `backend/alembic/versions/0001_initial_schema.py`.
Conventions: stable string IDs, tz-aware UTC timestamps (`UTCDateTime`), units in column names (`_dbm`, `_m`, `_c`, `_ms`), CHECK constraints on enums/ranges.

## Inventory (documented, seeded from `app/domain/fixture.py`)

| Table | Purpose | Notable constraints |
|---|---|---|
| `lab_environments` | `north-lab-fabric` | |
| `devices` | srv-a, srv-b, asw-1, asw-2, gw-1, pp-01, pp-02 | `role` enum; `is_passive` (patch panels), `is_modeled_only` |
| `vlans` | 20 APP-DATA (192.0.2.0/24), 30 STORAGE (203.0.113.0/24) | id 1–4094 |
| `interfaces` | ports incl. patch front/rear; documented *intent* (VLAN, allowed VLANs, MTU) | unique (device, name); `kind` enum; MTU 576–9216 |
| `optics` | per-port transceiver; `dom_supported`; `thresholds` JSON (nullable ⇒ unknown) | one optic per interface |
| `cable_segments` | patch cords, trunk pairs, direct/DAC; media, fiber type, connectors, nominal length, label status, source | length > 0 or null |
| `cable_endpoints` | end A/B → interface | **`interface_id` UNIQUE** (a port holds at most one cable end) |
| `patch_mappings` | passive front↔rear mapping | front and rear each UNIQUE |

Path tracing walks `cable_endpoints` and `patch_mappings`; it stops at gaps and never invents links. L1 links are traced endpoint-to-endpoint between non-passive interfaces.

## Scenarios and executions

| Table | Purpose |
|---|---|
| `scenario_definitions` | `id = key@version`, full JSON definition (objective, symptoms, alternatives, checks…) |
| `scenario_executions` | one simulation instance: `source_mode` (SIMULATED/LINUX_LAB), `status` (baseline/faulted/reset), `seed`, **private `state` JSON**, `sim_clock_ms`, `run_counter`, fault onset (wall + sim) |

## Investigations and evidence

| Table | Purpose |
|---|---|
| `investigations` | lifecycle `status`, `mode` (guided/challenge), symptom, scope, diagnosis (category, statement, cited evidence IDs), lessons learned, milestone timestamps, failed verification and reopen counts |
| `diagnostic_runs` | each executed action: target, params, phase, source mode, wall start/end, sim start/duration |
| `evidence_items` | **append-only** record: investigation, execution, run, phase, `source_mode` (SIMULATED/LINUX_LAB/IMPORTED_SAMPLE), source id, collector, target, params, command, purpose, raw output (≤64 KiB), payload, interpretation, limitations, observations, verdict, collection status, collected_at, sim time, `content_sha256` |
| `optical_observations` | normalized Tx/Rx/temp/voltage/bias per interface, linked to evidence; nulls mean *not reported* |
| `hypotheses` | statement, status, supporting/contradicting evidence IDs |
| `repair_actions` | action, target, params, command, changed resources, outcome, evidence link |
| `verification_runs` | passed flag + per-check results (detail, evidence IDs) |
| `audit_events` | timeline + SSE source |
| `candidate_profile` | editable portfolio details (placeholder defaults) |
| `counters` | readable ID sequences (INV-0001, EV-00001, …) |

## Payload shapes used by verification (both modes)

- `reachability`: `transmitted, received, loss_pct, rtt_ms{min,avg,max,mdev}, failure_mode, neighbor_resolved, payload_bytes, packet_bytes, dont_fragment, ip_version`
- `interface_state`: `admin_state, oper_state, reason, mtu, intended_mtu`
- `vlan_membership`: `ports[], mismatches[]` (running vs intended)
- `mtu_probe`: `results[{payload_bytes, packet_bytes, sent, received, outcome}]`, overhead assumption
- `throughput`: `sender_gbps, retransmits, intervals[], stalled, connected`
- `optical_telemetry`: `local/remote{metrics{value, thresholds, status}}`, `loss_estimates[]`, `planning_budget`
- `impairment_inspect`: `rules[]`
