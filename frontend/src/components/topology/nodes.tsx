import { memo, type CSSProperties } from 'react'
import { Handle, Position, useStore, type Node, type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import { Network, PanelTop, Router, Server } from 'lucide-react'
import { motion } from 'motion/react'
import type { Device, Iface } from '../../lib/types'
import type { ElemObs, ElemStatus } from '../../lib/observations'
import { STATUS_META } from '../../lib/observations'
import { handleId, type Side } from './layout'

export interface PortVM {
  iface: Iface
  side: Side
  primary: string
  secondary?: string
  obs?: ElemObs
  matedObs?: ElemObs
  config?: ElemObs
}

export interface DeviceNodeData extends Record<string, unknown> {
  device: Device
  ports: PortVM[]
  worst: ElemStatus
  portWorst: ElemStatus
  unreachable: boolean
  incident: boolean
  reach?: ElemObs
  selectedPort: string | null
  dimmed: boolean
  onSelectPort: (iface: string) => void
  view: 'logical' | 'physical'
}

const POS: Record<Side, Position> = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom }
const SIDES = ['top', 'left', 'right', 'bottom'] as const

export const ROLE: Record<Device['role'], { icon: typeof Server; label: string }> = {
  server: { icon: Server, label: 'Server' },
  access_switch: { icon: Network, label: 'Access switch' },
  gateway: { icon: Router, label: 'Gateway' },
  patch_panel: { icon: PanelTop, label: 'Patch panel' },
}

/** Port-level detail appears when zoomed in (or when the node / one of its ports is selected). */
const useDetailZoom = () => useStore((s) => s.transform[2] >= 1.4)

const portColor = (st: ElemStatus) => (st === 'unknown' ? undefined : STATUS_META[st].color)

/** Short state text, shown only when it explains an active diagnostic result. */
function stateText(d: DeviceNodeData, hasConfig: boolean): string | null {
  if (d.portWorst === 'down') return 'Port down'
  if (d.portWorst === 'degraded') return hasConfig ? 'Config ≠ intent' : 'Degraded'
  if (d.unreachable) return 'Unreachable'
  return null
}

function StateDot({ status, label }: { status: ElemStatus; label: string }) {
  const m = STATUS_META[status]
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={clsx('grid size-[18px] shrink-0 place-items-center rounded-full font-mono text-[9.5px] font-bold leading-none', status === 'unknown' ? 'border border-dashed border-[#b4afbb] text-faint' : 'text-white')}
      style={status === 'unknown' ? undefined : { background: m.color }}
    >
      {status === 'unknown' ? '?' : m.symbol}
    </span>
  )
}

/** Compact port anchor on the node border (overview scale). */
function PortAnchor({ p, index, count, selected, onSelect }: { p: PortVM; index: number; count: number; selected: boolean; onSelect: () => void }) {
  const st = p.obs?.status ?? 'unknown'
  const frac = `${((index + 1) / (count + 1)) * 100}%`
  const horiz = p.side === 'left' || p.side === 'right'
  const pos: CSSProperties = horiz ? { top: frac, left: p.side === 'left' ? 0 : '100%' } : { left: frac, top: p.side === 'top' ? 0 : '100%' }
  const color = portColor(st)
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
        }}
        className={clsx('nodrag absolute z-10 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-transform hover:scale-125', selected && 'ring-2 ring-accent/40')}
        style={{ ...pos, borderColor: selected ? '#6941C6' : color ?? '#a39eab', background: color ? `${color}26` : '#fff' }}
        aria-label={`Port ${p.iface.name}: ${p.obs ? STATUS_META[st].label : 'not observed'}`}
        title={`${p.iface.id}${p.obs ? ` — ${p.obs.label}` : ' — not observed'}`}
      />
      <Handle id={handleId(p.iface.id)} type="source" position={POS[p.side]} style={horiz ? { top: frac } : { left: frac }} />
    </>
  )
}

