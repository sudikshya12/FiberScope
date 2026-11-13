export type SourceMode = 'SIMULATED' | 'LINUX_LAB' | 'IMPORTED_SAMPLE'
export type Verdict = 'ok' | 'warning' | 'fail' | 'info'
export type ObsStatus = 'up' | 'down' | 'admin_down' | 'degraded' | 'mismatch' | 'unknown' | 'info' | 'ok'
export type InvStatus =
  | 'opened'
  | 'baseline_reviewed'
  | 'investigating'
  | 'diagnosis_recorded'
  | 'repair_applied'
  | 'verifying'
  | 'verification_failed'
  | 'resolved'
  | 'abandoned'

export interface Device {
  id: string
  name: string
  role: 'server' | 'access_switch' | 'patch_panel' | 'gateway'
  rack: string
  rack_unit: string | null
  model: string
  is_passive: boolean
  is_modeled_only: boolean
  mgmt_address: string | null
  notes: string
}

export interface Thresholds {
  low_alarm: number | null
  low_warning: number | null
  high_warning: number | null
  high_alarm: number | null
}

export interface OpticInfo {
  id: string
  standard: string
  dom_supported: boolean
  thresholds_available: boolean
  vendor: string
  part_number: string
  serial: string
  wavelength_nm: number | null
  form_factor: string
  threshold_source: string
  thresholds: Record<string, Thresholds> | null
}

export interface Iface {
  id: string
  device_id: string
  name: string
  kind: string
  media: string
  speed_gbps: number | null
  mac: string | null
  ipv4_cidr: string | null
  ipv6_cidr: string | null
  switchport_mode: string | null
  intended_vlan: number | null
  intended_allowed_vlans: number[] | null
  intended_mtu: number | null
  description: string
  cable_id: string | null
  link_id: string | null
  peer: string | null
  patch_peer: string | null
  optic: OpticInfo | null
}

export interface Cable {
  id: string
  kind: string
  media: string
  fiber_type: string | null
  nominal_length_m: number | null
  label_status: 'labeled' | 'missing' | 'mismatch'
  a: string | null
  b: string | null
  trunk_id: string | null
  connector_a: string
  connector_b: string
  is_modeled_only: boolean
  a_device?: string | null
  b_device?: string | null
  notes?: string
  source?: string
}

export interface PathHop {
  kind: 'interface' | 'cable' | 'patch_mapping' | 'gap'
  id: string
  label: string
  device_id: string | null
  detail: string
}

export interface TracedPath {
  start: string
  end: string | null
  complete: boolean
  cables: string[]
  mated_points: string[]
  gap_reason: string | null
  hops: PathHop[]
  text: string
}

export interface Budget {
  fiber_length_m: number
  fiber_types: string[]
  attenuation_db_per_km: number
  mated_pairs: number
  assumed_loss_per_mated_pair_db: number
  estimated_budget_db: number
  basis: string
}

export interface Link {
  id: string
  a: string
  b: string
  media: string
  path: TracedPath
  planning_budget: Budget | null
}

export interface Topology {
  environment: { id: string; name: string; description: string } | null
  devices: Device[]
  interfaces: Iface[]
  vlans: { id: number; name: string; ipv4_subnet: string | null; ipv6_subnet: string | null; gateway_ipv4: string | null; description: string }[]
  cables: Cable[]
  patch_mappings: { front: string; rear: string }[]
  links: Link[]
  inspection_points: string[]
  source: string
}

export interface Observation {
  kind: string
  id: string
  status: ObsStatus | string
  label?: string
  cables?: string[]
  mated_points?: string[]
  mtu?: number
}

export interface Evidence {
  id: string
  seq: number
  investigation_id: string | null
  execution_id: string | null
  diagnostic_run_id: string | null
  phase: 'baseline' | 'investigation' | 'verification' | 'repair'
  source_mode: SourceMode
  source_id: string
  collector: string
  title: string
  target: Record<string, unknown>
  params: Record<string, unknown>
  command: string
  purpose: string
  raw_output: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>
  interpretation: string
  limitations: string[]
  observations: Observation[]
  verdict: Verdict
  collection_status: string
  collected_at: string
  sim_time_ms: number | null
  content_sha256: string
  next_steps: string[]
}

export interface Hypothesis {
  id: string
  statement: string
  status: 'open' | 'supported' | 'refuted' | 'confirmed'
  supporting_evidence_ids: string[]
  contradicting_evidence_ids: string[]
  created_at: string
  updated_at: string
}

