# Candidate preparation guide

Each idea below is explained through something you can show in FiberScope. An interactive version is in the app under **Troubleshooting guide** (`/learn`). Before claiming an example, practice it in the lab yourself. Talk only about tests you have actually run.

## 1. Administrative vs operational interface state
- **Administrative** state is what the device is configured to do (`shutdown` / `no shutdown`, `ip link set up`).
- **Operational** state is what the link is actually doing.
- *In FiberScope (admin-down):* `asw-1 Ethernet1/1` reads "is down (Administratively down)". Server A reads admin UP but `NO-CARRIER`, oper DOWN. The cause is configuration on the far end. A new optic would not help.

## 2. Physical connectivity vs VLAN connectivity
- A link can be perfectly up while the two hosts sit in different broadcast domains.
- *In FiberScope (wrong VLAN):* both ends of the Server B link are admin and oper up. `asw-2 Ethernet1/1` runs access VLAN 30 while its documented intent is VLAN 20, so Server A's ARP never reaches Server B. The topology keeps the physical link green and tags the port `VLAN 30≠20`.

## 3. Neighbor resolution
- ARP (IPv4) and ND (IPv6) map an IP address to a MAC address before any frame is sent.
- Linux reports "Destination Host Unreachable" when that fails. Neighbor states mean:
  - **REACHABLE:** recently confirmed.
  - **STALE:** cached but not recently confirmed. This is not a failure.
  - **FAILED / INCOMPLETE:** no answer.
- *In FiberScope:* after the VLAN fault, Server A's entry for 192.0.2.12 goes from STALE to FAILED once a probe runs. Verification requires it to be REACHABLE again with the expected MAC (`02:00:5e:10:00:12`).

## 4. Packet loss vs interface errors
- CRC/FCS and input errors point to the physical layer: optics, cabling, duplex.
- Loss with clean counters points elsewhere: queueing, policing, a faulty device, or a deliberate impairment.
- *In FiberScope (packet loss):* about 15% loss over 100 probes and throughput collapses, yet `asw-1 Ethernet1/49` shows zero CRC errors. The cause is an owned netem rule (`fs-imp-0001`). Software-injected loss does not create CRC errors.

## 5. MTU and fragmentation
- A packet's size is its payload plus headers: 28 bytes for IPv4+ICMP, 48 bytes for IPv6+ICMPv6.
- With DF set, a packet larger than any hop's MTU cannot be fragmented.
- Layer 2 switches drop oversize frames silently, with no ICMP "fragmentation needed".
- *In FiberScope (MTU mismatch):* the 56 B and 1472 B DF probes pass, but 8972 B (a 9000 B packet) fails. iperf3 connects, then stalls. `asw-2 Ethernet1/49` runs MTU 1500 against an intended 9216 and shows oversize drops.

## 6. Optical transmit vs receive power
- **Tx** is what a module launches. **Rx** is what arrives after the path's losses.
- Direction matters: estimated loss A→B = Tx(A) − Rx(B), using readings from the same moment and the same wavelength.
- *In FiberScope (low Rx):*
  - Server A Tx is −1.80 dBm and asw-1 Rx is −11.50 dBm, an estimated **9.70 dB** loss.
  - The documented planning budget is about 1.3 dB (35 m of OM4 plus four mated pairs at an assumed 0.3 dB each).
  - The reverse direction is about 1.3 dB, so the problem is one fiber, toward asw-1.
  - These are estimates from DOM readings, not OTDR or certification results.

## 7. Why thresholds depend on the optic
- Alarm and warning thresholds are stored in each module's EEPROM and differ by type, vendor and reach (compare the SR and LR fixtures).
- *In FiberScope:* Server B's third-party optic reports Rx −3.70 dBm but **no thresholds**, so its status is *UNKNOWN*, never "healthy". Missing values show as "Not reported", never 0.

## 8. Why a successful ping is insufficient verification
- A ping proves that small ICMP packets of that size got through at that moment. Nothing more.
- *In FiberScope:* the MTU scenario passes a default ping while bulk transfers fail. That is why every scenario has its own verification checks: configuration intent, large DF probes in both directions, neighbor state, and throughput against an *identical* baseline run with sample counts.

## 9. When to escalate rather than replace hardware
Escalate when:
- the fault is in structured cabling (FiberScope refuses to "replace" a trunk pair)
- a part keeps failing after a clean inspection
- the evidence doesn't point to a specific component
- the fix needs a change outside your authority or change window

Swapping parts without evidence uses up spares and can hide the real cause. In the optical drill, replacing the optic is allowed but fails verification. Fiber safety: never look into a connector or port, and use an inspection probe.

## Before presenting, make sure you can explain
- Why the topology shows **not observed** rather than green until evidence exists.
- What SIMULATED, LINUX LAB and IMPORTED SAMPLE mean, and why they are never mixed.
- Why resolution needs five criteria, including verification *after* the latest repair.
- What the Linux lab proves (real Linux networking behavior) and what it doesn't (physical optics or fiber).
