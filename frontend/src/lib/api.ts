import type { Catalog, Investigation, InvestigationSummary, LabStatus, OpticalObservation, Profile, ScenarioDef, Topology, Cable, Evidence, VerificationRun } from './types'

export class ApiError extends Error {
  code: string
  status: number
  details: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the FiberScope API. Is the backend running on port 8077?')
  }
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) {
    const e = body?.error
    throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? `HTTP ${res.status}`, e?.details)
  }
  return body as T
}

const post = <T,>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const patch = <T,>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
const put = <T,>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) })

export const api = {
  health: () => request<{ status: string; seeded: boolean; time: string }>('/api/health'),
  overview: () => request<{ investigations_by_status: Record<string, number>; evidence_items: number; evidence_by_source: Record<string, number>; scenarios: number; lab: LabStatus }>('/api/overview'),
  topology: () => request<Topology>('/api/topology'),
  trace: (iface: string) => request<import('./types').TracedPath>(`/api/topology/trace?interface=${encodeURIComponent(iface)}`),
  device: (id: string) => request<{ device: import('./types').Device; interfaces: import('./types').Iface[]; recent_evidence: { id: string; title: string; verdict: string; collected_at: string; investigation_id: string | null; source_mode: string }[] }>(`/api/devices/${encodeURIComponent(id)}`),
  cables: (q?: string, device?: string) => {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (device) p.set('endpoint_device', device)
    return request<{ cables: Cable[]; audit: { severity: string; code: string; message: string; cable_id: string | null; interface_id: string | null }[]; total: number }>(`/api/cables?${p}`)
  },
  validateCable: (body: unknown) => post<{ valid: boolean; issues: { severity: string; code: string; message: string }[] }>('/api/cables/validate', body),
  createCable: (body: unknown) => post<{ id: string }>('/api/cables', body),
  deleteCable: (id: string) => request<{ deleted: string }>(`/api/cables/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  optics: () => request<{ optics: { interface_id: string; id: string; standard: string; vendor: string; dom_supported: boolean; thresholds_available: boolean; link_id: string | null; peer: string | null; latest: OpticalObservation | null }[]; links: { id: string; a: string; b: string; media: string; has_optics: boolean }[] }>('/api/optics'),
  opticalObservations: (ifaces: string[], investigation?: string, limit = 200) => {
    const p = new URLSearchParams({ limit: String(limit) })
    ifaces.forEach((i) => p.append('interface', i))
    if (investigation) p.set('investigation', investigation)
    return request<{ observations: OpticalObservation[] }>(`/api/optics/observations?${p}`)
  },
  scenarios: () => request<{ scenarios: ScenarioDef[] }>('/api/scenarios'),
  catalog: () => request<Catalog>('/api/catalog'),
  investigations: () => request<{ investigations: InvestigationSummary[] }>('/api/investigations'),
  investigation: (id: string) => request<Investigation>(`/api/investigations/${id}`),
  createInvestigation: (scenario_key: string, mode: 'guided' | 'challenge' = 'guided', source_mode = 'SIMULATED') =>
    post<Investigation>('/api/investigations', { scenario_key, mode, source_mode }),
  baseline: (id: string) => post<{ evidence_ids: string[]; investigation: Investigation }>(`/api/investigations/${id}/baseline`),
  injectFault: (id: string) => post<Investigation>(`/api/investigations/${id}/inject-fault`),
  diagnostic: (id: string, action: string, target: Record<string, unknown>, params: Record<string, unknown> = {}) =>
    post<{ evidence: Evidence; investigation: Investigation }>(`/api/investigations/${id}/diagnostics`, { action, target, params }),
  notes: (id: string, body: { symptom?: string; scope?: string; lessons_learned?: string; title?: string }) => patch<Investigation>(`/api/investigations/${id}/notes`, body),
  addHypothesis: (id: string, statement: string, supporting: string[], contradicting: string[]) =>
    post<Investigation>(`/api/investigations/${id}/hypotheses`, { statement, supporting_evidence_ids: supporting, contradicting_evidence_ids: contradicting }),
  updateHypothesis: (id: string, hid: string, body: { status?: string; supporting_evidence_ids?: string[]; contradicting_evidence_ids?: string[] }) =>
    patch<Investigation>(`/api/investigations/${id}/hypotheses/${hid}`, body),
  diagnosis: (id: string, category: string, statement: string, evidence_ids: string[]) =>
    post<Investigation>(`/api/investigations/${id}/diagnosis`, { category, statement, evidence_ids }),
  repair: (id: string, action: string, target: Record<string, unknown>, params: Record<string, unknown> = {}, notes = '') =>
    post<Investigation>(`/api/investigations/${id}/repairs`, { action, target, params, notes }),
  verify: (id: string) => post<{ verification: VerificationRun; investigation: Investigation }>(`/api/investigations/${id}/verify`),
  resolve: (id: string, lessons_learned?: string) => post<Investigation>(`/api/investigations/${id}/resolve`, { lessons_learned }),
  reopen: (id: string, reason: string) => post<Investigation>(`/api/investigations/${id}/reopen`, { reason }),
  abandon: (id: string, reason: string) => post<Investigation>(`/api/investigations/${id}/abandon`, { reason }),
  reset: (id: string) => post<Investigation>(`/api/investigations/${id}/reset`),
  restart: (id: string) => post<Investigation>(`/api/investigations/${id}/restart`),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  report: (id: string) => request<any>(`/api/reports/${id}`),
  evidence: (id: string) => request<Evidence & { integrity_ok: boolean }>(`/api/evidence/${id}`),
  importEvidence: (body: unknown) => post<{ evidence_id: string }>('/api/evidence/import', body),
  profile: () => request<Profile>('/api/profile'),
  saveProfile: (p: Profile) => put<Profile>('/api/profile', p),
  lab: () => request<LabStatus>('/api/lab/status'),
}
