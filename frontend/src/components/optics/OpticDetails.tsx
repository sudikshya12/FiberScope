import clsx from 'clsx'
import type { Device, Iface, OpticalObservation } from '../../lib/types'
import { fmtSim, fmtTime } from '../../lib/format'
import { EndBadge } from './EndpointCard'
import { fmtVal, METRICS, type MetricKey } from './model'

const KEYS: MetricKey[] = ['tx_power_dbm', 'rx_power_dbm', 'temperature_c', 'voltage_v', 'bias_ma']
const TH_KEYS = ['low_alarm', 'low_warning', 'high_warning', 'high_alarm'] as const

/** Module identity, per-module thresholds and the latest raw reading for both link ends. */
export function OpticDetails({ ends }: { ends: { end: 'A' | 'B'; iface: Iface | undefined; device: Device | undefined; obs: OpticalObservation | null }[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:gap-0 lg:divide-x lg:divide-line-2">
      {ends.map((e, i) => (
        <End key={e.end} {...e} className={i === 0 ? 'lg:pr-6' : 'lg:pl-6'} />
      ))}
    </div>
  )
}

function End({ end, iface, device, obs, className }: { end: 'A' | 'B'; iface: Iface | undefined; device: Device | undefined; obs: OpticalObservation | null; className?: string }) {
  const o = iface?.optic ?? null
  return (
    <div className={clsx('min-w-0', className)}>
      <div className="mb-3 flex min-w-0 items-center gap-2">
        <EndBadge end={end} className="size-5 text-[10.5px]" />
        <span className="mono truncate text-[13px] font-semibold text-ink">{iface?.id ?? '—'}</span>
        <span className="ml-auto shrink-0 text-[12px] text-muted">{device?.name ?? ''}</span>
      </div>
      {o ? (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-3">
            <Field k="Module" v={o.id} mono />
            <Field k="Standard" v={o.standard} mono />
            <Field k="Form factor" v={o.form_factor} mono />
            <Field k="Vendor" v={o.vendor} />
            <Field k="Part number" v={o.part_number} mono />
            <Field k="Serial" v={o.serial} mono />
            <Field k="Wavelength" v={o.wavelength_nm != null ? `${o.wavelength_nm} nm` : 'Not reported'} mono />
            <Field k="DOM" v={o.dom_supported ? '✓ Supported' : '✕ Not supported'} />
            <Field k="Thresholds" v={o.thresholds_available ? '✓ Module-reported' : '? Not reported'} />
            <div className="col-span-2 min-w-0 sm:col-span-3">
              <dt className="text-faint">Threshold source</dt>
              <dd className="mt-0.5 leading-snug text-ink/80">{o.threshold_source}</dd>
            </div>
          </dl>

          <div className="scroll-thin mt-4 overflow-x-auto">
            <table className="w-full min-w-[440px] text-[12px]">
              <caption className="mb-1 text-left text-[11.5px] font-medium text-muted">Latest raw reading vs. module thresholds</caption>
              <thead>
                <tr className="border-b border-line text-[10.5px] uppercase tracking-[0.06em] text-faint">
                  <th scope="col" className="py-1 pr-3 text-left font-semibold">Metric</th>
                  <th scope="col" className="px-2 py-1 text-right font-semibold">Value</th>
                  <th scope="col" className="px-2 py-1 text-right font-semibold">Lo alarm</th>
                  <th scope="col" className="px-2 py-1 text-right font-semibold">Lo warn</th>
                  <th scope="col" className="px-2 py-1 text-right font-semibold">Hi warn</th>
                  <th scope="col" className="py-1 pl-2 text-right font-semibold">Hi alarm</th>
                </tr>
              </thead>
              <tbody className="mono tabular-nums">
                {KEYS.map((k) => {
                  const t = o.thresholds?.[k] ?? null
                  const v = obs ? obs[k] : null
                  return (
                    <tr key={k} className="border-b border-line-2 last:border-0">
                      <th scope="row" className="py-1 pr-3 text-left font-sans font-normal text-ink">
                        {METRICS[k].short} <span className="text-faint">({METRICS[k].unit})</span>
                      </th>
                      <td className={clsx('px-2 py-1 text-right', v == null ? 'font-sans text-faint' : 'font-medium text-ink')}>{fmtVal(v, METRICS[k].digits)}</td>
                      {TH_KEYS.map((tk, n) => (
                        <td key={tk} className={clsx('py-1 text-right text-muted', n === 3 ? 'pl-2' : 'px-2')}>
                          {t ? (t[tk] == null ? '—' : fmtVal(t[tk], METRICS[k].digits)) : n === 0 ? <span className="font-sans text-faint">unknown</span> : ''}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {obs ? (
            <p className="mono mt-2 text-[11px] leading-relaxed text-faint">
              {obs.evidence_id ?? 'no evidence id'}
              {obs.investigation_id && ` · ${obs.investigation_id}`} · {fmtTime(obs.observed_at, true)}
              {obs.sim_time_ms != null && ` · sim ${fmtSim(obs.sim_time_ms)}`} · flags {Object.keys(obs.flags ?? {}).filter((f) => (obs.flags as Record<string, unknown>)[f]).join(', ') || 'none'}
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-muted">No reading recorded for this end.</p>
          )}
        </>
      ) : (
        <p className="text-[12.5px] text-muted">No pluggable optic recorded on this port.</p>
      )}
    </div>
  )
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-faint">{k}</dt>
      <dd className={clsx('mt-0.5 truncate text-ink', mono && 'mono text-[12px]')} title={v}>
        {v}
      </dd>
    </div>
  )
}
