import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Link } from 'react-router'
import { AlertTriangle, Info, Radio, ZapOff } from 'lucide-react'
import type { Device, Iface, OpticalObservation } from '../../lib/types'
import { fmtSim, fmtTime } from '../../lib/format'
import { SourceBadge } from '../ui'
import { ThresholdBar } from './ThresholdBar'
import { flagOn, METRICS, thresholdsFor, type MetricKey } from './model'

export function EndBadge({ end, className }: { end: 'A' | 'B'; className?: string }) {
  return (
    <span className={clsx('grid size-6 shrink-0 place-items-center rounded-md bg-nav font-mono text-[11.5px] font-semibold text-white', className)} aria-hidden>
      {end}
    </span>
  )
}

/** Cautious link-state text from the latest reading's flags only — no inference beyond what the module reported. */
function FlagLine({ obs, hasOptic }: { obs: OpticalObservation | null; hasOptic: boolean }) {
  if (!hasOptic) return <Line icon={<Info className="size-3.5" />} tone="unknown" text="No pluggable optic on this port — optical telemetry unavailable (not zero)." />
  if (!obs) return <Line icon={<Info className="size-3.5" />} tone="unknown" text="No reading recorded for this end yet." />
  const items: { icon: ReactNode; tone: 'crit' | 'warn' | 'unknown'; text: string }[] = []
  if (flagOn(obs, 'rx_los')) items.push({ icon: <AlertTriangle className="size-3.5" />, tone: 'crit', text: 'RX LOS — receiver reports loss of signal.' })
  if (flagOn(obs, 'tx_disabled')) items.push({ icon: <ZapOff className="size-3.5" />, tone: 'warn', text: 'TX DISABLED — laser off; Tx power not reported.' })
  if (flagOn(obs, 'dom_unsupported')) items.push({ icon: <Info className="size-3.5" />, tone: 'unknown', text: 'DOM not supported by this module — values unavailable.' })
  if (items.length === 0) return <Line icon={<Radio className="size-3.5" />} tone="ok" text="No LOS or Tx-disable flag. Flags alone don't prove the link is healthy." />
  return (
    <div className="space-y-1">
      {items.map((it) => (
        <Line key={it.text} {...it} />
      ))}
    </div>
  )
}

function Line({ icon, tone, text }: { icon: ReactNode; tone: 'ok' | 'crit' | 'warn' | 'unknown'; text: string }) {
  return (
    <p className={clsx('flex items-start gap-1.5 text-[12px] leading-snug', tone === 'crit' ? 'font-medium text-crit' : tone === 'warn' ? 'font-medium text-warn' : 'text-muted')}>
      <span className="mt-px shrink-0" aria-hidden>
        {icon}
      </span>
      <span>{text}</span>
    </p>
  )
}

/**
 * One link end inside the instrument panel (no card chrome of its own).
 * `shared` is the observation already shown in the panel header — source/time are repeated here only if this end differs.
 */
export function EndpointCard({ end, iface, device, obs, shared }: { end: 'A' | 'B'; iface: Iface | undefined; device: Device | undefined; obs: OpticalObservation | null; shared?: OpticalObservation | null }) {
  const optic = iface?.optic ?? null
  const id = iface?.id ?? '—'
  const prefix = `ep-${end}`
  const big: MetricKey[] = ['rx_power_dbm', 'tx_power_dbm']
  const small: MetricKey[] = ['temperature_c', 'voltage_v', 'bias_ma']
  const headingId = `${prefix}-heading`

  return (
    <section className="flex min-w-0 flex-col" aria-labelledby={headingId}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 px-4 pb-3 pt-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <EndBadge end={end} />
          <div className="min-w-0">
            <h3 id={headingId} className="mono truncate text-[14px] font-semibold text-ink" title={id}>
              <span className="sr-only">Endpoint {end}: </span>
              {id}
            </h3>
            <div className="truncate text-[12px] text-muted">
              {device ? (
                <Link to={`/devices/${device.id}`} className="hover:text-accent-strong hover:underline">
                  {device.name}
                </Link>
              ) : (
                '—'
              )}
              {optic && (
                <span className="text-faint">
                  {' '}
                  · {optic.standard}
                  {optic.wavelength_nm != null && ` · ${optic.wavelength_nm} nm`}
                </span>
              )}
            </div>
          </div>
        </div>
        {obs && (obs.source_mode !== shared?.source_mode || obs.observed_at !== shared?.observed_at) && (
          <div className="flex shrink-0 items-center gap-2 pl-[34px] sm:pl-0">
            {obs.source_mode !== shared?.source_mode && <SourceBadge mode={obs.source_mode} />}
            <span className="mono text-[11px] text-muted">
              {fmtTime(obs.observed_at)}
              {obs.sim_time_ms != null && ` · ${fmtSim(obs.sim_time_ms)}`}
            </span>
          </div>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-4 px-4 pb-4 sm:px-5">
        {big.map((k) => (
          <ThresholdBar
            key={`${k}-${id}`}
            idPrefix={`${prefix}-${k}`}
            label={`${METRICS[k].short} · ${k === 'rx_power_dbm' ? 'from' : 'toward'} ${end === 'A' ? 'B' : 'A'}`}
            unit={METRICS[k].unit}
            digits={METRICS[k].digits}
            value={obs ? obs[k] : null}
            thresholds={thresholdsFor(optic, k)}
            los={k === 'rx_power_dbm' && flagOn(obs, 'rx_los')}
            note={k === 'tx_power_dbm' && flagOn(obs, 'tx_disabled') ? 'Laser disabled — no transmit power to report.' : k === 'rx_power_dbm' && flagOn(obs, 'rx_los') ? 'Loss of signal — the reading is the module measurement floor, not a power level.' : undefined}
          />
        ))}

        <div className="grid grid-cols-3 gap-3 border-t border-line-2 pt-3.5">
          {small.map((k) => (
            <ThresholdBar
              key={`${k}-${id}`}
              idPrefix={`${prefix}-${k}`}
              size="sm"
              label={`${METRICS[k].short} (${METRICS[k].unit})`}
              unit={METRICS[k].unit}
              digits={METRICS[k].digits}
              value={obs ? obs[k] : null}
              thresholds={thresholdsFor(optic, k)}
              note={k === 'bias_ma' && flagOn(obs, 'tx_disabled') ? 'Laser off — no bias expected.' : undefined}
            />
          ))}
        </div>

        <div className="mt-auto border-t border-line-2 pt-3">
          <FlagLine obs={obs} hasOptic={!!optic} />
        </div>
      </div>
    </section>
  )
}
