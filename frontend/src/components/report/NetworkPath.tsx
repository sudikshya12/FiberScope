import clsx from 'clsx'
import { AlertTriangle, Cable, CheckCircle2, CircleDot, Repeat2 } from 'lucide-react'
import type { PathHop, TracedPath } from '../../lib/types'
import { Field, FieldGrid, Placeholder } from './primitives'

const HOP: Record<PathHop['kind'], { label: string; icon: typeof Cable; cls: string }> = {
  interface: { label: 'Port', icon: CircleDot, cls: 'text-ink' },
  cable: { label: 'Cable', icon: Cable, cls: 'text-muted' },
  patch_mapping: { label: 'Patch', icon: Repeat2, cls: 'text-muted' },
  gap: { label: 'Gap', icon: AlertTriangle, cls: 'text-crit' },
}

export function NetworkPath({ path, source }: { path: TracedPath | null; source: string }) {
  if (!path) {
    return (
      <Placeholder>
        {source ? `${source[0].toUpperCase()}${source.slice(1).replace(/\.$/, '')}` : 'No cable trace was collected'}, so no documented physical path is included.
      </Placeholder>
    )
  }
  return (
    <>
      <FieldGrid className="sm:grid-cols-4">
        <Field label="From" mono>
          {path.start}
        </Field>
        <Field label="To" mono>
          {path.end ?? 'unterminated'}
        </Field>
        <Field label="Cables">{path.cables.length}</Field>
        <Field label="Mated points">{path.mated_points.length}</Field>
      </FieldGrid>
      <div className={clsx('flex items-center gap-2 text-[13px]', path.complete ? 'text-ok' : 'text-crit')}>
        {path.complete ? <CheckCircle2 className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
        {path.complete ? 'Documented path is complete end to end.' : `Documented path has a gap: ${path.gap_reason ?? 'unknown reason'}`}
      </div>
      <ol className="rpt-avoid relative border-y border-line-2 py-3" aria-label="Documented path hops">
        {path.hops.map((h, i) => {
          const meta = HOP[h.kind] ?? HOP.interface
          const Icon = meta.icon
          const last = i === path.hops.length - 1
          return (
            <li key={`${h.id}-${i}`} className="relative flex gap-3 pb-2.5 last:pb-0">
              {!last && <span aria-hidden className="absolute left-[9px] top-5 h-[calc(100%-14px)] w-px bg-line" />}
              <span className={clsx('relative z-10 mt-0.5 grid size-[19px] shrink-0 place-items-center rounded-full border border-line bg-white', meta.cls)}>
                <Icon className="size-3" aria-hidden />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-x-3 sm:flex-row sm:items-baseline">
                <span className="w-12 shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{meta.label}</span>
                <span className={clsx('min-w-0 break-words font-mono text-[12.5px]', h.kind === 'interface' ? 'font-semibold text-ink' : meta.cls)}>{h.label}</span>
                {h.detail && <span className="min-w-0 text-[12.5px] text-muted sm:ml-auto sm:text-right">{h.detail}</span>}
              </div>
            </li>
          )
        })}
      </ol>
      <p className="text-[12.5px] text-muted">
        Source: {source}. Patch panels and trunk segments are documentation models; this is the documented path, not a physical test result.
      </p>
    </>
  )
}
