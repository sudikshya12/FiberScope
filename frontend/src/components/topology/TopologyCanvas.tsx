import { useEffect, useMemo, useRef, useState } from 'react'
import { Background, BackgroundVariant, ConnectionMode, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import clsx from 'clsx'
import * as Popover from '@radix-ui/react-popover'
import { AnimatePresence, motion } from 'motion/react'
import { Info, List, Maximize2, Route, Share2, X } from 'lucide-react'
import type { Iface, Topology } from '../../lib/types'
import { STATUS_META, type ObservationMap } from '../../lib/observations'
import { Segmented, Tip } from '../ui'
import { nodeTypes, type DeviceNodeData, type PanelNodeData, type PortVM } from './nodes'
import { edgeTypes, type LinkEdgeData } from './LinkEdge'
import { endpointPath, handleId, layoutFor, linkVlans, orientedHops, pathText, vlansOf, type View } from './layout'
import { TopologyList } from './TopologyList'

export type Selection = { kind: 'device' | 'interface' | 'cable' | 'link'; id: string } | null

interface Props {
  topo: Topology
  obs: ObservationMap
  selection: Selection
  onSelect: (s: Selection) => void
  focus?: { src: string; dst: string } | null
  height?: string
  compactToolbar?: boolean
  initialView?: View
  autoTrace?: boolean
  /** Short status note shown on the canvas (e.g. inventory-model disclaimer). */
  note?: string | null
  initialMode?: 'graph' | 'list'
}

const fiberShort = (f: string | null) => (f ? f.split(' ')[0] : '')
const FIT = { padding: 0.14, maxZoom: 1.15, minZoom: 0.7, duration: 0 }

function buildGraph(topo: Topology, obs: ObservationMap, view: View, selection: Selection, vlan: number | null, trace: { src: string; dst: string } | null, hovered: string | null, onSelect: (s: Selection) => void) {
  const L = layoutFor(view)
  const byIface: Record<string, Iface> = Object.fromEntries(topo.interfaces.map((i) => [i.id, i]))
  const selPort = selection?.kind === 'interface' ? selection.id : null
  const onSelectPort = (id: string) => onSelect({ kind: 'interface', id })

  const traceLinks = trace ? endpointPath(topo, trace.src, trace.dst) : []
  const traceLinkIdx = new Map(traceLinks.map((l, i) => [l.id, i]))
  const traceCableIdx = new Map<string, number>()
  if (trace && traceLinks.length) {
    let cur = topo.interfaces.find((i) => i.device_id === trace.src && (i.kind === 'data' || i.kind === 'routed'))!.id
    let n = 0
    traceLinks.forEach((l, idx) => {
      for (const h of orientedHops(l, cur)) if (h.kind === 'cable') traceCableIdx.set(h.id, n++)
      const end = l.a === cur ? l.b : l.a
      const next = traceLinks[idx + 1]
      if (next) cur = [next.a, next.b].find((x) => x.split(':')[0] === end.split(':')[0])!
    })
  }
  const carries = (iid: string) => vlan == null || vlansOf(byIface[iid]).includes(vlan)

  const portVM = (iid: string, side: PortVM['side']): PortVM => {
    const i = byIface[iid]
    let secondary: string | undefined
    if (view === 'physical') secondary = i.cable_id ?? 'unpatched'
    else if (i.switchport_mode === 'access') secondary = `VLAN ${i.intended_vlan}`
    else if (i.switchport_mode === 'trunk') secondary = `trunk ${(i.intended_allowed_vlans ?? []).join(',')}`
    else if (i.switchport_mode === 'routed') secondary = `VLAN ${i.intended_vlan}`
    else secondary = i.ipv4_cidr?.split('/')[0]
    return { iface: i, side, primary: i.name.replace('Ethernet', 'Eth'), secondary, obs: obs.iface[iid] ?? obs.optic[iid], matedObs: obs.mated[iid], config: obs.config[iid] }
  }

  const nodes: Node[] = []
  for (const d of topo.devices) {
    const lay = L[d.id]
    if (!lay) continue
    const dev = obs.device[d.id] ?? { incident: false, worst: 'unknown' as const, portWorst: 'unknown' as const, unreachable: false, reachableFrom: undefined }
    const portIds = Object.keys(lay.ports).filter((p) => byIface[p])
    const sel = selection?.kind === 'device' && selection.id === d.id
    if (d.role === 'patch_panel') {
      const fronts = portIds.filter((p) => byIface[p].kind === 'patch_front').sort()
      const rows = fronts.map((f) => ({ front: portVM(f, lay.ports[f]), rear: portVM(byIface[f].patch_peer!, lay.ports[byIface[f].patch_peer!]) }))
      nodes.push({ id: d.id, type: 'panel', position: { x: lay.x, y: lay.y }, selected: sel, data: { device: d, rows, frontSide: lay.ports[fronts[0]] === 'left' ? 'left' : 'right', selectedPort: selPort, onSelectPort, dimmed: vlan != null } satisfies PanelNodeData })
    } else {
      nodes.push({
        id: d.id, type: 'device', position: { x: lay.x, y: lay.y }, selected: sel,
        data: { device: d, ports: portIds.map((p) => portVM(p, lay.ports[p])), worst: dev.worst, portWorst: dev.portWorst, unreachable: dev.unreachable, incident: dev.incident, reach: dev.reachableFrom, selectedPort: selPort, onSelectPort, dimmed: vlan != null && !portIds.some(carries), view } satisfies DeviceNodeData,
      })
    }
  }

  const edges: Edge[] = []
  if (view === 'physical') {
    for (const c of topo.cables) {
      if (!c.a || !c.b) continue
      const ia = byIface[c.a]
      const ib = byIface[c.b]
      if (!L[ia.device_id] || !L[ib.device_id]) continue
      const link = topo.links.find((l) => l.path.cables.includes(c.id))
      const ls = link ? obs.link[link.id] : undefined
      edges.push({
        id: c.id, source: ia.device_id, target: ib.device_id, sourceHandle: handleId(c.a), targetHandle: handleId(c.b), type: 'link', zIndex: traceCableIdx.has(c.id) ? 5 : 1,
        data: {
          status: ls?.status ?? 'unknown', stale: ls?.stale ?? false, title: c.id,
          detail: c.kind === 'trunk_pair' ? `${c.trunk_id} · MPO · ${c.nominal_length_m} m` : `${c.nominal_length_m ?? '?'} m ${fiberShort(c.fiber_type) || c.media.toUpperCase()}`,
          variant: !link ? 'spare' : c.kind === 'trunk_pair' ? 'trunk' : c.kind === 'direct' ? 'direct' : 'patch',
          trace: traceCableIdx.has(c.id), traceIndex: traceCableIdx.get(c.id) ?? 0, dimmed: vlan != null && !!link && !linkVlans(link, byIface).includes(vlan),
          selected: (selection?.kind === 'cable' && selection.id === c.id) || (selection?.kind === 'link' && !!link && selection.id === link.id),
          hovered: hovered === c.id, warn: c.label_status !== 'labeled' ? 'no label' : undefined, onSelect: () => onSelect({ kind: 'cable', id: c.id }),
        } satisfies LinkEdgeData,
      })
    }
  } else {
    for (const l of topo.links) {
      const ia = byIface[l.a]
      const ib = byIface[l.b]
      if (!L[ia.device_id] || !L[ib.device_id]) continue
      const vl = linkVlans(l, byIface)
      const ls = obs.link[l.id]
      const trunk = ia.switchport_mode === 'trunk' && ib.switchport_mode === 'trunk'
      edges.push({
        id: l.id, source: ia.device_id, target: ib.device_id, sourceHandle: handleId(l.a), targetHandle: handleId(l.b), type: 'link', zIndex: traceLinkIdx.has(l.id) ? 5 : 1,
        data: {
          status: ls?.status ?? 'unknown', stale: ls?.stale ?? false, title: trunk ? `trunk ${vl.join(',')}` : `VLAN ${vl.join(',')}`,
          detail: l.path.cables.join(' · '), variant: 'logical', trace: traceLinkIdx.has(l.id), traceIndex: traceLinkIdx.get(l.id) ?? 0,
          dimmed: vlan != null && !vl.includes(vlan), selected: selection?.kind === 'link' && selection.id === l.id, hovered: hovered === l.id,
          onSelect: () => onSelect({ kind: 'link', id: l.id }),
        } satisfies LinkEdgeData,
      })
    }
  }
  return { nodes, edges }
}

function Legend() {
  return (
    <Popover.Root>
      <Popover.Trigger className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-muted outline-none hover:bg-canvas hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/30">
        <Info className="size-3.5" aria-hidden /> Legend
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-[60] w-[280px] rounded-lg border border-line bg-white p-3 text-[12.5px] shadow-[var(--shadow-pop)]">
          <ul className="space-y-1.5">
            {(['up', 'degraded', 'down', 'unknown'] as const).map((s) => (
              <li key={s} className="flex items-center gap-2">
                <span className="grid size-4 place-items-center rounded-full font-mono text-[9px] font-bold text-white" style={{ background: s === 'unknown' ? 'transparent' : STATUS_META[s].color, border: s === 'unknown' ? '1px dashed #a9a4b0' : undefined, color: s === 'unknown' ? '#8a8692' : undefined }}>
                  {STATUS_META[s].symbol}
                </span>
                <span className="text-ink">{s === 'unknown' ? 'Not observed (dashed link)' : `Observed ${STATUS_META[s].label.toLowerCase()}`}</span>
              </li>
            ))}
            <li className="flex items-center gap-2">
              <span className="h-[3px] w-4 rounded bg-accent" aria-hidden />
              <span className="text-ink">Selected or traced path</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="size-3.5 rounded border border-dashed border-[#bdb7c4]" aria-hidden />
              <span className="text-ink">Passive panel (modeled)</span>
            </li>
          </ul>
          <p className="mt-2 border-t border-line-2 pt-2 text-muted">Status comes only from collected evidence. Hover or select a link for cable details; zoom in for port names.</p>
          <Popover.Arrow className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Inner({ topo, obs, selection, onSelect, focus, height = 'h-full', compactToolbar, initialView = 'physical', autoTrace, note, initialMode = 'graph' }: Props) {
  const [view, setView] = useState<View>(initialView)
  const [mode, setMode] = useState<'graph' | 'list'>(initialMode)
  const [vlan, setVlan] = useState<number | null>(null)
  const [trace, setTrace] = useState<{ src: string; dst: string } | null>(autoTrace && focus ? focus : null)
  const [traceKey, setTraceKey] = useState(0)
  const [hovered, setHovered] = useState<string | null>(null)
  const rf = useReactFlow()
  const graph = useMemo(() => buildGraph(topo, obs, view, selection, vlan, trace, hovered, onSelect), [topo, obs, view, selection, vlan, trace, hovered, onSelect])
  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ ...FIT, duration: 350 }), 60)
    return () => clearTimeout(t)
  }, [view, mode, rf])
  const f = focus ?? { src: 'srv-a', dst: 'srv-b' }
  const text = trace ? pathText(topo, trace.src, trace.dst) : null
  const traced = trace ? endpointPath(topo, trace.src, trace.dst) : []
  const [showText, setShowText] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let t: ReturnType<typeof setTimeout>
    const ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => rf.fitView({ ...FIT, duration: 300 }), 120)
    })
    ro.observe(el)
    return () => {
      clearTimeout(t)
      ro.disconnect()
    }
  }, [rf, mode])

  return (
    <div className={clsx('flex w-full flex-col overflow-hidden', height)} role="region" aria-label={`Network topology, ${view} view`}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-2 bg-white px-3 py-1.5">
        <Segmented label="Topology view" value={view} onChange={setView} options={[{ value: 'physical', label: 'Physical' }, { value: 'logical', label: 'Logical' }]} />
        <Segmented
          label="Display"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'graph', label: <span className="flex items-center gap-1" title="Graph"><Share2 className="size-3.5" aria-hidden /><span className="sr-only sm:not-sr-only">Graph</span></span> },
            { value: 'list', label: <span className="flex items-center gap-1" title="List view"><List className="size-3.5" aria-hidden /><span className="sr-only sm:not-sr-only">List</span></span> },
          ]}
        />
        {mode === 'graph' && (
          <>
            <button
              onClick={() => {
                if (trace) setTrace(null)
                else {
                  setTrace(f)
                  setTraceKey((k) => k + 1)
                }
              }}
              aria-pressed={!!trace}
              className={clsx('flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12.5px] font-medium transition-colors', trace ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-ink hover:bg-canvas')}
            >
              <Route className="size-3.5" aria-hidden /> Trace path
            </button>
            {!compactToolbar && view === 'logical' && (
              <select aria-label="Filter by VLAN" className="h-7 rounded-md border border-line bg-white px-1.5 text-[12.5px] text-ink" value={vlan ?? ''} onChange={(e) => setVlan(e.target.value ? Number(e.target.value) : null)}>
                <option value="">All VLANs</option>
                {topo.vlans.map((v) => (
                  <option key={v.id} value={v.id}>
                    VLAN {v.id} {v.name}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Legend />
          {mode === 'graph' && (
            <Tip content="Fit to screen">
              <button onClick={() => rf.fitView({ ...FIT, duration: 350 })} className="grid size-7 place-items-center rounded-md text-muted hover:bg-canvas hover:text-ink" aria-label="Fit to screen">
                <Maximize2 className="size-3.5" />
              </button>
            </Tip>
          )}
        </div>
      </div>
      <div ref={boxRef} className="relative min-h-0 flex-1">
        {mode === 'list' ? (
          <TopologyList topo={topo} obs={obs} focus={f} onSelect={onSelect} selection={selection} />
        ) : (
          <ReactFlow
            key={`${view}-${traceKey}`}
            nodes={graph.nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            connectionMode={ConnectionMode.Loose}
            nodesConnectable={false}
            nodesDraggable={false}
            onNodeClick={(_, n) => onSelect({ kind: 'device', id: n.id })}
            onEdgeMouseEnter={(_, e) => setHovered(e.id)}
            onEdgeMouseLeave={() => setHovered(null)}
            onPaneClick={() => onSelect(null)}
            fitView
            fitViewOptions={FIT}
            minZoom={0.5}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            className="grid-bg"
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#dcd8e0" />
            <Controls showInteractive={false} showFitView={false} position="bottom-right" />
          </ReactFlow>
        )}
        {mode === 'graph' && (note || !selection) && !text && (
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2">
            {note && <span className="rounded-md border border-line bg-white px-2.5 py-1 text-[12px] text-muted">{note}</span>}
            {!selection && <span className="rounded-md bg-white/80 px-2.5 py-1 text-[12px] text-faint">Select a device or cable to inspect.</span>}
          </div>
        )}
        <AnimatePresence>
          {text && mode === 'graph' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} className="absolute bottom-3 left-3 max-w-[min(560px,calc(100%-5rem))]">
              <div className="rounded-lg border border-line bg-white/95 shadow-[var(--shadow-lift)] backdrop-blur-[1px]">
                <div className="flex items-center gap-3 px-3 py-2">
                  <span className="size-2 rounded-full bg-accent" aria-hidden />
                  <span className="text-[12.5px] text-ink">
                    <span className="font-semibold">{f.src} → {f.dst}</span>
                    <span className="text-muted">
                      {' '}· {traced.length} links · {traced.reduce((n, l) => n + l.path.cables.length, 0)} cable segments · {traced.reduce((n, l) => n + l.path.mated_points.length, 0)} panel connections
                    </span>
                  </span>
                  <button onClick={() => setShowText((v) => !v)} aria-expanded={showText} className="text-[12px] font-medium text-accent hover:underline">
                    {showText ? 'Hide text' : 'Text path'}
                  </button>
                  <button onClick={() => setTrace(null)} className="grid size-6 place-items-center rounded text-muted hover:bg-canvas" aria-label="Clear path trace">
                    <X className="size-3.5" />
                  </button>
                </div>
                {showText && (
                  <p className="break-words border-t border-line-2 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink" aria-live="polite">
                    {text}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function TopologyCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  )
}
