import { useId, useMemo } from 'react'
import { useReducedMotion } from 'motion/react'
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Table2 } from 'lucide-react'
import type { OpticalObservation, Thresholds } from '../../lib/types'
import { fmtSim, fmtTime } from '../../lib/format'
import { SourceBadge } from '../ui'
import { classify, flagOn, fmtVal, STATUS_META } from './model'

interface Point {
  n: number
  at: string
  sim: number | null
  source: string
  evidence: string | null
  inv: string | null
  rx: number | null
  remoteTx: number | null
  los: boolean
  status: string
}

const C = { line: '#242329', remote: '#8a8692', warn: '#986300', crit: '#be3545', grid: '#eeebf0', axis: '#8a8692', axisLine: '#e3dfe8', cursor: '#d3cfd9' }

/** Rx power history at one link end, against that module's own low thresholds. */
export function OpticHistoryChart({
  iface,
  endLabel,
  observations,
  peerObservations,
  thresholds,
}: {
  iface: string
  endLabel: 'A' | 'B'
  observations: OpticalObservation[]
  peerObservations: OpticalObservation[]
  thresholds: Thresholds | null
}) {
  const reduced = useReducedMotion()
  const uid = useId()
  const data = useMemo<Point[]>(() => {
    const peerByEv = new Map(peerObservations.filter((p) => p.evidence_id).map((p) => [p.evidence_id!, p]))
    return observations.map((o, i) => {
      const peer = o.evidence_id ? peerByEv.get(o.evidence_id) : undefined
      const los = flagOn(o, 'rx_los')
      return {
        n: i + 1,
        at: o.observed_at,
        sim: o.sim_time_ms,
        source: o.source_mode,
        evidence: o.evidence_id,
        inv: o.investigation_id,
        // A LOS reading is the sensor floor, not a power level — plot it as a gap.
        rx: los ? null : o.rx_power_dbm,
        remoteTx: peer && !flagOn(peer, 'tx_disabled') ? peer.tx_power_dbm : null,
        los,
        status: los ? 'Loss of signal' : STATUS_META[classify(o.rx_power_dbm, thresholds)].label,
      }
    })
  }, [observations, peerObservations, thresholds])

  const vals = data.flatMap((d) => [d.rx, d.remoteTx]).filter((v): v is number => v != null)
  const la = thresholds?.low_alarm ?? null
  const lw = thresholds?.low_warning ?? null
  const lo = Math.min(...vals, ...(la != null ? [la] : []), ...(lw != null ? [lw] : []))
  const hi = Math.max(...vals, 0)
  // Round to 5 dB steps so ticks land on readable values.
  const yMin = Number.isFinite(lo) ? Math.floor((lo - 1.5) / 5) * 5 : -20
  const yMax = Number.isFinite(hi) ? Math.ceil((hi + 0.5) / 5) * 5 : 5
  const yTicks = Array.from({ length: Math.round((yMax - yMin) / 5) + 1 }, (_, i) => yMin + i * 5)

  const rxVals = data.map((d) => d.rx).filter((v): v is number => v != null)
  const latest = data[data.length - 1]
  const firstBelow = lw != null ? data.find((d) => d.rx != null && d.rx <= lw) : undefined
  const summary =
    data.length === 0
      ? `No observations recorded for ${iface}.`
      : `${data.length} observation${data.length === 1 ? '' : 's'} of receive power at ${iface}. ` +
        (rxVals.length ? (Math.min(...rxVals) === Math.max(...rxVals) ? `Every reading ${fmtVal(rxVals[0])} dBm. ` : `Range ${fmtVal(Math.min(...rxVals))} to ${fmtVal(Math.max(...rxVals))} dBm. `) : 'No receive power values reported. ') +
        (latest.los ? 'Latest: loss of signal (no light; not plotted). ' : `Latest: ${fmtVal(latest.rx)} dBm (${latest.status}). `) +
        (thresholds == null
          ? 'This module reports no thresholds, so no warning or alarm levels are drawn.'
          : firstBelow
            ? `First reading at or below the low-warning threshold (${fmtVal(lw)} dBm): observation ${firstBelow.n}.`
            : `No reading at or below the low-warning threshold (${fmtVal(lw)} dBm).`)

  const tick = (n: number) => {
    const d = data[n - 1]
    if (!d) return ''
    return d.sim != null ? fmtSim(d.sim) : fmtTime(d.at).replace(' UTC', '')
  }

  return (
    <figure className="min-w-0" aria-labelledby={`${uid}-cap`}>
      <figcaption id={`${uid}-cap`} className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="grid size-5 shrink-0 place-items-center rounded-md bg-nav font-mono text-[10.5px] font-semibold text-white">{endLabel}</span>
          <span className="text-[13px] font-semibold text-ink">Rx power (dBm) at</span>
          <span className="mono min-w-0 truncate text-[12.5px] text-ink" title={iface}>
            {iface}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-ink" /> Rx (local)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-4 border-t border-dashed border-faint" /> Tx (peer, same evidence)
          </span>
          {lw != null && (
            <span className="flex items-center gap-1.5 text-warn">
              <span className="h-0 w-3 border-t border-dashed border-warn" /> <span className="mono">low warn {fmtVal(lw, 1)}</span>
            </span>
          )}
          {la != null && (
            <span className="flex items-center gap-1.5 text-crit">
              <span className="h-0 w-3 border-t border-dashed border-crit" /> <span className="mono">low alarm {fmtVal(la, 1)}</span>
            </span>
          )}
          {thresholds == null && <span className="text-muted">No thresholds reported — none drawn</span>}
        </span>
      </figcaption>

      <div className="h-[220px] w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            {la != null && <ReferenceArea y1={yMin} y2={la} fill={C.crit} fillOpacity={0.06} ifOverflow="hidden" />}
            {la != null && lw != null && <ReferenceArea y1={la} y2={lw} fill={C.warn} fillOpacity={0.06} ifOverflow="hidden" />}
            {lw != null && (
              <ReferenceLine y={lw} stroke={C.warn} strokeDasharray="4 3" strokeOpacity={0.7} />
            )}
            {la != null && (
              <ReferenceLine y={la} stroke={C.crit} strokeDasharray="4 3" strokeOpacity={0.7} />
            )}
            <XAxis dataKey="n" type="number" domain={[0.6, Math.max(data.length, 1) + 0.4]} ticks={data.map((d) => d.n)} tickFormatter={tick} tick={{ fontSize: 10.5, fill: C.axis, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={{ stroke: C.axisLine }} interval="preserveStartEnd" minTickGap={18} />
            <YAxis domain={[yMin, yMax]} ticks={yTicks} tick={{ fontSize: 10.5, fill: C.axis, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => fmtVal(v, 0)} />
            <Tooltip
              cursor={{ stroke: C.cursor, strokeDasharray: '3 3' }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const d = active && payload?.[0] ? (payload[0].payload as Point) : null
                if (!d) return null
                return (
                  <div className="min-w-[190px] rounded-lg border border-line bg-white px-3 py-2 text-[12px] shadow-[var(--shadow-lift)]">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="mono text-[11px] text-muted">#{d.n} · {d.evidence ?? 'no evidence id'}</span>
                      <SourceBadge mode={d.source} />
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted">Rx ({endLabel})</span>
                      <span className="mono font-semibold text-ink">{d.los ? 'LOS' : `${fmtVal(d.rx)} dBm`}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted">Tx (peer)</span>
                      <span className="mono text-ink">{d.remoteTx == null ? 'Not reported' : `${fmtVal(d.remoteTx)} dBm`}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted">Status</span>
                      <span className="text-ink">{d.status}</span>
                    </div>
                    <div className="mt-1.5 border-t border-line-2 pt-1.5 mono text-[10.5px] text-faint">
                      {fmtTime(d.at, true)}
                      {d.sim != null && ` · sim ${fmtSim(d.sim)}`}
                      {d.inv && <div>investigation {d.inv}</div>}
                    </div>
                  </div>
                )
              }}
            />
            <Line type="linear" dataKey="remoteTx" stroke={C.remote} strokeWidth={1.25} strokeDasharray="4 3" dot={false} isAnimationActive={!reduced} animationDuration={900} connectNulls={false} />
            <Line
              type="linear"
              dataKey="rx"
              stroke={C.line}
              strokeWidth={2}
              connectNulls={false}
              isAnimationActive={!reduced}
              animationDuration={1100}
              animationEasing="ease-out"
              dot={{ r: 3, fill: '#fff', stroke: C.line, strokeWidth: 1.5 }}
              activeDot={{ r: 5, fill: C.line, stroke: '#fff', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{summary}</p>

      <details className="group mt-2 border-t border-line-2">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 py-2 text-[12px] font-medium text-muted hover:text-ink">
          <Table2 className="size-3.5" aria-hidden /> Data points ({data.length})
          <span className="ml-auto text-faint transition-transform group-open:rotate-90" aria-hidden>
            ›
          </span>
        </summary>
        <div className="scroll-thin max-h-64 overflow-auto">
          <table className="w-full text-left text-[12px]">
            <caption className="sr-only">Receive power observations at {iface}</caption>
            <thead className="sticky top-0 bg-white text-[11px] text-muted">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">#</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Observed (UTC)</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Sim</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Rx dBm</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Peer Tx dBm</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Status</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Source</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Investigation</th>
              </tr>
            </thead>
            <tbody className="mono tabular-nums">
              {data.map((d) => (
                <tr key={d.n} className="border-t border-line-2">
                  <td className="px-3 py-1.5 text-faint">{d.n}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{fmtTime(d.at)}</td>
                  <td className="px-3 py-1.5 text-muted">{fmtSim(d.sim)}</td>
                  <td className="px-3 py-1.5 text-right">{d.los ? 'LOS' : fmtVal(d.rx)}</td>
                  <td className="px-3 py-1.5 text-right text-muted">{fmtVal(d.remoteTx)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-sans">{d.status}</td>
                  <td className="px-3 py-1.5 text-[11px] text-muted">{d.source}</td>
                  <td className="px-3 py-1.5 text-[11px] text-muted">{d.inv ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
