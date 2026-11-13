import type { CSSProperties } from 'react'
import clsx from 'clsx'
import { motion, useReducedMotion } from 'motion/react'
import { AlertTriangle, Check, CircleHelp, Minus, OctagonAlert } from 'lucide-react'
import type { Thresholds } from '../../lib/types'
import { AnimatedNumber } from './AnimatedNumber'
import { classify, fmtVal, STATUS_META, type MetricStatus } from './model'

const TONE_TEXT = { ok: 'text-ok', warn: 'text-warn', crit: 'text-crit', unknown: 'text-unknown' } as const
const TONE_MARK = { ok: 'bg-ink', warn: 'bg-warn', crit: 'bg-crit', unknown: 'bg-unknown' } as const
const TONE_CHIP = {
  ok: 'text-ok',
  warn: 'bg-warn-soft text-warn',
  crit: 'bg-crit-soft text-crit',
  unknown: 'bg-unknown-soft text-[#55525c]',
} as const

/** Status as text + symbol. Healthy readings stay quiet (no fill); only warnings, alarms and unknowns get a tint. */
export function StatusChip({ status, className, compact }: { status: MetricStatus; className?: string; compact?: boolean }) {
  const m = STATUS_META[status]
  const Icon = m.tone === 'ok' ? Check : m.tone === 'warn' ? AlertTriangle : m.tone === 'crit' ? OctagonAlert : status === 'not_reported' ? Minus : CircleHelp
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-4 tracking-[0.04em]', TONE_CHIP[m.tone], m.tone === 'ok' && 'px-0', className)}>
      <Icon className="size-3 shrink-0" aria-hidden strokeWidth={2.5} />
      {m.symbol && (
        <span aria-hidden className="font-mono text-[9px] tracking-tighter">
          {m.symbol}
        </span>
      )}
      {compact && m.short ? <span title={m.label}>{m.short}</span> : m.label}
    </span>
  )
}

// Track zones: the normal band is a light neutral; only warning / alarm bands carry colour.
const ZONE_ALARM: CSSProperties = { backgroundColor: '#efcdd1' }
const ZONE_WARN: CSSProperties = { backgroundColor: '#f1e0bd' }
const ZONE_OK: CSSProperties = { backgroundColor: '#e8e5ec' }
const ZONE_UNKNOWN: CSSProperties = {
  backgroundColor: '#efedf2',
  backgroundImage: 'repeating-linear-gradient(135deg, rgb(119 115 127 / 0.22) 0 1.5px, transparent 1.5px 6px)',
}

const fmtTick = (v: number) => String(Number(v.toFixed(2))).replace(/^-/, '−')

type Tick = { key: string; p: number; text: string; align: string }

function TickRow({ ticks, lg, tone, pos }: { ticks: Tick[]; lg: boolean; tone: 'warn' | 'crit'; pos: 'above' | 'below' }) {
  return (
    <div className={clsx('relative', lg ? 'h-3.5' : 'h-3')} aria-hidden>
      {ticks.map((t) => (
        <span
          key={t.key}
          className={clsx(
            'absolute whitespace-nowrap font-mono tabular-nums leading-none',
            pos === 'above' ? 'bottom-0.5' : 'top-0.5',
            lg ? 'text-[11px]' : 'text-[10px]',
            tone === 'crit' ? 'text-crit/80' : 'text-warn/90',
            t.align === 'center' && '-translate-x-1/2',
            t.align === 'right' && '-translate-x-full',
          )}
          style={{ left: `${t.p}%` }}
          title={t.key.replace('_', ' ')}
        >
          {t.text}
        </span>
      ))}
    </div>
  )
}

interface Scale {
  min: number
  max: number
  pct: (v: number) => number
}

function buildScale(th: Thresholds, value: number | null): Scale {
  const pts = [th.low_alarm, th.low_warning, th.high_warning, th.high_alarm].filter((x): x is number => x != null)
  let lo = Math.min(...pts)
  let hi = Math.max(...pts)
  if (pts.length === 1 && value != null) {
    lo = Math.min(lo, value)
    hi = Math.max(hi, value)
  }
  const span = Math.max(hi - lo, 1e-6)
  // Pad the outer (alarm) zones so they read as zones, not hairlines.
  const pad = span * 0.14
  const min = lo - pad
  const max = hi + pad
  return { min, max, pct: (v: number) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)) }
}

