import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThresholdBar } from './ThresholdBar'
import { classify, estimateDirection, latestPair } from './model'
import type { OpticalObservation, OpticInfo } from '../../lib/types'

const obs = (o: Partial<OpticalObservation>): OpticalObservation => ({ id: 1, interface_id: 'x', evidence_id: 'EV-1', investigation_id: null, source_mode: 'SIMULATED', observed_at: '2026-01-01T00:00:00Z', sim_time_ms: 0, tx_power_dbm: null, rx_power_dbm: null, temperature_c: null, voltage_v: null, bias_ma: null, flags: {}, ...o })
const optic = (wl: number) => ({ wavelength_nm: wl }) as OpticInfo

describe('optical interpretation', () => {
  it('never classifies a value as normal when thresholds are missing', () => {
    expect(classify(-3.7, null)).toBe('unknown_thresholds')
    expect(classify(null, { low_alarm: -13.9, low_warning: -9.9, high_warning: 2.4, high_alarm: 3.4 })).toBe('not_reported')
    expect(classify(-11.5, { low_alarm: -13.9, low_warning: -9.9, high_warning: 2.4, high_alarm: 3.4 })).toBe('low_warning')
  })

  it('only pairs Tx and Rx collected in the same evidence item', () => {
    const list = [obs({ interface_id: 'a', evidence_id: 'EV-1' }), obs({ interface_id: 'b', evidence_id: 'EV-2' })]
    expect(latestPair(list, 'a', 'b')).toBeNull()
    const paired = [...list, obs({ interface_id: 'b', evidence_id: 'EV-1' })]
    expect(latestPair(paired, 'a', 'b')?.evidenceId).toBe('EV-1')
  })

  it('refuses a loss estimate when the receiver reports loss of signal', () => {
    const e = estimateDirection(obs({ tx_power_dbm: -1.8 }), obs({ rx_power_dbm: -40, flags: { rx_los: true } }), optic(850), optic(850), 'A', 'B')
    expect(e.loss).toBeNull()
    expect(e.reason).toMatch(/loss of signal/)
    const ok = estimateDirection(obs({ tx_power_dbm: -1.8 }), obs({ rx_power_dbm: -11.5 }), optic(850), optic(850), 'A', 'B')
    expect(ok.loss).toBe(9.7)
  })

  it('renders unknown thresholds as UNKNOWN text, not as healthy', () => {
    render(<ThresholdBar idPrefix="t1" label="Rx power" unit="dBm" value={-3.7} thresholds={null} />)
    expect(screen.getAllByText(/unknown/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/^Normal$/)).toBeNull()
  })

  it('renders a missing value as "Not reported", never 0', () => {
    render(<ThresholdBar idPrefix="t2" label="Tx power" unit="dBm" value={null} thresholds={{ low_alarm: -9.4, low_warning: -8.4, high_warning: 2.4, high_alarm: 3.4 }} />)
    expect(screen.getAllByText(/Not reported/).length).toBeGreaterThan(0)
  })
})
