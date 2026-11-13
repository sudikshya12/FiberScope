import { Fragment } from 'react'
import { Link } from 'react-router'
import { motion } from 'motion/react'
import clsx from 'clsx'
import { ArrowLeftRight, CheckCircle2, Link2Off } from 'lucide-react'
import type { PathHop, TracedPath } from '../../lib/types'
import { segmentsOf, type Segment } from './model'
import { ifaceShort } from '../../lib/format'

const portName = (hop: PathHop) => ifaceShort(hop.id.split(':').slice(1).join(':') || hop.label)

const STEP = 0.13
const ease = [0.22, 1, 0.36, 1] as const

/* ------------------------------------------------------------------ pieces */

function Dot({ i, tone = 'muted', base }: { i: number; tone?: 'accent' | 'crit' | 'muted'; base: number }) {
  const lit = tone === 'accent' ? 'var(--color-accent)' : tone === 'crit' ? 'var(--color-crit)' : 'var(--color-faint)'
  return (
    <motion.span
      aria-hidden
      className="relative inline-block size-2.5 shrink-0 rounded-full border-2 bg-white"
      initial={{ borderColor: 'var(--color-line)', scale: 0.6 }}
      animate={{ borderColor: lit, scale: 1, backgroundColor: tone === 'accent' ? 'var(--color-accent-soft)' : 'var(--color-panel)' }}
      transition={{ delay: base + i * STEP + 0.08, duration: 0.3, ease }}
    />
  )
}

function DeviceLink({ id, children, className }: { id: string | null; children: React.ReactNode; className?: string }) {
  if (!id) return <span className={className}>{children}</span>
  return (
    <Link to={`/devices/${id}`} className={clsx('hover:text-accent-strong hover:underline decoration-accent/40 underline-offset-2', className)}>
      {children}
    </Link>
  )
}

function CableLabel({ hop, highlight, linkCables }: { hop: PathHop; highlight?: boolean; linkCables: boolean }) {
  const cls = clsx('font-mono text-[12px] font-semibold tracking-tight', highlight ? 'text-accent-strong' : 'text-ink')
  return linkCables ? (
    <Link to={`/cables?id=${encodeURIComponent(hop.id)}`} className={clsx(cls, 'hover:underline underline-offset-2')}>
      {hop.label}
    </Link>
  ) : (
    <span className={cls}>{hop.label}</span>
  )
}

/* ------------------------------------------------------------------ horizontal */

function HNode({ seg, i, base, highlight, linkCables }: { seg: Segment; i: number; base: number; highlight?: string; linkCables: boolean }) {
  const reveal = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { delay: base + i * STEP, duration: 0.35, ease } }
  if (seg.type === 'port') {
    return (
      <motion.li {...reveal} className="flex shrink-0 flex-col items-center gap-1.5 px-1">
        <Dot i={i} base={base} />
        <div className={clsx('rounded-md border px-2.5 py-1.5 text-center', seg.endpoint ? 'border-line bg-panel' : 'border-line-2 bg-stage')}>
          <DeviceLink id={seg.hop.device_id} className="block text-[11px] font-medium text-muted">
            {seg.hop.device_id}
          </DeviceLink>
          <div className="font-mono text-[12.5px] font-semibold text-ink">{portName(seg.hop)}</div>
        </div>
      </motion.li>
    )
  }
  if (seg.type === 'panel') {
    return (
      <motion.li {...reveal} className="flex shrink-0 flex-col items-center gap-1.5 px-1">
        <Dot i={i} base={base} />
        <div className="rounded-md border border-dashed border-[#cfcad6] bg-stage px-2.5 py-1.5 text-center">
          <DeviceLink id={seg.device} className="block font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">
            {seg.device}
          </DeviceLink>
          <div className="flex items-center justify-center gap-1 font-mono text-[12.5px] font-semibold text-ink">
            {portName(seg.front)}
            <ArrowLeftRight className="size-3 text-faint" aria-label="maps to" />
            {portName(seg.rear)}
          </div>
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-faint">passive · modeled</div>
        </div>
      </motion.li>
    )
  }
  if (seg.type === 'cable') {
    const hl = highlight === seg.hop.id
    return (
      <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: base + i * STEP, duration: 0.25 }} className="flex min-w-[124px] flex-1 flex-col items-stretch px-1 pt-[3px]">
        <div className="relative h-[3px] overflow-hidden rounded-full bg-line-2">
          <motion.div className={clsx('absolute inset-0 origin-left rounded-full', hl ? 'bg-accent' : 'bg-[#bdb8c4]')} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: base + i * STEP, duration: STEP * 2.2, ease }} />
        </div>
        <div className={clsx('mt-2 rounded-md px-1.5 py-1 text-center', hl && 'bg-accent-soft')}>
          <CableLabel hop={seg.hop} highlight={hl} linkCables={linkCables} />
          <div className="mt-0.5 text-[11px] leading-snug text-muted">{seg.hop.detail}</div>
        </div>
      </motion.li>
    )
  }
  return (
    <motion.li {...reveal} className="flex min-w-[150px] shrink-0 flex-col items-center gap-1.5 px-1">
      <Dot i={i} base={base} tone="crit" />
      <div className="rounded-md border border-crit/25 bg-crit-soft px-2.5 py-1.5 text-center">
        <div className="flex items-center justify-center gap-1 text-[12px] font-semibold text-crit">
          <Link2Off className="size-3.5" aria-hidden /> No record
        </div>
        <div className="text-[11px] text-crit/80">{seg.hop.label}</div>
        <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-crit/70">path not inferred</div>
      </div>
    </motion.li>
  )
}

/* ------------------------------------------------------------------ vertical */