/**
 * Horizontal threshold plot: low alarm | low warning | normal | high warning | high alarm,
 * using this module's own reported thresholds. Unknown thresholds render a hatched neutral bar — never "healthy".
 */
export function ThresholdBar({
  label,
  unit,
  value,
  thresholds,
  digits = 2,
  size = 'lg',
  note,
  idPrefix,
  los,
}: {
  label: string
  unit: string
  value: number | null | undefined
  thresholds: Thresholds | null | undefined
  digits?: number
  size?: 'lg' | 'sm'
  note?: string
  idPrefix: string
  /** Receiver loss of signal: the value is the sensor floor, not a power level. */
  los?: boolean
}) {
  const reduced = useReducedMotion()
  const v = value ?? null
  const status = classify(v, thresholds)
  const meta = STATUS_META[status]
  const lg = size === 'lg'
  const th = thresholds ?? null
  const scale = th ? buildScale(th, v) : null
  const offScale = scale && v != null ? (v < scale.min ? 'low' : v > scale.max ? 'high' : null) : null

  const zones: { from: number; to: number; style: CSSProperties; name: string }[] = []
  if (th && scale) {
    const la = th.low_alarm ?? th.low_warning ?? scale.min
    const lw = th.low_warning ?? la
    const ha = th.high_alarm ?? th.high_warning ?? scale.max
    const hw = th.high_warning ?? ha
    zones.push(
      { from: scale.min, to: la, style: ZONE_ALARM, name: 'low alarm' },
      { from: la, to: lw, style: ZONE_WARN, name: 'low warning' },
      { from: lw, to: hw, style: ZONE_OK, name: 'normal' },
      { from: hw, to: ha, style: ZONE_WARN, name: 'high warning' },
      { from: ha, to: scale.max, style: ZONE_ALARM, name: 'high alarm' },
    )
  }

  const tickRow = (keys: readonly ('low_alarm' | 'low_warning' | 'high_warning' | 'high_alarm')[]): Tick[] =>
    th && scale
      ? keys
          .filter((k) => th[k] != null)
          .map((k) => {
            const p = scale.pct(th[k] as number)
            return { key: k, p, text: fmtTick(th[k] as number), align: p < 8 ? 'left' : p > 92 ? 'right' : 'center' }
          })
      : []
  const alarmTicks = tickRow(['low_alarm', 'high_alarm'])
  const warnTicks = tickRow(['low_warning', 'high_warning'])

  const summary =
    v == null
      ? `${label}: not reported by the module.`
      : !th
        ? `${label}: ${fmtVal(v, digits)} ${unit}. Thresholds not reported by module — status unknown.`
        : `${label}: ${fmtVal(v, digits)} ${unit}, status ${meta.label}. Low alarm ${fmtVal(th.low_alarm, digits)}, low warning ${fmtVal(th.low_warning, digits)}, high warning ${fmtVal(th.high_warning, digits)}, high alarm ${fmtVal(th.high_alarm, digits)} ${unit}.`

  const marker = scale && v != null

  return (
    <div className={clsx('min-w-0', lg ? 'space-y-1.5' : 'space-y-1')}>
      <div className="flex min-w-0 items-end justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className={clsx('font-medium text-muted', lg ? 'text-[12.5px]' : 'text-[11.5px]')} id={`${idPrefix}-label`}>
            {label}
          </div>
          <div className="flex items-baseline gap-1.5">
            {v == null ? (
              <span className={clsx('font-medium text-faint', lg ? 'text-[16px] leading-8' : 'text-[13px] leading-5')}>Not reported</span>
            ) : los ? (
              <>
                <span className={clsx('font-semibold text-crit', lg ? 'text-[18px] leading-8' : 'text-[13px] leading-5')}>No light (LOS)</span>
                <span className="mono text-[11.5px] text-muted">
                  floor {fmtVal(v, digits)} {unit}
                </span>
              </>
            ) : (
              <>
                <AnimatedNumber value={v} digits={digits} className={clsx('mono font-semibold tracking-tight text-ink', lg ? 'text-[26px] leading-8' : 'text-[15px] leading-5')} />
                <span className={clsx('mono text-muted', lg ? 'text-[13px]' : 'text-[11px]')}>{unit}</span>
              </>
            )}
          </div>
        </div>
        {lg && <StatusChip status={status} className="mb-1.5" />}
      </div>
      {!lg && <StatusChip status={status} compact className="!px-0 !py-0 !text-[10px] !bg-transparent" />}

      {/* alarm thresholds above the track, warning thresholds below */}
      {lg && alarmTicks.length > 0 && <TickRow ticks={alarmTicks} lg={lg} tone="crit" pos="above" />}
      <div role="img" aria-labelledby={`${idPrefix}-label`} aria-describedby={`${idPrefix}-sum`} className="relative">
        <div className={clsx('relative flex overflow-hidden rounded-[3px]', lg ? 'h-2.5' : 'h-1.5')} style={th ? undefined : ZONE_UNKNOWN}>
          {scale &&
            zones.map((z, i) => {
              const w = scale.pct(z.to) - scale.pct(z.from)
              return w > 0 ? <div key={z.name} className={clsx('h-full', i > 0 && 'border-l border-white')} style={{ ...z.style, width: `${w}%`, opacity: v == null ? 0.5 : 1 }} /> : null
            })}
        </div>

        {marker && (
          <motion.div
            className="pointer-events-none absolute inset-y-0"
            initial={reduced ? false : { left: '50%', opacity: 0 }}
            animate={{ left: `${scale.pct(v)}%`, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 170, damping: 22, mass: 0.9 }}
          >
            <div className={clsx('absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white', TONE_MARK[meta.tone], lg ? 'h-[22px] w-[4px]' : 'h-[14px] w-[3px]')} />
          </motion.div>
        )}
      </div>
      {lg && warnTicks.length > 0 && <TickRow ticks={warnTicks} lg={lg} tone="warn" pos="below" />}
      {!lg && th && (th.low_warning != null || th.high_warning != null) && (
        <div className="mono text-[10.5px] leading-none text-faint" aria-hidden>
          <span className="max-sm:hidden">normal </span>{th.low_warning != null ? fmtTick(th.low_warning) : '…'} – {th.high_warning != null ? fmtTick(th.high_warning) : '…'}
        </div>
      )}

      {!th && lg && (
        <p className="flex items-start gap-1.5 text-[12px] text-muted">
          <CircleHelp className="mt-px size-3.5 shrink-0 text-unknown" aria-hidden />
          <span>Thresholds not reported by module — status unknown</span>
        </p>
      )}
      {offScale && !los && lg && (
        <p className={clsx('text-[11.5px]', TONE_TEXT[meta.tone])}>
          Reading is {offScale === 'low' ? 'below' : 'above'} the plotted range; marker pinned at the {offScale === 'low' ? 'left' : 'right'} edge.
        </p>
      )}
      {note && <p className={clsx('text-muted', lg ? 'text-[12px]' : 'text-[11px] leading-snug')}>{note}</p>}
      <p id={`${idPrefix}-sum`} className="sr-only">
        {summary}
      </p>
    </div>
  )
}

/** Key for the threshold plots — rendered once per instrument panel. */
export function ThresholdLegend({ className }: { className?: string }) {
  const sw = (style: CSSProperties) => <span className="inline-block h-2 w-4 rounded-[2px]" style={style} aria-hidden />
  return (
    <div className={clsx('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-muted', className)} aria-label="Threshold plot legend">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-[3px] rounded-full bg-ink" aria-hidden /> Reading
      </span>
      <span className="flex items-center gap-1.5">{sw(ZONE_OK)} Normal range</span>
      <span className="flex items-center gap-1.5">{sw(ZONE_WARN)} Warning (values below plot)</span>
      <span className="flex items-center gap-1.5">{sw(ZONE_ALARM)} Alarm (values above plot)</span>
      <span className="flex items-center gap-1.5">{sw(ZONE_UNKNOWN)} Thresholds unknown</span>
      <span className="text-faint">Thresholds are each module's own — no universal defaults.</span>
    </div>
  )
}
