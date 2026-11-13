import { describe, expect, it } from 'vitest'
import { aggregate } from './observations'
import type { Evidence, Investigation, Topology } from './types'

const topo = {
  devices: [
    { id: 'srv-b', role: 'server' },
    { id: 'asw-2', role: 'access_switch' },
  ],
  interfaces: [
    { id: 'srv-b:eth0', device_id: 'srv-b' },
    { id: 'asw-2:Ethernet1/1', device_id: 'asw-2' },
  ],
  links: [{ id: 'L1', a: 'asw-2:Ethernet1/1', b: 'srv-b:eth0', path: { mated_points: [], cables: ['CBL-F202'] } }],
} as unknown as Topology

const ev = (id: string, at: string, observations: Evidence['observations']): Evidence => ({ id, collected_at: at, phase: 'investigation', observations } as unknown as Evidence)
const inv = (evidence: Evidence[]) => ({ evidence, execution: { fault_injected_at: '2026-01-01T00:00:00Z' } }) as unknown as Investigation

describe('aggregate (topology status from evidence only)', () => {
  it('shows nothing as observed when no evidence exists', () => {
    const m = aggregate(inv([]), topo)
    expect(m.link.L1.status).toBe('unknown')
    expect(m.device['srv-b'].worst).toBe('unknown')
  })

  it('a VLAN mismatch does not mark the physical link degraded', () => {
    const m = aggregate(
      inv([
        ev('E1', '2026-01-01T00:01:00Z', [{ kind: 'interface', id: 'asw-2:Ethernet1/1', status: 'up' }]),
        ev('E2', '2026-01-01T00:02:00Z', [{ kind: 'interface', id: 'asw-2:Ethernet1/1', status: 'mismatch', label: 'VLAN 30 ≠ intended 20' }]),
      ]),
      topo,
    )
    expect(m.link.L1.status).toBe('up')
    expect(m.config['asw-2:Ethernet1/1'].status).toBe('degraded')
    expect(m.device['asw-2'].portWorst).toBe('degraded')
  })

  it('an unreachable server is reported as a symptom, not a port fault', () => {
    const m = aggregate(inv([ev('E1', '2026-01-01T00:01:00Z', [{ kind: 'reachability', id: 'srv-a->srv-b', status: 'down' }])]), topo)
    expect(m.device['srv-b'].unreachable).toBe(true)
    expect(m.device['srv-b'].portWorst).toBe('unknown')
  })

  it('marks observations collected before the fault as stale', () => {
    const m = aggregate(inv([ev('E0', '2025-12-31T23:59:00Z', [{ kind: 'interface', id: 'srv-b:eth0', status: 'up' }])]), topo)
    expect(m.iface['srv-b:eth0'].stale).toBe(true)
  })
})
