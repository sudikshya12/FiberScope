# Test results

All tests below were **executed** on 2026-11-13 on macOS (arm64) with Python 3.12, Node 22.18 and Chromium (Playwright 1.65).

| Suite | Command | Result |
|---|---|---|
| Backend: scenarios, workflow, inventory, security, lab-runner boundary, migrations | `cd backend && uv run pytest` | **68 passed** |
| Frontend: component and unit tests (Vitest + Testing Library) | `cd frontend && npx vitest run` | **11 passed** |
| End-to-end (Playwright, isolated API :8078 with a temp DB, Vite :5189) | `cd frontend && npx playwright test` | **7 passed** |
| Type check | `cd frontend && npx tsc -b` | clean |
| Production build | `cd frontend && npm run build` | succeeds (routes lazy-loaded) |
| Persistence across API restart | manual: create and baseline an investigation, restart uvicorn, re-read it | state and evidence preserved |

## Backend coverage, mapped to requirements

**Scenario behavior** (`tests/test_scenarios.py`)
- Wrong VLAN keeps the physical link up at all four ports, breaks reachability (`neighbor_unresolved`), shows ARP FAILED, and flags the VLAN mismatch.
- A disabled port reports admin down separately from oper state. The server sees `NO-CARRIER`.
- Missing optical thresholds give `unknown_thresholds`, never normal. A port with no optic reports "not present", never zero.
- Low Rx gives `low_warning`, and the interpretation names no component or location. The loss estimate is directional, and traffic is still healthy.
- A wrong repair (replacing the optic) fails verification. Scope inspection then finds the point, cleaning it passes, and the investigation resolves with `failed_verifications = 1`.
- MTU: 56 and 1472 bytes pass, 8972 bytes fails. TCP stalls, the MTU is 1500 against an intended 9216, and the oversize counter increments.
- Packet loss shows 5–30% over 100 probes with zero CRC or input errors, and the impairment is identified as owned.

**Workflow** (`tests/test_workflow.py`)
- All 5 scenarios resolve end to end, with 2 or more verification checks each and the diagnosis matching the answer key.
- A repair alone does not resolve, and a repair requires a diagnosis first.
- In the MTU scenario, a small ping passes while verification still fails.
- Repairs change only the targeted interface.
- Evidence is immutable: updates and deletes raise, and the hash is verified.
- New observations create new rows, and old evidence keeps the pre-repair state.
- Reset affects only the selected execution; another execution stays faulted and history is preserved.
- Restart preserves the old drill's history. Abandoning is not success.
- Reopening requires fresh verification.
- Challenge mode withholds the answer, hints and changed resources.
- A diagnosis requires evidence collected after the fault.
- State persists across database sessions.

**Inventory and security** (`tests/test_inventory_security.py`)
- Invalid endpoints are rejected, and duplicate occupancy is rejected (including after a valid create).
- Patch panels are passive and not queryable. Path tracing reports gaps and never invents links.
- Missing labels are flagged.
- Unsupported actions (`shell`, `rm -rf /`, injection strings) are rejected, as are arbitrary strings or extra keys in targets and out-of-bounds parameters. Non-owned impairments are rejected.
- Imported and simulated evidence stay distinguishable. Import validation rejects unknown ports, out-of-range values, future timestamps and extra fields.
- The Linux lab is disabled by default. A scenario that can't run in a mode is rejected.
- Reports and CSV are built from history. The Alembic migration applies to an empty database.

**Lab runner** (`tests/test_labrunner.py`, pure Python, no namespaces created)
- Unsupported operations and actions and unknown fields are rejected, and hosts must be allowlisted.
- Commands are argv lists scoped to `fslab-*`. Non-owned interfaces, unrecorded namespaces and non-lab namespaces are rejected, as are unowned or malformed impairment IDs.
- Probe count, duration and size bounds are enforced, the **timeout is enforced** (a 5 s sleep is killed at 0.5 s and audited), shell strings are rejected, and output is bounded.
- Setup refuses without Linux, root and activation.
- Parsers for ping, `ip -j link`, `bridge -j vlan`, `tc -j qdisc` and iperf3 JSON are tested.

## End-to-end flows (`frontend/e2e/workflows.spec.ts`)
1. Complete the wrong-VLAN investigation in the workbench UI: baseline, fault, palette diagnostics, cited diagnosis, repair (Resolve stays disabled), verification, resolve, answer-key match.
2. Fail verification, investigate further, then recover (optical, replace-optic first).
3. Complete the optical investigation through the guided demo (`/present?story=optical`).
4. Refresh keeps investigation state.
5. Restart a drill without deleting other history.
6. Export the report as JSON and CSV, check the SIMULATED label, the no-lessons placeholder and the SHA-256 on every evidence item.
7. Topology interaction: trace shows the text equivalent, and the logical view hides passive panels.

## Visual QA
Playwright screenshots were reviewed at 1440×900, 820×1180 (tablet) and 390×844 (mobile) for:
- overview, workbench, investigation workspace, presentation (both stories)
- optics, cables (with selection and label print view), device detail
- report (screen and print media), scenarios, investigations, learn, settings

A scripted horizontal-overflow check passed on every page and size.

Issues found and fixed during review:
- The topology was too small, and the canvas toolbar overlapped nodes.
- A VLAN mismatch wrongly colored the physical link as degraded.
- An unreachable server was labeled "fault" instead of "symptom".
- The workbench layout clipped on screens narrower than `xl`.
- The report was clipped to one page in print.

## Provided but NOT executed
- **Linux lab live run:** creating namespaces and real fault/repair/verify. This needs a Linux VM with root; see [LINUX_LAB.md](LINUX_LAB.md).
- **Docker Compose** (`docker compose up --build`) and the experimental `linux-lab` profile, because Docker was not installed.
- **Screen-reader testing** with real assistive technology. Semantic structure, labels, text alternatives and focus states were implemented and spot-checked, not audited.