function PortRow({ p, selected, onSelect }: { p: PortVM; selected: boolean; onSelect: () => void }) {
  const st = p.obs?.status ?? 'unknown'
  const horiz = p.side === 'left' || p.side === 'right'
  const color = portColor(st)
  const mismatch = p.config && p.config.status !== 'up' && !p.config.stale
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      title={`${p.iface.id}${p.obs ? ` — ${p.obs.label}` : ' — not observed'}`}
      aria-label={`Port ${p.iface.name}: ${p.obs ? STATUS_META[st].label : 'not observed'}`}
      className={clsx('nodrag relative flex w-full items-center gap-2 rounded px-1.5 py-1 text-left', selected ? 'bg-accent-soft' : 'hover:bg-canvas', !horiz && 'justify-center')}
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full border" style={{ background: color ?? '#fff', borderColor: color ?? '#a39eab' }} />
      <span className="font-mono text-[11.5px] text-ink">{p.primary}</span>
      {mismatch ? (
        <span className="ml-auto rounded bg-warn-soft px-1 font-mono text-[10px] font-medium text-warn">≠ {p.config!.label.replace(' ≠ intended ', '≠')}</span>
      ) : (
        p.secondary && <span className="ml-auto truncate font-mono text-[10.5px] text-faint">{p.secondary}</span>
      )}
      <Handle id={handleId(p.iface.id)} type="source" position={POS[p.side]} style={horiz ? { top: '50%' } : undefined} />
    </button>
  )
}

export const DeviceNode = memo(function DeviceNode({ data, selected, positionAbsoluteX }: NodeProps<Node<DeviceNodeData>>) {
  const { device, ports, worst, selectedPort, onSelectPort, dimmed, incident } = data
  const zoomDetail = useDetailZoom()
  const detail = zoomDetail || selected || ports.some((p) => p.iface.id === selectedPort)
  const role = ROLE[device.role]
  const Icon = role.icon
  const hasConfig = ports.some((p) => p.config && p.config.status !== 'up' && !p.config.stale)
  const st = stateText(data, hasConfig)
  const meta = STATUS_META[worst]
  const sideOf = (s: Side) => ports.filter((p) => p.side === s)
  const stateLabel = `${device.name}: ${worst === 'unknown' ? 'not observed' : (st ?? meta.label)}`
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: dimmed ? 0.3 : 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: Math.min(0.5, (positionAbsoluteX ?? 0) / 2600) }}
      whileHover={{ y: -2 }}
      className={clsx('relative w-[208px] rounded-lg border bg-white', selected ? 'border-accent ring-2 ring-accent/20' : 'border-[#d9d4df]', incident && worst === 'down' && 'animate-pulse-ring')}
      style={{ boxShadow: '0 1px 2px rgb(36 35 41 / 0.05), 0 6px 18px -8px rgb(36 35 41 / 0.12)' }}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-canvas text-ink">
          <Icon className="size-[17px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold leading-tight text-ink">{device.name}</span>
          <span className={clsx('block truncate text-[11.5px] leading-tight', st ? 'font-medium' : 'text-muted')} style={st ? { color: meta.color } : undefined}>
            {st ?? role.label}
          </span>
        </span>
        <StateDot status={worst} label={stateLabel} />
      </div>
      {detail ? (
        <>
          {SIDES.map((s) =>
            sideOf(s).length ? (
              <div key={s} className={clsx('border-t border-line-2 px-1.5 py-1', s === 'top' || s === 'bottom' ? 'flex gap-1' : 'space-y-0.5')}>
                {sideOf(s).map((p) => (
                  <PortRow key={p.iface.id} p={p} selected={selectedPort === p.iface.id} onSelect={() => onSelectPort(p.iface.id)} />
                ))}
              </div>
            ) : null,
          )}
          <div className="border-t border-line-2 px-3 py-1 font-mono text-[10px] text-faint">
            {device.id} · {device.rack} {device.rack_unit}
          </div>
        </>
      ) : (
        SIDES.flatMap((s) => sideOf(s).map((p, i, arr) => <PortAnchor key={p.iface.id} p={p} index={i} count={arr.length} selected={selectedPort === p.iface.id} onSelect={() => onSelectPort(p.iface.id)} />))
      )}
    </motion.div>
  )
})

export interface PanelNodeData extends Record<string, unknown> {
  device: Device
  rows: { front: PortVM; rear: PortVM }[]
  frontSide: Side
  selectedPort: string | null
  onSelectPort: (iface: string) => void
  dimmed: boolean
}

