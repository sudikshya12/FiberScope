# FiberScope — Network & Fiber Troubleshooting Lab

> When a server loses connectivity, how do we identify which part of the network path failed, collect evidence, apply the correct repair, and verify recovery?

FiberScope is an **independent interview-portfolio lab** for data center operations work. It simulates a small fabric called **North Lab Fabric**: two servers, two access switches, a gateway, and a modeled patch-panel and fiber-trunk path. It lets you run disciplined troubleshooting drills against it, from symptom through evidence, diagnosis, repair and verification to an exportable report.

It is not affiliated with any employer, vendor or production environment. It contains no invented experience or performance claims. All device output in the default mode is **SIMULATED**: it is generated from a deterministic model and labeled that way everywhere.

---

## Quick start

### Option A: local development (macOS, Linux or Windows/WSL)

Requirements: [uv](https://docs.astral.sh/uv/) (Python 3.12) and Node.js 22 or newer.

```bash
# 1. API (migrations and seeding run automatically on start)
cd backend
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8077

# 2. Web app (second terminal)
cd frontend
npm ci
npm run dev            # → http://127.0.0.1:5188
```

- OpenAPI docs: http://127.0.0.1:8077/docs
- Re-seed manually (idempotent; it never deletes history): `cd backend && uv run python -m app.seed`
- Inspect counts: `uv run python -m app.seed --check`
- Migrations only: `uv run alembic upgrade head`

### Option B: Docker Compose

```bash
docker compose up --build      # → http://localhost:8080
```

The SQLite database lives in the `fiberscope-data` volume, so data survives restarts. The Compose setup was written but **not executed** in the authoring environment, because Docker was not installed there (see [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md)).

### Ports

| Service | Port |
|---|---|
| API (dev) | 8077 |
| Vite dev server | 5188 |
| Docker web | 8080 |
| E2E (isolated) | 8078 / 5189 |
| Linux lab runner (optional, loopback only) | 8765 |

The ports are deliberately non-default to avoid clashing with other local projects.

---

## The 3-minute demo

Open **Interview demo** (`/present?story=vlan`). Each step performs a real API action, and the result shown comes from the response, not from the script. For the full talk track, see [docs/INTERVIEW_SCRIPT.md](docs/INTERVIEW_SCRIPT.md).

1. Healthy baseline
2. Inject the wrong-VLAN fault
3. Failed ping from Server A to Server B
4. Admin and operational state at both ends (the link is **up**)
5. VLAN membership: `asw-2 Ethernet1/1` runs VLAN 30, but the intent is VLAN 20
6. Record the diagnosis with cited evidence
7. Fix only that port
8. Scenario-specific verification: VLAN config, ARP, both directions, throughput against baseline
9. Report

The second story (`/present?story=optical`) shows how to read low receive power without claiming a root cause too early.

---

## What is in the box

| Area | Where |
|---|---|
| Interactive topology: physical path and logical view, trace, VLAN filter, evidence-derived status | `/lab`, `/investigations/:id` |
| Five reproducible scenarios: wrong VLAN, admin-down, low Rx power, packet loss, MTU mismatch | `/scenarios` |
| Structured diagnostic palette (12 allowlisted actions, bounded parameters, no free-form shell) | Diagnose tab |
| Case notes: symptom, scope, hypotheses with supporting and contradicting evidence, cited diagnosis | Case tab |
| Repairs, scenario-specific verification, resolution criteria, reopen, abandon, reset, restart | Repair & verify tab |
| Optical diagnostics: per-module thresholds, unknown is never treated as healthy, paired loss estimate | `/optics` |
| Cable registry: search, path trace, label audit, occupancy validation, printable QR labels | `/cables` |
| Reports: printable HTML, JSON and CSV, built only from stored evidence | `/reports/:id` |
| Candidate preparation guide | `/learn`, [docs/CANDIDATE_GUIDE.md](docs/CANDIDATE_GUIDE.md) |
| Optional Linux lab (namespaces, veth, VLAN-aware bridges, netem) | [docs/LINUX_LAB.md](docs/LINUX_LAB.md) |

## Real vs simulated

| Capability | Simulation (default) | Linux lab (optional) | Needs physical hardware |
|---|---|---|---|
| VLAN, admin-down, MTU and packet-loss faults | Modeled state changes | Real Linux bridge, link, MTU and netem | — |
| Device CLI output | Generated, generic NOS style, labeled SIMULATED | Real `ip`, `bridge`, `tc`, `ping` and `iperf3` output | Real switch CLI |
| Optical DOM (Tx/Rx, thresholds) | Modeled from a power budget | Not available (veth has no optics) | Real transceivers |
| Patch panels and fiber trunk | Documentation model | Documentation model | Physical plant |
| Connector inspection and cleaning | Recorded procedure only | — | Inspection probe and cleaning tools |
| Throughput | Simplified model | Real veth/CPU-bound | Real NICs |

## Repository layout

```
backend/     FastAPI app, SQLAlchemy models, Alembic migrations, simulation engine, tests
  app/sim/        deterministic network model, diagnostic collectors, repairs
  app/scenarios.py  versioned scenario definitions and verification checks
  app/services/   investigation lifecycle, evidence, reports, action catalog
  app/lab/        unprivileged client and parsers for the Linux lab runner
labrunner/   the ONLY privileged component (stdlib Python, Linux only, opt-in)
frontend/    React + TypeScript + Vite + Tailwind + React Flow + Recharts + Motion
docs/        architecture, data model, scenarios, runbooks, interview script, guide
docs/examples/  real exports from demo runs (report JSON, measurement CSV, import sample)
```

## Tests

```bash
cd backend && uv run pytest            # 68 tests: scenarios, workflow, inventory, security, lab-runner boundary
cd frontend && npx vitest run          # 11 component and unit tests
cd frontend && npx playwright test     # 7 end-to-end flows against isolated servers (own temp DB)
```

For what was run and what is still pending, see [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).

## Configuration

Copy [`.env.example`](.env.example). Everything defaults to safe simulation mode. Candidate details (name, target role, summary, links) are edited in **Settings → Candidate profile** and stored in the database. The defaults are placeholders.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Scenario definitions](docs/SCENARIOS.md)
- [Linux lab setup and teardown](docs/LINUX_LAB.md)
- [Troubleshooting runbooks](docs/RUNBOOKS.md)
- [Interview demonstration script](docs/INTERVIEW_SCRIPT.md)
- [Candidate preparation guide](docs/CANDIDATE_GUIDE.md)
- [Known limitations](docs/LIMITATIONS.md)
- [Test results](docs/TEST_RESULTS.md)
