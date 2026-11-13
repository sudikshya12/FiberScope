# Interview demonstration script

**Setup (before the interview):** start the API and web app, open `http://127.0.0.1:5188/` and check that the sidebar shows **API connected**. Open `/present?story=vlan` in a second tab. A fresh story creates its own investigation. If you rehearsed, use the story switcher or open the URL without `&inv=` to start clean.

Say it up front: *"This is an independent lab I built. The device output is simulated by a deterministic model, and it's labeled SIMULATED everywhere."*

## Three-minute walkthrough: "A server is unreachable, but its physical link is up"

| # | Click | Say (one sentence) | Point at |
|---|---|---|---|
| 1 | **Capture baseline** | "First I record what working looks like, so recovery has something to be compared against." | 10/10 pings and throughput in the baseline evidence |
| 2 | **Introduce fault** | "The lab changes one piece of state and hides where. I only get the ticket." | The symptom quote |
| 3 | **Ping Server A → Server B** | "That's a symptom, not a location. 'Destination Host Unreachable' means ARP failed." | Server B is marked *Unreachable*, not faulty |
| 4 | **Read both ends** | "Admin up, operationally up at both ends, so I'm not touching cables." | The links stay green |
| 5 | **Inspect VLANs on asw-2** | "The running config says VLAN 30 and the documented intent says 20." | The `VLAN 30≠20` port tag |
| 6 | **Record diagnosis** | "I write it down and cite the evidence before I change anything." | The cited evidence IDs |
| 7 | **Set asw-2 Eth1/1 → VLAN 20** | "One port, back to intent. A repair isn't a resolution." | Changed resources: one port |
| 8 | **Run verification** | "These checks belong to this scenario: VLAN config, ARP, both directions, and throughput against the identical baseline run." | Checks ticking in |
| 9 | **Resolve & open report** | "Resolution unlocks only when the criteria are met, and the report is built from stored evidence, with hashes." | Report sections 7–10 |

If something fails, say so and show the evidence. The UI never claims success that the API didn't return.

## Optional extension (about 2 minutes): low receive power, `/present?story=optical`

- **The alarm is a trigger, not a diagnosis.**
- **Read both ends:** "Rx at asw-1 is below *this module's* warning threshold. That's evidence of a degraded path, not a broken part."
- **Compare directions:** "Server A transmits normally and the reverse direction is fine, so the problem is one fiber, toward asw-1. About 9.7 dB against a 1.3 dB planning budget. That's an estimate, not OTDR."
- **Trace, then inspect:** "I list every mated point, then inspect from the receiver backwards with a scope. I never look into the connector."
- **Clean only what failed, then verify:** check thresholds at both ends, the loss budget, link state and traffic.

## Likely questions

- **"Why not just reseat the cable?"** It changes evidence and risks other circuits. Changes follow a diagnosis.
- **"Why isn't one ping enough?"** The MTU scenario passes a default ping and still fails large packets. The verification shows that difference.
- **"What's real here?"** The workflow, the data model and the evidence rules are real. The device output is simulated. The optional Linux lab produces real Linux networking output, but no physical optics (see the README table).
- **"Where would you escalate?"** Trunk damage, repeated failures after a clean inspection, or a failure with no evidence for a specific part.

## Backup plan

If the API isn't reachable, show `docs/examples/report-wrong-vlan.json` and walk through `docs/SCENARIOS.md`.
