import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Info, Loader2, Plus, XCircle } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { qk, useTopology } from '../../lib/hooks'
import { Button, Dialog, InlineError } from '../ui'

type Issue = { severity: string; code: string; message: string }

const ID_RE = /^(CBL|TRK)-[A-Z0-9-]{2,20}$/

const EMPTY = {
  id: '',
  kind: 'patch',
  media: 'fiber',
  fiber_type: 'OM4 multimode 50/125 µm',
  connector_a: 'LC/UPC duplex',
  connector_b: 'LC/UPC duplex',
  nominal_length_m: '',
  label_status: 'labeled',
  endpoint_a: '',
  endpoint_b: '',
  notes: '',
}
type Form = typeof EMPTY

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v)
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms)
    return () => clearTimeout(t)
  }, [v, ms])
  return d
}

function toBody(f: Form) {
  const len = f.nominal_length_m.trim() === '' ? null : Number(f.nominal_length_m)
  return {
    id: f.id.trim(),
    kind: f.kind,
    media: f.media,
    fiber_type: f.media === 'fiber' && f.fiber_type.trim() ? f.fiber_type.trim() : null,
    connector_a: f.connector_a.trim(),
    connector_b: f.connector_b.trim(),
    nominal_length_m: len,
    label_status: f.label_status,
    endpoint_a: f.endpoint_a.trim(),
    endpoint_b: f.endpoint_b.trim() || null,
    notes: f.notes,
  }
}

function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11.5px] leading-snug text-faint">{hint}</p>}
    </div>
  )
}

const SEV = {
  error: { icon: XCircle, cls: 'border-crit/20 bg-crit-soft text-crit' },
  warning: { icon: AlertTriangle, cls: 'border-warn/20 bg-warn-soft text-warn' },
  info: { icon: Info, cls: 'border-line bg-canvas text-muted' },
} as const

export function AddCableDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title="Add cable record" description="Operator-entered record. Endpoints are checked for occupancy as you type.">
      {/* Mounted only while open, so the form resets each time. */}
      <AddCableForm onCancel={() => onOpenChange(false)} onCreated={(id) => { onOpenChange(false); onCreated(id) }} />
    </Dialog>
  )
}

function AddCableForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient()
  const topo = useTopology()
  const [f, setF] = useState<Form>(EMPTY)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))

  // Endpoint options: every non-management interface; occupied ones annotated.
  const occupied = useMemo(() => {
    const m = new Map<string, string>()
    topo.data?.cables.forEach((c) => {
      if (c.a) m.set(c.a, c.id)
      if (c.b) m.set(c.b, c.id)
    })
    return m
  }, [topo.data])
  const ifaces = topo.data?.interfaces ?? []

  // Local checks (the server schema would reject these before validating occupancy).
  const idTrim = f.id.trim()
  const lenNum = f.nominal_length_m.trim() === '' ? null : Number(f.nominal_length_m)
  const local: Issue[] = []
  if (idTrim && !ID_RE.test(idTrim)) local.push({ severity: 'error', code: 'id_format', message: 'Cable ID must look like CBL-F501 or TRK-0103-P1 (uppercase letters, digits, dashes).' })
  if (lenNum != null && (!Number.isFinite(lenNum) || lenNum <= 0 || lenNum > 10000)) local.push({ severity: 'error', code: 'length', message: 'Nominal length must be a positive number of metres (≤ 10 000), or blank if unknown.' })

  const body = toBody(f)
  const ready = ID_RE.test(idTrim) && body.endpoint_a !== '' && !local.length
  const bodyKey = ready ? JSON.stringify(body) : null
  const debounced = useDebounced(bodyKey, 350)
  const validation = useQuery({
    queryKey: ['cable-validate', debounced],
    queryFn: () => api.validateCable(JSON.parse(debounced!)),
    enabled: !!debounced,
    staleTime: 0,
    gcTime: 5_000,
    retry: 0,
  })
  const checking = validation.isFetching
  const current =
    bodyKey && debounced === bodyKey
      ? validation.data
        ? validation.data
        : validation.isError
          ? { valid: false, issues: [{ severity: 'error', code: 'request', message: validation.error instanceof Error ? validation.error.message : 'Validation failed' }] }
          : null
      : null
  const issues = [...local, ...(current?.issues ?? [])]
  const pending = ready && !current
  const canSubmit = ready && !!current?.valid && !checking

  const create = useMutation({
    mutationFn: () => api.createCable(body),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['cables'] })
      qc.invalidateQueries({ queryKey: qk.topology })
      qc.invalidateQueries({ queryKey: ['trace'] })
      onCreated(r.id)
    },
  })
  const createIssues = create.error instanceof ApiError && Array.isArray(create.error.details) ? (create.error.details as Issue[]).filter((d) => d && 'message' in d) : []

  return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) create.mutate()
        }}
        className="space-y-4"
        noValidate
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
          <Field label="Cable ID" htmlFor="c-id" hint="Format CBL-… or TRK-…">
            <input id="c-id" className="field font-mono" value={f.id} onChange={(e) => set('id', e.target.value.toUpperCase())} placeholder="CBL-F501" autoComplete="off" spellCheck={false} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind" htmlFor="c-kind">
              <select id="c-kind" className="field" value={f.kind} onChange={(e) => set('kind', e.target.value)}>
                <option value="patch">Patch cord</option>
                <option value="direct">Direct</option>
                <option value="trunk_pair">Trunk pair</option>
              </select>
            </Field>
            <Field label="Media" htmlFor="c-media">
              <select id="c-media" className="field" value={f.media} onChange={(e) => set('media', e.target.value)}>
                <option value="fiber">Fiber</option>
                <option value="copper">Copper</option>
                <option value="dac">DAC</option>
              </select>
            </Field>
          </div>

          <Field label="Fiber type" htmlFor="c-fiber" hint={f.media !== 'fiber' ? 'Not applicable to non-fiber media.' : undefined}>
            <input id="c-fiber" list="fiber-types" className="field" value={f.media === 'fiber' ? f.fiber_type : ''} disabled={f.media !== 'fiber'} onChange={(e) => set('fiber_type', e.target.value)} placeholder="e.g. OS2 single-mode 9/125 µm" />
            <datalist id="fiber-types">
              <option value="OM3 multimode 50/125 µm" />
              <option value="OM4 multimode 50/125 µm" />
              <option value="OS2 single-mode 9/125 µm" />
            </datalist>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nominal length (m)" htmlFor="c-len" hint="Leave blank if unknown.">
              <input id="c-len" type="number" inputMode="decimal" min={0} step="0.1" className="field tnum" value={f.nominal_length_m} onChange={(e) => set('nominal_length_m', e.target.value)} placeholder="unknown" />
            </Field>
            <Field label="Label status" htmlFor="c-label">
              <select id="c-label" className="field" value={f.label_status} onChange={(e) => set('label_status', e.target.value)}>
                <option value="labeled">Labeled</option>
                <option value="missing">Missing</option>
                <option value="mismatch">Mismatch</option>
              </select>
            </Field>
          </div>

          <Field label="Connector A" htmlFor="c-ca">
            <input id="c-ca" list="connectors" className="field" value={f.connector_a} onChange={(e) => set('connector_a', e.target.value)} />
          </Field>
          <Field label="Connector B" htmlFor="c-cb">
            <input id="c-cb" list="connectors" className="field" value={f.connector_b} onChange={(e) => set('connector_b', e.target.value)} />
          </Field>
          <datalist id="connectors">
            <option value="LC/UPC duplex" />
            <option value="LC/APC duplex" />
            <option value="SC/UPC" />
            <option value="MPO-12" />
            <option value="SFP28 DAC" />
            <option value="RJ45" />
          </datalist>
          <p className="-mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-muted sm:col-span-2">
            <Info className="mt-px size-3.5 shrink-0 text-faint" aria-hidden />
            Compatibility is not inferred from connector type. Connector fields are recorded as entered.
          </p>

          <Field label="Endpoint A" htmlFor="c-a" hint="Interface ID, e.g. pp-01:F03">
            <input id="c-a" list="iface-ids" className="field font-mono" value={f.endpoint_a} onChange={(e) => set('endpoint_a', e.target.value)} placeholder="device:port" autoComplete="off" spellCheck={false} required />
          </Field>
          <Field label="Endpoint B (optional)" htmlFor="c-b" hint="Blank records an open far end.">
            <input id="c-b" list="iface-ids" className="field font-mono" value={f.endpoint_b} onChange={(e) => set('endpoint_b', e.target.value)} placeholder="not recorded" autoComplete="off" spellCheck={false} />
          </Field>
          <datalist id="iface-ids">
            {ifaces.map((i) => (
              <option key={i.id} value={i.id}>
                {occupied.has(i.id) ? `in use · ${occupied.get(i.id)}` : i.kind === 'mgmt' ? 'mgmt port' : 'free'}
              </option>
            ))}
          </datalist>

          <Field label="Installation notes" htmlFor="c-notes" className="sm:col-span-2">
            <textarea id="c-notes" rows={2} className="field resize-y" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Routing, tray, who installed, anything a technician should know" maxLength={2000} />
          </Field>
        </div>

        {/* live validation */}
        <div aria-live="polite" className="min-h-[44px] rounded-lg border border-line-2 bg-stage p-2.5">
          <div className="mb-1.5 flex items-center justify-between px-0.5">
            <span className="eyebrow text-[10.5px]">Inventory validation</span>
            {(checking || pending) && (
              <span className="flex items-center gap-1 text-[11px] text-faint">
                <Loader2 className="size-3 animate-spin" aria-hidden /> checking…
              </span>
            )}
          </div>
          <ul className="space-y-1.5">
            <AnimatePresence initial={false} mode="popLayout">
              {!ready && !local.length && (
                <motion.li key="idle" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-0.5 text-[12.5px] text-muted">
                  Enter a cable ID and endpoint A to check occupancy.
                </motion.li>
              )}
              {issues.map((i) => {
                const s = SEV[(i.severity as keyof typeof SEV) in SEV ? (i.severity as keyof typeof SEV) : 'info']
                const Icon = s.icon
                return (
                  <motion.li
                    key={i.code + i.message}
                    layout
                    initial={{ opacity: 0, y: -4, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22 }}
                    className={clsx('flex items-start gap-2 overflow-hidden rounded-md border px-2.5 py-1.5 text-[12.5px]', s.cls)}
                  >
                    <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0">
                      <span className="mr-1.5 font-mono text-[10.5px] font-semibold uppercase opacity-80">{i.code}</span>
                      {i.message}
                    </span>
                  </motion.li>
                )
              })}
              {current?.valid && !local.length && !current.issues.length && (
                <motion.li key="ok" layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2 rounded-md border border-ok/20 bg-ok-soft px-2.5 py-1.5 text-[12.5px] text-ok">
                  <CheckCircle2 className="size-3.5" aria-hidden /> Endpoints are free and the ID is unique — record can be saved.
                </motion.li>
              )}
            </AnimatePresence>
          </ul>
        </div>

        {create.error && <InlineError error={create.error} />}
        {createIssues.length > 0 && (
          <ul className="space-y-1 text-[12.5px] text-crit">
            {createIssues.map((i) => (
              <li key={i.message}>· {i.message}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-line-2 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[11.5px] text-faint">Saved as “operator-entered record”. Removable later.</span>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!canSubmit} loading={create.isPending} icon={<Plus className="size-4" />}>
              Save record
            </Button>
          </div>
        </div>
      </form>
  )
}
