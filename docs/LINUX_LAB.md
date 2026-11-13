# Optional Linux lab: setup and teardown

> **Status: provided, not live-validated.** The runner's safety boundary is covered by unit tests: allowlist, ownership, argv-only commands, timeouts, output bounds and activation guards. Actually creating namespaces was **not** run in the authoring environment, which was macOS with no Docker. Treat the first run as a validation exercise.

Simulation mode is fully functional without any of this. The Linux lab adds *real* Linux networking for four scenarios: wrong VLAN, admin-down, packet loss and MTU mismatch. It uses isolated network namespaces, veth pairs and VLAN-aware bridges. **Virtual Ethernet does not exercise optics or fiber**, so the low-Rx scenario stays simulation-only.

## What it creates

| Namespace | Plays | Devices inside |
|---|---|---|
| `fslab-srva` | Server A | `eth0` 192.0.2.11/24, MTU 9000 |
| `fslab-srvb` | Server B | `eth0` 192.0.2.12/24, MTU 9000 |
| `fslab-sw1` | asw-1 | `br0` (vlan_filtering=1), ports `p1` (access 20), `up` (trunk 20,30), `gw` (trunk 20) |
| `fslab-sw2` | asw-2 | `br0`, ports `p1` (access 20), `up` (trunk 20,30) |
| `fslab-gw` | gateway | `xe0`, `xe0.20` 192.0.2.1/24 |

Every veth is created **directly inside** lab namespaces, so no interface is ever added to the root namespace. Every link carries the alias `fiberscope-owned:<ns>:<dev>`. Owned namespaces and impairments are recorded in `/run/fiberscope-lab/owned.json`. Commands are logged to `/var/log/fiberscope-lab/audit.jsonl`.

It never touches the host's interfaces, default route, DNS or firewall. The lab namespaces have no connection to the host network.

## Requirements

- A **dedicated Linux VM** is recommended (for example Ubuntu 24.04 under UTM, Multipass, VirtualBox or WSL2 with a recent kernel).
- `iproute2` (`ip`, `bridge`, `tc`) and `iputils-ping`. `iperf3` is optional and needed for throughput checks.
- Root privileges, **plus** explicit activation (`FIBERSCOPE_LAB_ENABLE=1` **and** `--i-understand`).

## Setup

```bash
# inside the Linux VM, from the repo root
sudo FIBERSCOPE_LAB_ENABLE=1 python3 labrunner/fiberscope_labrunner.py check
sudo FIBERSCOPE_LAB_ENABLE=1 python3 labrunner/fiberscope_labrunner.py setup --i-understand

# token: at least 32 characters, mode 0600
sudo install -d -m 700 /etc/fiberscope-lab
openssl rand -hex 24 | sudo tee /etc/fiberscope-lab/token >/dev/null && sudo chmod 600 /etc/fiberscope-lab/token

sudo FIBERSCOPE_LAB_ENABLE=1 python3 labrunner/fiberscope_labrunner.py serve \
     --token-file /etc/fiberscope-lab/token --i-understand          # listens on 127.0.0.1:8765 only

# API in the same VM (unprivileged user)
cd backend
FIBERSCOPE_LINUX_LAB_ENABLED=1 FIBERSCOPE_LAB_RUNNER_TOKEN="$(sudo cat /etc/fiberscope-lab/token)" \
  uv run uvicorn app.main:app --host 127.0.0.1 --port 8077
```

**Settings → Lab mode** should now report *READY*. Create a Linux-lab investigation through the API:
`POST /api/investigations {"scenario_key":"wrong-vlan","source_mode":"LINUX_LAB"}`. Evidence will be labeled **LINUX LAB**.

## Teardown and recovery

```bash
sudo FIBERSCOPE_LAB_ENABLE=1 python3 labrunner/fiberscope_labrunner.py restore --i-understand   # undo faults, keep lab
sudo FIBERSCOPE_LAB_ENABLE=1 python3 labrunner/fiberscope_labrunner.py teardown --i-understand  # delete owned namespaces
sudo python3 labrunner/fiberscope_labrunner.py status
```

- `setup` is safe to rerun. It tears down recorded leftovers first, and it **refuses** if an `fslab-*` namespace exists that is not recorded as owned.
- Teardown deletes only namespaces that are in the owned record *and* in the fixed allowlist. It stops only the iperf3 servers that the runner started (by pidfile).
- Manual last resort, after inspecting first: `ip netns list | grep '^fslab-'`, then `sudo ip netns del <name>` for each one you are sure belongs to the lab.

## Docker profile (experimental)

`docker compose --profile linux-lab up` runs the runner with `NET_ADMIN` and `SYS_ADMIN`, sharing **only the API container's** network namespace so the API can reach it on loopback. The host network is untouched. See the comments in `docker-compose.yml`. This profile is not validated; the VM path above is preferred.

## Runner request schema

`POST /v1/run` with `Authorization: Bearer <token>`:

```json
{"op": "diagnostic", "action": "reachability", "target": {"src": "srv-a", "dst": "srv-b"}, "params": {"count": 10}}
{"op": "fault", "scenario": "wrong-vlan"}
{"op": "repair", "action": "set_access_vlan", "target": {"interface": "asw-2:Ethernet1/1"}, "params": {"vlan": 20}}
{"op": "restore_baseline"}   {"op": "status"}
```

Unknown ops, actions or fields are rejected. Targets must be allowlisted logical IDs, so no IP address or interface name is accepted from the request.
