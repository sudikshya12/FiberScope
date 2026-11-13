import clsx from 'clsx'
import { fmtSim, fmtTime } from '../../lib/format'
import type { Metrics, TimelineEvent } from '../../lib/types'
import { fmtSecs, humanize } from './primitives'

const MILESTONES: [string, string][] = [
  ['investigation_started_at', 'Investigation opened'],
  ['fault_injected_at', 'Fault injected'],
  ['first_diagnostic_at', 'First diagnostic action'],
  ['diagnosis_recorded_at', 'Diagnosis recorded'],
  ['repair_applied_at', 'Corrective action applied'],
  ['verification_completed_at', 'Verification completed'],
  ['resolved_at', 'Resolved'],
]

const INTERVALS: [string, string][] = [
  ['fault_to_first_action_s', 'Fault → first diagnostic action'],
  ['fault_to_diagnosis_s', 'Fault → diagnosis recorded'],
  ['diagnosis_to_repair_s', 'Diagnosis → corrective action'],
  ['repair_to_verified_s', 'Corrective action → verified'],
  ['fault_to_resolved_s', 'Fault → resolved'],
]

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-2 py-1.5 last:border-b-0">
      <dt className="shrink-0 text-[13px] text-muted">{k}</dt>
      <dd className="tnum min-w-0 break-words text-right font-mono text-[12.5px] text-ink">{v}</dd>
    </div>
  )
}

export function TimeMetrics({ metrics }: { metrics: Metrics }) {
  const wc = metrics.wall_clock
  const st = metrics.simulated_time
  const known = new Set([...MILESTONES, ...INTERVALS].map(([k]) => k).concat('note'))
  const extra = Object.keys(wc).filter((k) => !known.has(k))
  const sinceFault = st.fault_onset_ms != null ? st.clock_ms - st.fault_onset_ms : null
  return (
    <div className="grid items-start gap-x-8 gap-y-6 md:grid-cols-2">
      <div className="rpt-avoid border-t border-line pt-3">
        <h3 className="text-[13px] font-semibold text-ink">Wall-clock time</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{String(wc.note ?? 'Real elapsed time of operator interaction (UTC wall clock).')}</p>
        <dl className="mt-3">
          {MILESTONES.map(([k, label]) => (
            <Row key={k} k={label} v={wc[k] ? fmtTime(String(wc[k])) : '—'} />
          ))}
        </dl>
        <div className="mt-3 text-[12px] text-muted">Intervals</div>
        <dl className="mt-1">
          {INTERVALS.map(([k, label]) => (
            <Row key={k} k={label} v={fmtSecs(wc[k])} />
          ))}
          {extra.map((k) => (
            <Row key={k} k={humanize(k)} v={String(wc[k] ?? '—')} />
          ))}
        </dl>
      </div>
      <div className="rpt-avoid border-t border-line pt-3">
        <h3 className="text-[13px] font-semibold text-ink">Simulated network time</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{st.note}</p>
        {st.applies ? (
          <dl className="mt-3">
            <Row k="Simulated clock at report time" v={`${fmtSim(st.clock_ms)}`} />
            <Row k="Simulated fault onset" v={fmtSim(st.fault_onset_ms)} />
            <Row k="Simulated time since fault onset" v={sinceFault == null ? '—' : fmtSim(sinceFault)} />
            <Row k="Simulated detection latency" v={st.simulated_detection_latency_ms == null ? 'N/A' : fmtSim(st.simulated_detection_latency_ms)} />
            <Row k="Detection mechanism" v={st.detection_mechanism ?? 'None (operator-reported symptom)'} />
          </dl>
        ) : (
          <p className="mt-3 text-[13px] text-muted">Not applicable — this execution did not use the simulation clock.</p>
        )}
        <p className="mt-3 text-[12px] leading-relaxed text-muted">Simulated and wall-clock times are independent and must not be compared or summed.</p>
      </div>
    </div>
  )
}

const DOT: Record<string, string> = {
  fault_injected: 'bg-crit',
  verification_failed: 'bg-crit',
  alarm: 'bg-warn',
  investigation_abandoned: 'bg-unknown',
  abandoned: 'bg-unknown',
  verification_passed: 'bg-ok',
  resolved: 'bg-ok',
  diagnosis_recorded: 'bg-ink',
  repair_applied: 'bg-ink',
  baseline_captured: 'bg-ink',
}

export function TimelineList({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <p className="text-muted">No audit events recorded.</p>
  return (
    <ol className="relative" aria-label="Audit timeline">
      {events.map((t, i) => (
        <li key={t.id} className="relative grid grid-cols-[14px_1fr] gap-x-3 pb-3 last:pb-0 sm:grid-cols-[14px_118px_1fr]">
          {i < events.length - 1 && <span aria-hidden className="absolute left-[6px] top-3 h-full w-px bg-line" />}
          <span aria-hidden className={clsx('relative z-10 mt-[7px] size-[9px] justify-self-center rounded-full ring-[3px] ring-white', DOT[t.kind] ?? 'bg-[#c9c5cf]')} />
          <div className="tnum col-start-2 font-mono text-[11.5px] leading-6 text-muted sm:col-start-auto">
            {fmtTime(t.at)}
            <span className="ml-2 text-faint sm:ml-0 sm:block sm:leading-4">{t.sim_time_ms == null ? '' : `sim ${fmtSim(t.sim_time_ms)}`}</span>
          </div>
          <div className="col-start-2 min-w-0 sm:col-start-auto">
            <div className="text-[12px] font-medium text-muted sm:leading-6">{humanize(t.kind)}</div>
            <div className="break-words text-[13.5px] leading-snug text-ink">{t.message}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}
