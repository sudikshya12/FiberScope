# Troubleshooting runbooks (as practiced in FiberScope)

General loop: **symptom → scope → baseline comparison → hypotheses → cheapest discriminating test → evidence → diagnosis → smallest correct change → scenario-specific verification → record**. Never change more than one thing at a time; never treat a repair as resolution.

## RB-1 Server unreachable, link reported up
1. Reproduce: `ping` from the affected client (note: “Destination Host Unreachable” = neighbor resolution failed; plain timeouts = L2 adjacency but packets lost).
2. Interface state at **both** ends of the server link — admin *and* operational. If both are up, stop suspecting cables.
3. Neighbor table on the client: FAILED/INCOMPLETE for the peer?
4. VLAN membership on the access switches vs documented intent; MAC table — which VLAN is the server learned in?
5. Routing only matters if the destination is off-subnet.
6. Fix the one mismatched port. Verify: intended config, ARP REACHABLE with expected MAC, both directions, an application/throughput check vs baseline.

## RB-2 Link down
1. Server shows NO-CARRIER? Read the switch port: “Administratively down” means configuration, not physics.
2. If admin up / oper down: read optics both ends (Tx present? Rx LOS?), trace the documented path, inspect connectors with a probe.
3. Before enabling a disabled port, check change records — it may be intentionally shut.
4. Verify admin+oper at both ends and endpoint connectivity.

## RB-3 Low optical receive power (DOM warning)
1. Read DOM at both ends with each module's own thresholds. Unknown thresholds = unknown status.
2. Remote Tx normal? Reverse direction normal? → narrows to one fiber of the pair.
3. Estimate loss = remote Tx − local Rx (same reading time, same wavelength); compare with the documented budget. It is an estimate, not an OTDR result.
4. Trace the documented path; list mated points. Inspect with a video probe starting nearest the affected receiver. **Never look into a connector or port.**
5. Clean only what fails inspection; re-inspect; re-read DOM. Replace the cord if cleaning does not pass.
6. Escalate (not swap) for trunk faults, repeated failures, or no inspection finding.

## RB-4 Intermittent loss / slow transfers
1. Quantify with a fixed test (e.g. 100 probes, 56 B) — the same test you'll repeat after repair.
2. Throughput test (bounded) vs baseline.
3. Counters per hop: CRC/FCS/input errors point to the physical layer; clean counters + loss point to queueing, policing, or (in the lab) an impairment rule.
4. Remove only the owned rule / fix the identified cause. Repeat the identical test and compare sample counts.

## RB-5 “Ping works but the application hangs”
1. Default ping succeeds → test sizes: DF probes at 56, 1472, 8972 B (IPv4 overhead 28 B; IPv6 48 B).
2. Read MTU on each hop vs intent; look for oversize/giant drops.
3. Restore intended MTU on the single mismatched interface. Verify small *and* large probes both ways and throughput.

## Evidence hygiene
- Record source (SIMULATED / LINUX LAB / IMPORTED SAMPLE), parameters, time, raw output, interpretation and limitations for every observation.
- New readings are new records; never edit old evidence.
- Cite evidence in the diagnosis; note contradicting evidence on hypotheses.
