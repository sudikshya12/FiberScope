# Scenario definitions (v1)

Source of truth: `backend/app/scenarios.py` (served at `GET /api/scenarios`). Every scenario starts from the same healthy baseline; reset restores only the selected execution and keeps evidence.

Common baseline: Server A (192.0.2.11) ↔ Server B (192.0.2.12) over VLAN 20 through `asw-1 Eth1/1 → uplink Eth1/49 (CBL-F301) → asw-2 Eth1/1`. Server A's physical path: `srv-a eth0 → CBL-F101 → PP-01 F01⇄R01 → TRK-0102-P1 (30 m OM4) → PP-02 R01⇄F01 → CBL-F201 → asw-1 Eth1/1`. Hosts MTU 9000, switch ports 9216.

| | Wrong VLAN | Admin-down | Low Rx power | Packet loss | MTU mismatch |
|---|---|---|---|---|---|
| **Objective** | L2 config vs physical failure | admin vs oper state | interpret low Rx without naming a part | quantify & locate loss; loss ≠ CRC | “ping works” ≠ all traffic works |
| **Fault mutation** | asw-2 Eth1/1 access VLAN 20→30 | asw-1 Eth1/1 shutdown | +8.4 dB excess loss on the srv-a→asw-1 fiber at one mated point (hidden) | owned netem rule `fs-imp-0001`, 15 % loss on asw-1 Eth1/49 egress | asw-2 Eth1/49 MTU 9216→1500 |
| **Symptoms** | link up both ends; ping “Destination Host Unreachable”; ARP FAILED; VLAN ≠ intent | srv-a NO-CARRIER; srv-a Rx LOS; switch “Administratively down” | DOM low-warning at asw-1 Eth1/1 (Rx −11.5 dBm vs −9.9 warn); link up | partial ping loss; throughput collapse; clean counters | 56 B and 1472 B DF pass, 8972 B fail; iperf stalls; oversize drops |
| **Plausible alternatives** | peer down, trunk pruning, addressing | cable/optic failure, err-disable, NIC disabled | contamination, excess path loss, weak remote Tx, wrong optic/fiber, sensor error | PHY errors, congestion, duplex mismatch | firewall dropping large ICMP, PMTUD black hole, host MTU |
| **Corrective action** | set VLAN 20 on that port only | enable that port only | inspect → clean (or replace cord) where inspection fails | remove only the owned rule | restore MTU 9216 on that interface |
| **Recovery checks** | VLAN intent on both switches; ARP REACHABLE with expected MAC; 10/10 both ways; throughput ≥90 % of baseline | admin+oper up both ends; 10/10 to srv-b and gateway | Rx within each module’s thresholds (unknown ≠ pass); loss estimate ≤ budget+1.5 dB; link up; 10/10; throughput ≥90 % | no owned rules; identical 100-probe test loss ≤ baseline; throughput ≥90 % | small DF 10/10; 56/1472/8972 DF both directions; MTU = intent on all 6 hops; throughput ≥90 % |
| **Modes** | SIM + Linux lab | SIM + Linux lab | SIM only | SIM + Linux lab | SIM + Linux lab |

Notes:
- Baseline comparisons use identical parameters (same endpoints, count, payload, duration, streams) and display sample counts.
- Low Rx: a simulated DOM poll (60 s) raises the alarm, so *simulated detection latency* is defined and labeled as such. Wrong repairs (e.g. replacing an optic) are allowed, recorded, and fail verification.
- Safety: inspection uses a video probe; the UI never instructs looking into a connector and never creates faults by damaging fiber.

## Diagnostic action catalog

reachability · interface_state · interface_counters · vlan_membership · neighbor_table · routing · throughput (≤10 s, ≤4 streams) · mtu_probe (≤6 sizes, DF) · optical_telemetry (both ends) · cable_trace (registry) · impairment_inspect · connector_inspection (simulated field record).

## Repair catalog

set_access_vlan · enable_interface · remove_impairment (ownership verified) · set_mtu · clean_connector · replace_patch_cable (not trunks — escalate) · replace_optic.