function PanelPort({ p, selected, onSelect, align, showName }: { p: PortVM; selected: boolean; onSelect: () => void; align: 'left' | 'right'; showName: boolean }) {
  const inspected = p.matedObs
  const cabled = !!p.iface.cable_id
  const c = inspected ? STATUS_META[inspected.status].color : undefined
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      aria-label={`Panel port ${p.iface.name}${cabled ? `, cable ${p.iface.cable_id}` : ', unpatched'}${inspected ? `, inspection ${inspected.label}` : ''}`}
      title={`${p.iface.id}${cabled ? ` · ${p.iface.cable_id}` : ' · unpatched'}${inspected ? ` · ${inspected.label}` : ''}`}
      className={clsx('nodrag relative flex h-5 items-center gap-1.5 rounded px-1', align === 'right' && 'flex-row-reverse', selected ? 'bg-accent-soft' : 'hover:bg-canvas')}
    >
      <span aria-hidden className={clsx('size-2.5 rounded-[3px] border-[1.5px]', cabled ? 'border-[#7d7885] bg-white' : 'border-dashed border-[#c4bfca]')} style={c ? { borderColor: c, background: `${c}30` } : undefined} />
      {showName && <span className={clsx('font-mono text-[10.5px]', cabled ? 'text-ink' : 'text-faint')}>{p.iface.name}</span>}
      {inspected && <span className="font-mono text-[9px] font-bold" style={{ color: c }}>{inspected.status === 'up' ? 'PASS' : 'FAIL'}</span>}
      <Handle id={handleId(p.iface.id)} type="source" position={align === 'left' ? Position.Left : Position.Right} style={{ top: '50%' }} />
    </button>
  )
}

export const PanelNode = memo(function PanelNode({ data, selected, positionAbsoluteX }: NodeProps<Node<PanelNodeData>>) {
  const { device, rows, frontSide, selectedPort, onSelectPort, dimmed } = data
  const zoomDetail = useDetailZoom()
  const detail = zoomDetail || selected || rows.some((r) => r.front.iface.id === selectedPort || r.rear.iface.id === selectedPort)
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: dimmed ? 0.3 : 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: Math.min(0.5, (positionAbsoluteX ?? 0) / 2600) }}
      className={clsx('rounded-lg border border-dashed bg-[#fcfbf9]', detail ? 'w-[176px]' : 'w-[132px]', selected ? 'border-accent ring-2 ring-accent/20' : 'border-[#bdb7c4]')}
    >
      <div className="flex items-center gap-2 px-2.5 pb-1 pt-2">
        <PanelTop className="size-[15px] shrink-0 text-muted" aria-hidden />
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold leading-tight text-ink">{device.id.toUpperCase()}</span>
          <span className="block text-[11px] leading-tight text-muted">Passive panel</span>
        </span>
      </div>
      {detail && (
        <div className="flex justify-between px-2.5 font-mono text-[9.5px] uppercase tracking-wider text-faint">
          <span>{frontSide === 'left' ? 'Front' : 'Rear'}</span>
          <span>{frontSide === 'left' ? 'Rear' : 'Front'}</span>
        </div>
      )}
      <div className="space-y-0.5 px-1 pb-1.5 pt-0.5">
        {rows.map(({ front, rear }) => {
          const left = frontSide === 'left' ? front : rear
          const right = frontSide === 'left' ? rear : front
          const both = !!left.iface.cable_id && !!right.iface.cable_id
          return (
            <div key={front.iface.id} className="grid grid-cols-[auto_1fr_auto] items-center">
              <PanelPort p={left} align="left" showName={detail} selected={selectedPort === left.iface.id} onSelect={() => onSelectPort(left.iface.id)} />
              <span aria-hidden className={clsx('mx-1 h-px', both ? 'bg-[#a39eab]' : 'border-t border-dashed border-[#d6d1db]')} />
              <PanelPort p={right} align="right" showName={detail} selected={selectedPort === right.iface.id} onSelect={() => onSelectPort(right.iface.id)} />
            </div>
          )
        })}
      </div>
      {detail && <div className="border-t border-dashed border-line px-2.5 py-1 font-mono text-[10px] text-faint">{device.rack} {device.rack_unit} · modeled, not an IP device</div>}
    </motion.div>
  )
})

export const nodeTypes = { device: DeviceNode, panel: PanelNode }
