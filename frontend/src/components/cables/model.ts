import type { Cable, PathHop, Topology, TracedPath } from '../../lib/types'

export const OPERATOR_SOURCE = 'operator-entered record'
export const isOperator = (c: Pick<Cable, 'source'>) => c.source === OPERATOR_SOURCE

export const KIND_LABEL: Record<string, string> = { patch: 'Patch cord', direct: 'Direct', trunk_pair: 'Trunk pair' }
export const MEDIA_LABEL: Record<string, string> = { fiber: 'Fiber', copper: 'Copper', dac: 'DAC' }

/** Nominal length as recorded; null means unknown (never invented). */
export const fmtLen = (m: number | null | undefined) => (m == null ? null : `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)} m`)

/** "srv-a:eth0" → { dev: "srv-a", port: "eth0" } */
export const splitEp = (id: string | null) => (id ? { dev: id.split(':')[0], port: id.split(':').slice(1).join(':') } : null)

/** URL encoded in printed label QR codes. */
export const labelUrl = (id: string) => `${window.location.origin}/cables?id=${encodeURIComponent(id)}`

/**
 * Pick the interface to trace from so the documented path is shown end-to-end:
 * prefer an active (non-passive) endpoint; for trunk pairs between two panels,
 * use the link whose documented path contains this cable; otherwise end A.
 */
export function traceStartFor(c: Cable, topo: Topology | undefined): string | null {
  if (!c.a && !c.b) return null
  if (!topo) return c.a ?? c.b
  const passive = new Set(topo.devices.filter((d) => d.is_passive).map((d) => d.id))
  if (c.a && !passive.has(c.a_device ?? c.a.split(':')[0])) return c.a
  if (c.b && !passive.has(c.b_device ?? c.b.split(':')[0])) return c.b
  const link = topo.links.find((l) => l.path.cables.includes(c.id))
  if (link) return link.a
  return c.a ?? c.b
}

/**
 * Interfaces to trace from. Normally one (see traceStartFor). When both ends sit on
 * passive panels and no documented link contains the cable (e.g. a spare trunk pair),
 * trace from both ends so each direction's record gap is visible.
 */
export function traceStartsFor(c: Cable, topo: Topology | undefined): string[] {
  const start = traceStartFor(c, topo)
  if (!start || !topo) return start ? [start] : []
  const passive = new Set(topo.devices.filter((d) => d.is_passive).map((d) => d.id))
  const bothPassive = !!c.a && !!c.b && passive.has(c.a.split(':')[0]) && passive.has(c.b.split(':')[0])
  const linked = topo.links.some((l) => l.path.cables.includes(c.id))
  return bothPassive && !linked ? [c.a!, c.b!] : [start]
}

/* Hops from the backend are a flat list (interface, cable, patch_mapping, gap).
 * For display we fold "port → patch mapping → port" on the same passive panel
 * into one panel-crossing node, so the chain reads like the physical path. */
export type Segment =
  | { type: 'port'; hop: PathHop; endpoint: boolean }
  | { type: 'cable'; hop: PathHop }
  | { type: 'panel'; device: string; front: PathHop; mapping: PathHop; rear: PathHop }
  | { type: 'gap'; hop: PathHop }

export function segmentsOf(path: TracedPath): Segment[] {
  const out: Segment[] = []
  const h = path.hops
  for (let i = 0; i < h.length; i++) {
    const hop = h[i]
    if (hop.kind === 'interface' && h[i + 1]?.kind === 'patch_mapping' && h[i + 2]?.kind === 'interface') {
      out.push({ type: 'panel', device: hop.device_id ?? '', front: hop, mapping: h[i + 1], rear: h[i + 2] })
      i += 2
    } else if (hop.kind === 'interface') {
      out.push({ type: 'port', hop, endpoint: i === 0 || i === h.length - 1 })
    } else if (hop.kind === 'cable') {
      out.push({ type: 'cable', hop })
    } else if (hop.kind === 'patch_mapping') {
      // mapping without both ports in sequence — still show it as a crossing
      out.push({ type: 'panel', device: hop.device_id ?? '', front: hop, mapping: hop, rear: hop })
    } else {
      out.push({ type: 'gap', hop })
    }
  }
  return out
}
