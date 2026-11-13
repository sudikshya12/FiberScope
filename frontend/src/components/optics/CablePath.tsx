import clsx from 'clsx'
import { ArrowLeftRight, CircleSlash, Cpu, PanelTop } from 'lucide-react'
import type { TracedPath } from '../../lib/types'

/** Documented cable path rendered as a wrapped horizontal chain of hops. */
export function CablePath({ path }: { path: TracedPath }) {
  const last = path.hops.length - 1
  return (
    <div>
      <ol className="flex flex-col items-start sm:flex-row sm:flex-wrap sm:items-center sm:gap-y-3" aria-label="Documented cable path, in order">
        {path.hops.map((h, i) => {
          const isEnd = h.kind === 'interface' && (i === 0 || i === last)
          return (
            <li key={`${h.id}-${i}`} className="flex min-w-0 max-w-full flex-col items-start sm:flex-row sm:items-center">
              {i > 0 && <Connector kind={path.hops[i - 1].kind === 'cable' || h.kind === 'cable' ? 'fiber' : 'internal'} />}
              <Hop kind={h.kind} label={h.label} detail={h.detail} id={h.id} end={isEnd} />
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-[12px] text-muted">
        {path.mated_points.length} mated connection point{path.mated_points.length === 1 ? '' : 's'} on this path
        {path.mated_points.length > 0 && (
          <>
            {' '}
            (<span className="mono text-[11.5px]">{path.mated_points.join(', ')}</span>)
          </>
        )}
        . {path.complete ? 'Path is complete in the registry.' : `Path is incomplete: ${path.gap_reason ?? 'unknown gap'}.`}
      </p>
    </div>
  )
}

function Connector({ kind }: { kind: 'fiber' | 'internal' }) {
  return (
    <span aria-hidden className="ml-4 flex items-center sm:mx-1 sm:ml-1">
      <span
        className={clsx(
          'block h-3 w-0 sm:h-0 sm:w-5',
          kind === 'fiber' ? 'border-l-2 border-[#a9a5b0] sm:border-l-0 sm:border-t-2' : 'border-l border-dashed border-faint sm:border-l-0 sm:border-t',
        )}
      />
    </span>
  )
}

function Hop({ kind, label, detail, id, end }: { kind: string; label: string; detail: string; id: string; end: boolean }) {
  if (kind === 'cable') {
    return (
      <span className="flex min-w-0 flex-col rounded-md border border-line bg-white px-2 py-1" title={`${id}${detail ? ` — ${detail}` : ''}`}>
        <span className="mono truncate text-[11.5px] font-semibold text-ink">{label}</span>
        {detail && <span className="truncate text-[10.5px] text-muted">{detail.replace(/^fiber · /, '')}</span>}
      </span>
    )
  }
  if (kind === 'patch_mapping') {
    return (
      <span className="flex items-center gap-1.5 rounded-md border border-dashed border-[#cfcad6] bg-stage px-2 py-1" title={detail || id}>
        <PanelTop className="size-3.5 text-muted" aria-hidden />
        <span className="mono text-[11.5px] font-medium text-ink">{label.replace('⇄', ' ⇄ ')}</span>
        <span className="rounded bg-white px-1 text-[9.5px] font-semibold uppercase tracking-wider text-faint ring-1 ring-line">modeled</span>
        <span className="sr-only">passive patch panel crossing, modeled</span>
      </span>
    )
  }
  if (kind === 'gap') {
    return (
      <span className="flex items-center gap-1.5 rounded-md border border-crit/25 bg-crit-soft px-2 py-1 text-crit" title={detail}>
        <CircleSlash className="size-3.5" aria-hidden />
        <span className="text-[11.5px] font-semibold">Gap</span>
        <span className="text-[11px]">{detail}</span>
      </span>
    )
  }
  return (
    <span className={clsx('flex items-center gap-1.5 rounded-md border px-2 py-1', end ? 'border-nav bg-nav text-white' : 'border-line bg-white text-ink')} title={id}>
      {end ? <Cpu className="size-3.5 text-nav-text" aria-hidden /> : <ArrowLeftRight className="size-3 text-faint" aria-hidden />}
      <span className="mono truncate text-[11.5px] font-medium">{label}</span>
    </span>
  )
}
