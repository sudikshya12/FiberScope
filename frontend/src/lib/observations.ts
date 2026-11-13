import type { Evidence, Investigation, Link, Topology } from './types'

export type ElemStatus = 'up' | 'down' | 'degraded' | 'unknown'

export interface ElemObs {
  status: ElemStatus
  raw: string
  label: string
  evidenceId: string
  at: string
  stale: boolean // observed before the fault was introduced
  phase: Evidence['phase']
}

export interface ObservationMap {
  iface: Record<string, ElemObs>
  optic: Record<string, ElemObs>
  reach: Record<string, ElemObs>
  mated: Record<string, ElemObs>
  config: Record<string, ElemObs> // configuration-vs-intent observations (e.g. VLAN mismatch) — not L1 state
  link: Record<string, ElemObs & { ends: number }>
  device: Record<string, { incident: boolean; worst: ElemStatus; portWorst: ElemStatus; unreachable: boolean; reachableFrom?: ElemObs }>
  lastEvidenceAt: string | null
}

const norm = (s: string): ElemStatus => {
  if (s === 'up' || s === 'ok') return 'up'
  if (s === 'down' || s === 'admin_down') return 'down'
  if (s === 'degraded' || s === 'mismatch') return 'degraded'
  return 'unknown'
}

const rank: Record<ElemStatus, number> = { unknown: 0, up: 1, degraded: 2, down: 3 }

/** Aggregate the *latest observation per element* from collected evidence. Nothing is inferred
 *  from hidden scenario state — the topology only shows what evidence has established. */
export function aggregate(inv: Investigation | undefined, topo: Topology | undefined): ObservationMap {
  const out: ObservationMap = { iface: {}, optic: {}, reach: {}, mated: {}, config: {}, link: {}, device: {}, lastEvidenceAt: null }
  if (!inv || !topo) return out
  const faultAt = inv.execution.fault_injected_at ? new Date(inv.execution.fault_injected_at).getTime() : null
  for (const e of inv.evidence) {
    out.lastEvidenceAt = e.collected_at
    const stale = faultAt != null && new Date(e.collected_at).getTime() < faultAt
    for (const o of e.observations) {
      const rec: ElemObs = { status: norm(o.status), raw: o.status, label: o.label ?? '', evidenceId: e.id, at: e.collected_at, stale, phase: e.phase }
      if (o.kind === 'interface' && o.status === 'mismatch') out.config[o.id] = rec
      else if (o.kind === 'interface') out.iface[o.id] = rec
      else if (o.kind === 'interface_vlan') out.config[o.id] = { ...rec, status: 'up' }
      else if (o.kind === 'optic') out.optic[o.id] = rec
      else if (o.kind === 'reachability' || o.kind === 'neighbor') out.reach[o.id] = rec
      else if (o.kind === 'mated_point') out.mated[o.id] = rec
    }
  }
  for (const l of topo.links) out.link[l.id] = linkStatus(l, out)
  for (const d of topo.devices) {
    const ifs = topo.interfaces.filter((i) => i.device_id === d.id)
    let worst: ElemStatus = 'unknown'
    for (const i of ifs) {
      for (const src of [out.iface[i.id], out.optic[i.id], out.config[i.id]]) {
        if (src && !src.stale && rank[src.status] > rank[worst]) worst = src.status
      }
    }
    const portWorst = worst
    const reachableFrom = Object.entries(out.reach)
      .filter(([k]) => k.endsWith(`->${d.id}`))
      .map(([, v]) => v)
      .sort((a, b) => (a.at < b.at ? 1 : -1))[0]
    const unreachable = !!reachableFrom && !reachableFrom.stale && reachableFrom.status !== 'up'
    if (unreachable && rank[reachableFrom!.status] > rank[worst]) worst = reachableFrom!.status
    out.device[d.id] = { incident: worst === 'down' || worst === 'degraded', worst, portWorst, unreachable, reachableFrom }
  }
  return out
}

function linkStatus(l: Link, m: ObservationMap): ElemObs & { ends: number } {
  const ends = [l.a, l.b].map((i) => m.iface[i] ?? m.optic[i]).filter(Boolean) as ElemObs[]
  const optics = [l.a, l.b].map((i) => m.optic[i]).filter(Boolean) as ElemObs[]
  const mated = l.path.mated_points.map((p) => m.mated[p]).filter(Boolean) as ElemObs[]
  const all = [...ends, ...optics, ...mated]
  if (!all.length) return { status: 'unknown', raw: 'unknown', label: 'not observed', evidenceId: '', at: '', stale: false, phase: 'investigation', ends: 0 }
  const latest = all.reduce((a, b) => (a.at > b.at ? a : b))
  const fresh = all.filter((o) => !o.stale)
  const pool = fresh.length ? fresh : all
  let worst: ElemObs = pool[0]
  for (const o of pool) if (rank[o.status] > rank[worst.status]) worst = o
  const status: ElemStatus = worst.status === 'up' && ends.length < 2 && !optics.length ? 'up' : worst.status
  return { ...worst, status, at: latest.at, stale: !fresh.length, ends: ends.length }
}

export const STATUS_META: Record<ElemStatus, { label: string; symbol: string; color: string; soft: string; text: string }> = {
  up: { label: 'Up', symbol: '●', color: '#26734D', soft: '#E7F2EB', text: 'text-ok' },
  degraded: { label: 'Degraded', symbol: '▲', color: '#986300', soft: '#FBF1DE', text: 'text-warn' },
  down: { label: 'Down', symbol: '✕', color: '#BE3545', soft: '#FBEAEC', text: 'text-crit' },
  unknown: { label: 'Not observed', symbol: '?', color: '#8A8692', soft: '#EFEDF2', text: 'text-unknown' },
}
