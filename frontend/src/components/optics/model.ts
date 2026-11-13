import type { OpticalObservation, OpticInfo, Thresholds } from '../../lib/types'

/** Mirrors backend `classify()` in app/sim/diagnostics.py so the UI never disagrees with evidence. */
export type MetricStatus = 'normal' | 'low_warning' | 'low_alarm' | 'high_warning' | 'high_alarm' | 'partial_thresholds' | 'unknown_thresholds' | 'not_reported'

export type MetricKey = 'tx_power_dbm' | 'rx_power_dbm' | 'temperature_c' | 'voltage_v' | 'bias_ma'

export const METRICS: Record<MetricKey, { label: string; short: string; unit: string; digits: number }> = {
  tx_power_dbm: { label: 'Transmit power', short: 'Tx power', unit: 'dBm', digits: 2 },
  rx_power_dbm: { label: 'Receive power', short: 'Rx power', unit: 'dBm', digits: 2 },
  temperature_c: { label: 'Module temperature', short: 'Temperature', unit: '°C', digits: 1 },
  voltage_v: { label: 'Supply voltage', short: 'Voltage', unit: 'V', digits: 2 },
  bias_ma: { label: 'Laser bias current', short: 'Bias', unit: 'mA', digits: 1 },
}

export function classify(value: number | null | undefined, th: Thresholds | null | undefined): MetricStatus {
  if (value == null || Number.isNaN(value)) return 'not_reported'
  if (!th) return 'unknown_thresholds'
  const { low_alarm: la, low_warning: lw, high_warning: hw, high_alarm: ha } = th
  if (la != null && value <= la) return 'low_alarm'
  if (ha != null && value >= ha) return 'high_alarm'
  if (lw != null && value <= lw) return 'low_warning'
  if (hw != null && value >= hw) return 'high_warning'
  if (la == null || lw == null || hw == null || ha == null) return 'partial_thresholds'
  return 'normal'
}

export const STATUS_META: Record<MetricStatus, { label: string; short?: string; tone: 'ok' | 'warn' | 'crit' | 'unknown'; symbol: string; severity: number }> = {
  normal: { label: 'Within thresholds', short: 'Normal', tone: 'ok', symbol: '', severity: 0 },
  low_warning: { label: 'Low warning', tone: 'warn', symbol: '▼', severity: 2 },
  high_warning: { label: 'High warning', tone: 'warn', symbol: '▲', severity: 2 },
  low_alarm: { label: 'Low alarm', tone: 'crit', symbol: '▼▼', severity: 3 },
  high_alarm: { label: 'High alarm', tone: 'crit', symbol: '▲▲', severity: 3 },
  partial_thresholds: { label: 'Partial thresholds', short: 'Partial', tone: 'unknown', symbol: '?', severity: 1 },
  unknown_thresholds: { label: 'Unknown', tone: 'unknown', symbol: '', severity: 1 },
  not_reported: { label: 'Not reported', tone: 'unknown', symbol: '', severity: 1 },
}

export const thresholdsFor = (optic: OpticInfo | null | undefined, key: MetricKey): Thresholds | null => optic?.thresholds?.[key] ?? null

export function fmtVal(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return 'Not reported'
  // Typographic minus for negative dBm values; keeps tabular alignment readable.
  return v.toFixed(digits).replace(/^-/, '−')
}

export const fmtSigned = (v: number, digits = 2) => (v < 0 ? `−${Math.abs(v).toFixed(digits)}` : v.toFixed(digits))

export const flagOn = (o: OpticalObservation | null | undefined, k: string) => !!o && !!o.flags && !!(o.flags as Record<string, unknown>)[k]

/** Latest observation per interface (observations arrive oldest → newest). */
export function latestFor(obs: OpticalObservation[], iface: string): OpticalObservation | null {
  for (let i = obs.length - 1; i >= 0; i--) if (obs[i].interface_id === iface) return obs[i]
  return null
}

export interface PairedReading {
  evidenceId: string
  a: OpticalObservation
  b: OpticalObservation
}

/** Most recent evidence item that recorded BOTH link ends — the only basis for a loss estimate. */
export function latestPair(obs: OpticalObservation[], a: string, b: string): PairedReading | null {
  const byEv = new Map<string, { a?: OpticalObservation; b?: OpticalObservation; order: number }>()
  obs.forEach((o, i) => {
    if (!o.evidence_id) return
    const rec = byEv.get(o.evidence_id) ?? { order: i }
    rec.order = Math.max(rec.order, i)
    if (o.interface_id === a) rec.a = o
    if (o.interface_id === b) rec.b = o
    byEv.set(o.evidence_id, rec)
  })
  let best: PairedReading | null = null
  let bestOrder = -1
  for (const [evidenceId, r] of byEv) if (r.a && r.b && r.order > bestOrder) {
    best = { evidenceId, a: r.a, b: r.b }
    bestOrder = r.order
  }
  return best
}

export interface DirectionEstimate {
  from: string
  to: string
  fromLabel: 'A' | 'B'
  toLabel: 'A' | 'B'
  tx: number | null
  rx: number | null
  loss: number | null
  reason: string | null
  txAt: string
  rxAt: string
}

export function estimateDirection(tx: OpticalObservation, rx: OpticalObservation, txOptic: OpticInfo | null, rxOptic: OpticInfo | null, fromLabel: 'A' | 'B', toLabel: 'A' | 'B'): DirectionEstimate {
  const base = { from: tx.interface_id, to: rx.interface_id, fromLabel, toLabel, tx: tx.tx_power_dbm, rx: rx.rx_power_dbm, txAt: tx.observed_at, rxAt: rx.observed_at }
  let reason: string | null = null
  if (flagOn(tx, 'tx_disabled')) reason = `Tx(${fromLabel}) laser disabled — no transmit power reported.`
  else if (tx.tx_power_dbm == null) reason = `Tx(${fromLabel}) not reported by the module.`
  else if (flagOn(rx, 'rx_los')) reason = `Rx(${toLabel}) reports loss of signal — the reading is the sensor floor, not a power level.`
  else if (rx.rx_power_dbm == null) reason = `Rx(${toLabel}) not reported by the module.`
  else if (txOptic?.wavelength_nm == null || rxOptic?.wavelength_nm == null) reason = 'Wavelength of one module is unknown — readings may not be comparable.'
  else if (txOptic.wavelength_nm !== rxOptic.wavelength_nm) reason = `Wavelength mismatch (${txOptic.wavelength_nm} nm vs ${rxOptic.wavelength_nm} nm) — readings are not comparable.`
  const loss = reason == null ? Math.round((tx.tx_power_dbm! - rx.rx_power_dbm!) * 100) / 100 : null
  return { ...base, loss, reason }
}