function VRow({ seg, i, base, last, highlight, linkCables }: { seg: Segment; i: number; base: number; last: boolean; highlight?: string; linkCables: boolean }) {
  const reveal = { initial: { opacity: 0, x: -6 }, animate: { opacity: 1, x: 0 }, transition: { delay: base + i * STEP, duration: 0.35, ease } }
  const isCable = seg.type === 'cable'
  return (
    <li className="relative grid grid-cols-[20px_minmax(0,1fr)] gap-x-3">
      {/* rail */}
      <div className="relative flex justify-center">
        {!isCable && (
          <div className="relative z-10 pt-[13px]">
            <Dot i={i} base={base} tone={seg.type === 'gap' ? 'crit' : 'muted'} />
          </div>
        )}
        {!(i === 0 && last) && (
          <div className="absolute w-[3px] overflow-hidden bg-line-2" style={{ top: i === 0 ? 18 : 0, bottom: last ? 'calc(100% - 18px)' : 0 }} aria-hidden>
            <motion.div
              className={clsx('absolute inset-0 origin-top', isCable && highlight === seg.hop.id ? 'bg-accent' : 'bg-[#bdb8c4]')}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: base + i * STEP + 0.05, duration: STEP * 1.6, ease }}
            />
          </div>
        )}
      </div>
      <motion.div {...reveal} className={clsx('min-w-0', isCable ? 'py-1.5' : 'py-1')}>
        {seg.type === 'port' && (
          <div className={clsx('flex items-baseline justify-between gap-3 rounded-md border px-3 py-2', seg.endpoint ? 'border-line bg-panel' : 'border-line-2 bg-stage')}>
            <div className="min-w-0">
              <DeviceLink id={seg.hop.device_id} className="text-[12px] font-medium text-muted">
                {seg.hop.device_id}
              </DeviceLink>
              <div className="font-mono text-[13px] font-semibold text-ink">{portName(seg.hop)}</div>
            </div>
            {seg.endpoint && <span className="eyebrow text-[10px] text-faint">{i === 0 ? 'Start' : 'End'}</span>}
          </div>
        )}
        {seg.type === 'panel' && (
          <div className="rounded-md border border-dashed border-[#cfcad6] bg-stage px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <DeviceLink id={seg.device} className="font-mono text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                {seg.device}
              </DeviceLink>
              <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">passive · modeled</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[13px] font-semibold text-ink">
              {portName(seg.front)}
              <ArrowLeftRight className="size-3.5 text-faint" aria-label="maps to" />
              {portName(seg.rear)}
            </div>
            <div className="text-[11.5px] text-muted">Front↔rear mapping — two mated connections</div>
          </div>
        )}
        {seg.type === 'cable' && (
          <div className={clsx('rounded-md px-2 py-1', highlight === seg.hop.id && 'bg-accent-soft')}>
            <CableLabel hop={seg.hop} highlight={highlight === seg.hop.id} linkCables={linkCables} />
            {highlight === seg.hop.id && <span className="ml-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-accent-strong">this cable</span>}
            <div className="text-[11.5px] text-muted">{seg.hop.detail}</div>
          </div>
        )}
        {seg.type === 'gap' && (
          <div className="rounded-md border border-crit/25 bg-crit-soft px-3 py-2">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-crit">
              <Link2Off className="size-3.5" aria-hidden /> No record — path not inferred
            </div>
            <div className="text-[12px] text-crit/80">{seg.hop.label}</div>
          </div>
        )}
      </motion.div>
    </li>
  )
}

/* ------------------------------------------------------------------ public */

export function PathSummary({ path }: { path: TracedPath }) {
  const panels = path.hops.filter((h) => h.kind === 'patch_mapping').length
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
      {path.complete ? (
        <span className="inline-flex items-center gap-1 font-medium text-ok">
          <CheckCircle2 className="size-3.5" aria-hidden /> End-to-end path documented
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 font-medium text-crit">
          <Link2Off className="size-3.5" aria-hidden /> Incomplete — {path.gap_reason ?? 'record gap'}
        </span>
      )}
      <span className="tnum">
        {path.cables.length} cable{path.cables.length === 1 ? '' : 's'} · {panels} panel crossing{panels === 1 ? '' : 's'} · {path.mated_points.length} mated point{path.mated_points.length === 1 ? '' : 's'}
      </span>
    </div>
  )
}

/**
 * Documented end-to-end path through cables and passive patch-panel mappings.
 * Hops reveal sequentially (connector dots light up in order). Gaps are shown
 * explicitly — the chain never infers a connection that has no record.
 */
export function PathChain({
  path,
  orientation = 'horizontal',
  highlight,
  delay = 0,
  linkCables = true,
  className,
}: {
  path: TracedPath
  orientation?: 'horizontal' | 'vertical'
  /** cable id to emphasise */
  highlight?: string
  delay?: number
  linkCables?: boolean
  className?: string
}) {
  const segs = segmentsOf(path)
  const label = `Documented path: ${path.text}`
  if (orientation === 'vertical') {
    return (
      <ol aria-label={label} className={clsx('space-y-0', className)}>
        {segs.map((s, i) => (
          <VRow key={`${s.type}-${i}`} seg={s} i={i} base={delay} last={i === segs.length - 1} highlight={highlight} linkCables={linkCables} />
        ))}
      </ol>
    )
  }
  return (
    <div className={clsx('scroll-thin -mx-1 overflow-x-auto pb-2', className)}>
      <ol aria-label={label} className="flex min-w-max items-start">
        {segs.map((s, i) => (
          <Fragment key={`${s.type}-${i}`}>
            <HNode seg={s} i={i} base={delay} highlight={highlight} linkCables={linkCables} />
          </Fragment>
        ))}
      </ol>
    </div>
  )
}

