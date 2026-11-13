export function fmtTime(iso: string | null | undefined, withDate = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const t = d.toISOString().slice(11, 19)
  return withDate ? `${d.toISOString().slice(0, 10)} ${t} UTC` : `${t} UTC`
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

export function fmtSim(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `T+${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function fmtDuration(s: number | null | undefined): string {
  if (s == null) return '—'
  if (s < 60) return `${s.toFixed(0)} s`
  const m = Math.floor(s / 60)
  return `${m} min ${Math.round(s % 60)} s`
}

export function fmtNum(v: number | null | undefined, digits = 2, unit = ''): string {
  if (v == null || Number.isNaN(v)) return 'N/A'
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ''}`
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 45) return 'just now'
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`
  return `${Math.round(diff / 86400)} d ago`
}

export const ifaceShort = (id: string) => id.replace('Ethernet', 'Eth')
export const devOf = (id: string) => id.split(':')[0]
export const portOf = (id: string) => id.split(':').slice(1).join(':')

export const STATUS_LABEL: Record<string, string> = {
  opened: 'Opened',
  baseline_reviewed: 'Baseline reviewed',
  investigating: 'Investigating',
  diagnosis_recorded: 'Diagnosis recorded',
  repair_applied: 'Repair applied',
  verifying: 'Verified — ready to resolve',
  verification_failed: 'Verification failed',
  resolved: 'Resolved',
  abandoned: 'Abandoned',
}