export interface Repair {
  id: string
  action: string
  target: Record<string, unknown>
  params: Record<string, unknown>
  description: string
  command: string
  source_mode: SourceMode
  changed_resources: string[]
  outcome: string
  notes: string
  evidence_id: string | null
  applied_at: string
  sim_time_ms: number | null
}

export interface VerificationCheck {
  id: string
  label: string
  rationale: string
  passed: boolean
  detail: string
  evidence_ids: string[]
}

export interface VerificationRun {
  id: string
  started_at: string
  completed_at: string
  passed: boolean
  checks: VerificationCheck[]
}

export interface TimelineEvent {
  id: number
  kind: string
  message: string
  at: string
  sim_time_ms: number | null
  data: Record<string, unknown>
}

export interface ScenarioDef {
  key: string
  version: number
  title: string
  short: string
  difficulty?: string
  learning_objective?: string
  symptom_report: string
  baseline: string
  fault_mutation?: string
  observable_symptoms?: string[]
  available_tests?: string[]
  expected_evidence?: string[]
  alternative_causes?: string[]
  corrective_action?: string
  reset_behavior: string
  modes: string[]
  diagnosis_category?: string
  hints?: string[]
  safety?: string
  note?: string
  focus?: { src: string; dst: string }
  recovery_checks?: { id: string; label: string; rationale: string; steps: { action: string; target: Record<string, unknown>; params: Record<string, unknown> }[] }[]
  baseline_actions?: { action: string; target: Record<string, unknown>; params: Record<string, unknown> }[]
}

export interface Metrics {
  wall_clock: Record<string, string | number | null>
  simulated_time: {
    note: string
    applies: boolean
    clock_ms: number
    fault_onset_ms: number | null
    simulated_detection_latency_ms: number | null
    detection_mechanism: string | null
  }
  counts: { diagnostic_actions: number; repairs: number; failed_verifications: number; reopened: number }
}

export interface InvestigationSummary {
  id: string
  title: string
  mode: 'guided' | 'challenge'
  status: InvStatus
  symptom: string
  scope: string
  created_at: string
  resolved_at: string | null
  abandoned_at: string | null
  diagnosis_category: string | null
  diagnosis: string | null
  diagnosis_evidence_ids: string[]
  lessons_learned: string
  failed_verifications: number
  scenario: { key: string; version: number; title: string; short: string }
  execution: {
    id: string
    status: 'baseline' | 'faulted' | 'reset'
    source_mode: SourceMode
    sim_clock_ms: number
    fault_injected_at: string | null
    fault_injected_sim_ms: number | null
    created_at: string
  }
  counts?: Metrics['counts']
}

export interface Investigation extends InvestigationSummary {
  scenario_definition: ScenarioDef
  answer_key: null | {
    diagnosis_category: string
    diagnosis_label: string
    fault_mutation: string
    corrective_action: string
    diagnosis_matched: boolean | null
  }
  evidence: Evidence[]
  hypotheses: Hypothesis[]
  repairs: Repair[]
  verifications: VerificationRun[]
  timeline: TimelineEvent[]
  metrics: Metrics
  resolution_criteria: { id: string; label: string; met: boolean }[]
  diagnosis_categories: Record<string, string>
  focus: { src: string; dst: string } | null
}

export interface CatalogAction {
  key: string
  label: string
  purpose: string
  icon: string | null
  layer: string | null
  modes: string[]
  target_schema: Record<string, unknown>
  params_schema: { properties?: Record<string, { default?: unknown; minimum?: number; maximum?: number; type?: string; enum?: unknown[] }> }
}

export interface Catalog {
  diagnostics: CatalogAction[]
  repairs: CatalogAction[]
  targets: {
    hosts: string[]
    devices: string[]
    interfaces: string[]
    trace_interfaces: string[]
    optic_interfaces: string[]
    access_ports: string[]
    locations: string[]
    patch_cables: string[]
    vlans: number[]
    intended_mtu: Record<string, number | null>
  }
  diagnosis_categories: Record<string, string>
}

export interface OpticalObservation {
  id: number
  interface_id: string
  evidence_id: string | null
  investigation_id: string | null
  source_mode: SourceMode
  observed_at: string
  sim_time_ms: number | null
  tx_power_dbm: number | null
  rx_power_dbm: number | null
  temperature_c: number | null
  voltage_v: number | null
  bias_ma: number | null
  flags: Record<string, unknown>
}

export interface Profile {
  name: string
  target_role: string
  summary: string
  links: { label: string; url: string }[]
  updated_at?: string
}

export interface LabStatus {
  enabled: boolean
  available: boolean
  reason: string | null
  runner_url: string
  token_configured: boolean
  runner?: Record<string, unknown>
}
