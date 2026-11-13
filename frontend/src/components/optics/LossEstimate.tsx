import { useId, useState } from 'react'
import clsx from 'clsx'
import { motion, useReducedMotion } from 'motion/react'
import { AlertTriangle, ArrowRight, Ban, Check, ChevronRight, OctagonAlert } from 'lucide-react'
import type { Budget, OpticInfo } from '../../lib/types'
import { fmtSim, fmtTime } from '../../lib/format'
import { Mono } from '../ui'
import { AnimatedNumber } from './AnimatedNumber'
import { estimateDirection, fmtVal, type DirectionEstimate, type PairedReading } from './model'

export function EstimateTag() {
  return <span className="inline-flex items-center rounded border border-line bg-white px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">Estimate — not OTDR</span>
}

export function LossEstimate({ pair, opticA, opticB, budget }: { pair: PairedReading | null; opticA: OpticInfo | null; opticB: OpticInfo | null; budget: Budget | null }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  if (!pair) {
    return (
      <div className="flex items-start gap-2.5 text-[13px] text-muted">
        <Ban className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />
        <p>
          <span className="font-medium text-ink">Not computable.</span> No evidence item recorded Tx and Rx at both ends in one collection. Run the optical telemetry diagnostic, which reads both ends together.
        </p>
      </div>
    )
  }
  const ab = estimateDirection(pair.a, pair.b, opticA, opticB, 'A', 'B')
  const ba = estimateDirection(pair.b, pair.a, opticB, opticA, 'B', 'A')
  const b = budget?.estimated_budget_db ?? null
  const scaleMax = Math.max(b ?? 0, ab.loss ?? 0, ba.loss ?? 0, 1) * 1.15

  return (
    <div>
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <Direction est={ab} budget={b} scaleMax={scaleMax} />
        <Direction est={ba} budget={b} scaleMax={scaleMax} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
        <span>
          Paired from <Mono className="text-ink">{pair.evidenceId}</Mono> · {fmtTime(pair.a.observed_at, true)}
          {pair.a.sim_time_ms != null && <> · sim {fmtSim(pair.a.sim_time_ms)}</>}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-more`}
          onClick={() => setOpen((o) => !o)}
          className="group ml-auto inline-flex items-center gap-1 rounded font-medium text-ink hover:text-accent-strong"
        >
          <ChevronRight className={clsx('size-3.5 text-faint transition-transform', open && 'rotate-90')} aria-hidden />
          Budget & assumptions
        </button>
      </div>

      <div id={`${id}-more`} hidden={!open} className="mt-3 grid gap-5 border-t border-line-2 pt-3 md:grid-cols-2">
        {open && (
          <>
            <div>
              <h4 className="eyebrow mb-1.5">Documented planning budget</h4>
              {budget ? (
                <dl className="space-y-0.5 text-[12.5px]">
                  <Row k="Estimated budget" v={`${fmtVal(budget.estimated_budget_db)} dB`} strong />
                  <Row k="Fiber length" v={`${budget.fiber_length_m} m · ${budget.attenuation_db_per_km} dB/km`} />
                  <Row k="Mated pairs" v={`${budget.mated_pairs} × ${budget.assumed_loss_per_mated_pair_db} dB (assumed)`} />
                  <Row k="Fiber type" v={budget.fiber_types.join(', ') || '—'} />
                  <p className="pt-1 text-[11.5px] leading-relaxed text-muted">{budget.basis}</p>
                </dl>
              ) : (
                <p className="text-[12.5px] text-muted">No documented planning budget for this link.</p>
              )}
            </div>
            <div>
              <h4 className="eyebrow mb-1.5">Assumptions</h4>
              <ul className="list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed text-muted marker:text-faint">
                <li>Tx and Rx come from the same evidence item, never from different times.</li>
                <li>
                  Both modules use the same wavelength ({opticA?.wavelength_nm ?? '?'} nm / {opticB?.wavelength_nm ?? '?'} nm).
                </li>
                <li>DOM accuracy is typically ± a few dB; differences under ~2 dB are within sensor uncertainty.</li>
                <li>Readings flagged loss of signal or laser disabled are excluded.</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className={clsx('mono text-right text-[12px]', strong ? 'font-semibold text-ink' : 'text-ink/80')}>{v}</dd>
    </div>
  )
}

function Direction({ est, budget, scaleMax }: { est: DirectionEstimate; budget: number | null; scaleMax: number }) {
  const reduced = useReducedMotion()
  const delta = est.loss != null && budget != null ? est.loss - budget : null
  const tone = delta == null ? 'neutral' : delta > 3 ? 'crit' : delta > 1.5 ? 'warn' : 'ok'
  return (
    <div className="min-w-0">
      <div className="mb-1 flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-ink">
        <span className="grid size-5 shrink-0 place-items-center rounded bg-nav font-mono text-[10.5px] text-white">{est.fromLabel}</span>
        <ArrowRight className="size-3.5 shrink-0 text-faint" aria-hidden />
        <span className="grid size-5 shrink-0 place-items-center rounded bg-nav font-mono text-[10.5px] text-white">{est.toLabel}</span>
        <span className="sr-only">
          Direction {est.fromLabel} to {est.toLabel}
        </span>
        <span className="mono ml-1 min-w-0 truncate text-[11px] font-normal text-muted" title={`${est.from} → ${est.to}`}>
          {est.from} → {est.to}
        </span>
      </div>

      {est.loss == null ? (
        <p className="mt-2 flex items-start gap-2 text-[12.5px] text-muted">
          <Ban className="mt-0.5 size-3.5 shrink-0 text-unknown" aria-hidden />
          <span>
            <span className="font-medium text-ink">Not computable.</span> {est.reason}
          </span>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <AnimatedNumber value={est.loss} className="mono text-[24px] font-semibold leading-8 tracking-tight text-ink" />
            <span className="mono text-[12.5px] text-muted">dB</span>
            <span className="mono text-[11.5px] text-faint">
              = Tx({est.fromLabel}) {fmtVal(est.tx)} − Rx({est.toLabel}) {fmtVal(est.rx)}
            </span>
          </div>
          <div className="relative mt-2 h-1.5 rounded-[3px] bg-line-2" aria-hidden>
            <motion.div
              className={clsx('absolute inset-y-0 left-0 rounded-[3px]', tone === 'crit' ? 'bg-crit' : tone === 'warn' ? 'bg-warn' : 'bg-[#a9a5b0]')}
              initial={reduced ? false : { width: 0 }}
              animate={{ width: `${(Math.max(est.loss, 0) / scaleMax) * 100}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 22 }}
            />
            {budget != null && <div className="absolute -inset-y-1 w-0.5 rounded bg-ink" style={{ left: `${(budget / scaleMax) * 100}%` }} title={`Planning budget ${fmtVal(budget)} dB`} />}
          </div>
          <div className="mt-1.5 text-[12px] text-muted">
            {delta == null ? (
              'No planning budget to compare.'
            ) : (
              <>
                <span className={clsx('inline-flex items-center gap-1 font-semibold', tone === 'crit' ? 'text-crit' : tone === 'warn' ? 'text-warn' : 'text-ok')}>
                  {tone === 'crit' ? <OctagonAlert className="size-3" aria-hidden /> : tone === 'warn' ? <AlertTriangle className="size-3" aria-hidden /> : <Check className="size-3" aria-hidden />}
                  {delta >= 0 ? '+' : '−'}
                  {Math.abs(delta).toFixed(2)} dB
                </span>{' '}
                vs. budget {fmtVal(budget)} dB (tick){tone === 'ok' ? ' — within sensor uncertainty' : ' — excess loss toward this receiver'}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
