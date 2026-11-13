import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react'
import { motion } from 'motion/react'
import clsx from 'clsx'
import type { ElemStatus } from '../../lib/observations'
import { STATUS_META } from '../../lib/observations'

export interface LinkEdgeData extends Record<string, unknown> {
  status: ElemStatus
  stale: boolean
  title: string
  detail?: string
  variant: 'patch' | 'trunk' | 'direct' | 'logical' | 'spare'
  trace: boolean
  traceIndex: number
  dimmed: boolean
  selected: boolean
  hovered: boolean
  warn?: string
  hideLabel?: boolean
  onSelect: () => void
}

/* Semantics: neutral graphite for documented links; dashed when not observed; amber/red strokes only
   for observed problems; violet only for the selected or traced path. No ambient motion. */
const STROKE: Record<ElemStatus, string> = { up: '#7d7885', degraded: '#986300', down: '#BE3545', unknown: '#a9a4b0' }

export const LinkEdge = memo(function LinkEdge(props: EdgeProps<Edge<LinkEdgeData>>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props
  const d = data!
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14, offset: 20 })
  const highlight = d.selected || d.trace
  const width = d.variant === 'trunk' ? 3 : 2
  const dash = d.variant === 'spare' ? '2 5' : d.status === 'unknown' ? '5 5' : d.status === 'down' ? '6 4' : undefined
  const meta = STATUS_META[d.status]
  const showLabel = !d.hideLabel && (d.hovered || d.selected)
  const observed = d.status !== 'unknown' && d.variant !== 'spare'
  return (
    <g className={clsx('transition-opacity duration-300', d.dimmed && 'opacity-20')}>
      <path d={path} fill="none" stroke="transparent" strokeWidth={16} className="cursor-pointer" onClick={d.onSelect} />
      <BaseEdge id={id} path={path} style={{ stroke: d.variant === 'spare' ? '#d4cfd9' : STROKE[d.status], strokeWidth: width, strokeDasharray: dash, opacity: d.stale ? 0.55 : 1 }} />
      {highlight && (
        <motion.path
          key={`hl-${d.trace ? d.traceIndex : 's'}`}
          d={path}
          fill="none"
          stroke="#6941C6"
          strokeWidth={width + 1}
          strokeLinecap="round"
          initial={{ pathLength: d.trace ? 0 : 1 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.45, delay: d.trace ? d.traceIndex * 0.15 : 0, ease: [0.22, 1, 0.36, 1] }}
          style={{ pointerEvents: 'none' }}
        />
      )}
      <EdgeLabelRenderer>
        {observed && !showLabel && !highlight && (
          <span
            aria-hidden
            className="nodrag nopan pointer-events-none absolute grid size-[15px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white font-mono text-[8px] font-bold text-white shadow-sm"
            style={{ left: lx, top: ly, background: meta.color, opacity: d.dimmed ? 0.3 : 1 }}
          >
            {meta.symbol}
          </span>
        )}
        {!d.hideLabel && (
          <button
            type="button"
            onClick={d.onSelect}
            className={clsx(
              'nodrag nopan absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-md border bg-white px-1.5 py-[3px] shadow-sm transition-opacity duration-150 focus-visible:opacity-100',
              highlight ? 'border-accent' : 'border-line',
              showLabel ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
            style={{ left: lx, top: ly, pointerEvents: showLabel ? 'all' : undefined }}
            aria-label={`${d.title}: ${d.status === 'unknown' ? 'not observed' : meta.label}${d.detail ? `, ${d.detail}` : ''}`}
          >
            <span className="font-mono text-[10px] font-bold" style={{ color: d.status === 'unknown' ? '#8a8692' : meta.color }} aria-hidden>
              {d.status === 'unknown' ? '?' : meta.symbol}
            </span>
            <span className="font-mono text-[11px] font-medium text-ink">{d.title}</span>
            {d.detail && <span className="font-mono text-[10px] text-muted">{d.detail}</span>}
            {d.warn && <span className="rounded bg-warn-soft px-1 text-[9.5px] font-semibold text-warn">{d.warn}</span>}
          </button>
        )}
      </EdgeLabelRenderer>
    </g>
  )
})

export const edgeTypes = { link: LinkEdge }
