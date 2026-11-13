# Known limitations

**Simulation fidelity**
- Device output imitates a *generic* switch CLI and Linux tools; it is not any vendor's exact format.
- Throughput uses a simplified model (link rate × framing efficiency × an exponential loss factor) — not a TCP prediction. RTTs use a simple latency model with seeded jitter.
- Optical readings come from a power-budget model (attenuation × length + 0.3 dB assumed per mated pair + modeled contamination). Thresholds are fixture values; DOM accuracy effects are not modeled.
- Connector inspection/cleaning/replacement are *recorded procedures* in simulation; no physical action happens.
- MTU is modeled as L3 MTU on every hop (some platforms configure L2 frame MTU).
- One fabric (North Lab Fabric); inventory editing is limited to adding/removing operator-entered cable records.

**Linux lab**
- Provided and unit-tested at the safety boundary, **not live-validated** (authoring machine was macOS without Docker). The Docker `linux-lab` profile is experimental.
- veth links have no optics; low-Rx is simulation-only. veth throughput reflects CPU, not NIC/optic limits.
- The lab backend's interpretations are briefer than the simulation's.

**Timing & metrics**
- Wall-clock workflow times measure operator interaction. Simulated network time is separate and labeled. Detection latency exists only for the low-Rx scenario (simulated 60 s DOM poll). No MTTD claims.
- Throughput baseline comparisons are single runs (n = 1 each), shown as such.

**Product**
- Single-user, no authentication (intended for localhost). CORS limited to the dev origins.
- SSE uses 1 s DB polling (simple and restart-safe, not high-throughput).
- Imported evidence supports one format (`fiberscope.optical-observation.v1`); values are range-checked only and labeled untrusted.
- Docker Compose was written but not executed in the authoring environment.
- Scenario definitions are versioned in code; there is no UI to author new scenarios.
