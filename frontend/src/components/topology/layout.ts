import type { Iface, Link, Topology } from '../../lib/types'

export type Side = 'left' | 'right' | 'top' | 'bottom'
export type View = 'logical' | 'physical'

interface NodeLayout {
  x: number
  y: number
  ports: Record<string, Side> // iface id -> side
}

export const PHYSICAL: Record<string, NodeLayout> = {
  'srv-a': { x: 0, y: 30, ports: { 'srv-a:eth0': 'right' } },
  'srv-b': { x: 0, y: 290, ports: { 'srv-b:eth0': 'right' } },
  'pp-01': { x: 330, y: 130, ports: { 'pp-01:F01': 'left', 'pp-01:F02': 'left', 'pp-01:F03': 'left', 'pp-01:R01': 'right', 'pp-01:R02': 'right', 'pp-01:R03': 'right' } },
  'pp-02': { x: 610, y: 130, ports: { 'pp-02:R01': 'left', 'pp-02:R02': 'left', 'pp-02:R03': 'left', 'pp-02:F01': 'right', 'pp-02:F02': 'right', 'pp-02:F03': 'right' } },
  'asw-1': { x: 890, y: 30, ports: { 'asw-1:Ethernet1/1': 'left', 'asw-1:Ethernet1/49': 'bottom', 'asw-1:Ethernet1/50': 'top' } },
  'asw-2': { x: 890, y: 290, ports: { 'asw-2:Ethernet1/49': 'top', 'asw-2:Ethernet1/1': 'left', 'asw-2:Ethernet1/2': 'left' } },
  'gw-1': { x: 890, y: -140, ports: { 'gw-1:xe-0/0/0': 'bottom' } },
}

export const LOGICAL: Record<string, NodeLayout> = {
  'srv-a': { x: 0, y: 200, ports: { 'srv-a:eth0': 'right' } },
  'asw-1': { x: 340, y: 200, ports: { 'asw-1:Ethernet1/1': 'left', 'asw-1:Ethernet1/49': 'right', 'asw-1:Ethernet1/50': 'top' } },
  'asw-2': { x: 680, y: 200, ports: { 'asw-2:Ethernet1/49': 'left', 'asw-2:Ethernet1/1': 'right' } },
  'srv-b': { x: 1020, y: 200, ports: { 'srv-b:eth0': 'left' } },
  'gw-1': { x: 340, y: 20, ports: { 'gw-1:xe-0/0/0': 'bottom' } },
}

export const layoutFor = (v: View) => (v === 'physical' ? PHYSICAL : LOGICAL)

export const handleId = (iface: string) => iface.replace(/[^a-zA-Z0-9]/g, '_')

/** Documented VLANs carried by an interface (intent, not observation). */
export function vlansOf(i: Iface | undefined): number[] {
  if (!i) return []
  if (i.switchport_mode === 'trunk') return i.intended_allowed_vlans ?? []
  if (i.intended_vlan) return [i.intended_vlan]
  return []
}

export function linkVlans(l: Link, byId: Record<string, Iface>): number[] {
  const a = vlansOf(byId[l.a])
  const b = vlansOf(byId[l.b])
  if (!a.length) return b
  if (!b.length) return a
  return a.filter((v) => b.includes(v))
}

/** Ordered L1 links on the documented forwarding path between two hosts. */
export function endpointPath(topo: Topology, src: string, dst: string): Link[] {
  const byIface = new Map(topo.interfaces.map((i) => [i.id, i]))
  const hostIf = (h: string) => topo.interfaces.find((i) => i.device_id === h && (i.kind === 'data' || i.kind === 'routed'))
  const s = hostIf(src)
  const d = hostIf(dst)
  if (!s || !d || !s.link_id || !d.link_id) return []
  const ls = topo.links.find((l) => l.id === s.link_id)!
  const ld = topo.links.find((l) => l.id === d.link_id)!
  const swS = byIface.get(s.peer ?? '')?.device_id
  const swD = byIface.get(d.peer ?? '')?.device_id
  if (swS === swD) return [ls, ld]
  const uplink = topo.links.find((l) => [l.a, l.b].every((x) => byIface.get(x)?.kind === 'uplink') && new Set([byIface.get(l.a)?.device_id, byIface.get(l.b)?.device_id]).has(swS) && new Set([byIface.get(l.a)?.device_id, byIface.get(l.b)?.device_id]).has(swD))
  return uplink ? [ls, uplink, ld] : [ls, ld]
}

/** Path hops oriented to start at `from`. */
export function orientedHops(l: Link, from: string) {
  return l.path.start === from ? l.path.hops : [...l.path.hops].reverse()
}

export function pathText(topo: Topology, src: string, dst: string): string {
  const links = endpointPath(topo, src, dst)
  if (!links.length) return 'No documented path between these endpoints.'
  const hostIf = (h: string) => topo.interfaces.find((i) => i.device_id === h && (i.kind === 'data' || i.kind === 'routed'))!
  let cur = hostIf(src).id
  const parts: string[] = []
  links.forEach((l, idx) => {
    const hops = orientedHops(l, cur)
    hops.forEach((h, j) => {
      if (idx > 0 && j === 0) return
      parts.push(h.kind === 'patch_mapping' ? `[${h.label}]` : h.label.replace('Ethernet', 'Eth'))
    })
    const end = l.a === cur ? l.b : l.a
    const next = links[idx + 1]
    if (next) {
      const nextStart = [next.a, next.b].find((x) => x.split(':')[0] === end.split(':')[0])!
      parts.push(`⇢ ${nextStart.split(':')[1].replace('Ethernet', 'Eth')} (switched)`)
      cur = nextStart
    }
  })
  return parts.join(' → ').replace(/→ ⇢/g, '⇢')
}
