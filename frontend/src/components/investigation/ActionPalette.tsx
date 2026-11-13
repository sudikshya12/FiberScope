import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'motion/react'
import { Activity, Cable, ChevronRight, Filter, Gauge, Layers, Network, Play, Plug, Radar, Route, Ruler, ScanEye, Sun, Terminal } from 'lucide-react'
import type { Catalog, CatalogAction, Evidence, Investigation } from '../../lib/types'
import { api } from '../../lib/api'
import { useInvMutation } from '../../lib/hooks'
import { Badge, Button, InlineError } from '../ui'
import type { Selection } from '../topology/TopologyCanvas'

export const ACTION_ICON: Record<string, typeof Radar> = { radar: Radar, plug: Plug, gauge: Gauge, layers: Layers, network: Network, route: Route, activity: Activity, ruler: Ruler, sun: Sun, cable: Cable, filter: Filter, 'scan-eye': ScanEye }

type Target = Record<string, string>
type Params = Record<string, unknown>

export function targetKeys(a: CatalogAction): string[] {
  const props = (a.target_schema as { properties?: Record<string, unknown> }).properties ?? {}
  return Object.keys(props)
}

export function optionsFor(cat: Catalog, action: string, key: string): string[] {
  if (key === 'src' || key === 'dst') return cat.targets.hosts
  if (key === 'device') return cat.targets.devices
  if (key === 'location') return cat.targets.locations
  if (key === 'interface') {
    if (action === 'optical_telemetry') return cat.targets.optic_interfaces
    if (action === 'cable_trace') return cat.targets.trace_interfaces
    return cat.targets.interfaces
  }
  return []
}

export function defaultTarget(cat: Catalog, a: CatalogAction, sel: Selection, focus: { src: string; dst: string } | null): Target {
  const t: Target = {}
  for (const k of targetKeys(a)) {
    const opts = optionsFor(cat, a.key, k)
    if (k === 'src') t.src = focus?.src ?? 'srv-a'
    else if (k === 'dst') t.dst = focus?.dst ?? 'srv-b'
    else if (k === 'interface') t.interface = sel?.kind === 'interface' && opts.includes(sel.id) ? sel.id : opts.find((o) => o.startsWith('asw-1:Ethernet1/1')) ?? opts[0]
    else if (k === 'device') t.device = sel?.kind === 'device' && opts.includes(sel.id) ? sel.id : sel?.kind === 'interface' && opts.includes(sel.id.split(':')[0]) ? sel.id.split(':')[0] : opts[0]
    else if (k === 'location') t.location = sel?.kind === 'interface' && opts.includes(sel.id) ? sel.id : opts[0]
  }
  return t
}

export function defaultParams(a: CatalogAction): Params {
  const props = a.params_schema.properties ?? {}
  return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.default]))
}

const LAYER_ORDER = ['L1', 'L1 (physical)', 'L1 (records)', 'L1/L2', 'L2', 'L2/L3', 'L3', 'L4', 'Lab control']

export function ParamFields({ action, params, setParams }: { action: CatalogAction; params: Params; setParams: (p: Params) => void }) {
  const props = action.params_schema.properties ?? {}
  if (!Object.keys(props).length) return null
  return (
    <div className="grid grid-cols-2 gap-2">
      {Object.entries(props).map(([k, spec]) => {
        const id = `p-${action.key}-${k}`
        const label = k.replace(/_/g, ' ')
        if (spec.type === 'boolean')
          return (
            <label key={k} htmlFor={id} className="col-span-2 flex items-center gap-2 text-[12.5px] text-ink">
              <input id={id} type="checkbox" className="size-4 accent-[#6941C6]" checked={!!params[k]} onChange={(e) => setParams({ ...params, [k]: e.target.checked })} />
              {k === 'dont_fragment' ? "Don't fragment (DF)" : label}
            </label>
          )
        if (k === 'ip_version')
          return (
            <div key={k}>
              <label htmlFor={id} className="label">IP version</label>
              <select id={id} className="field h-8 py-0 font-mono text-[12.5px]" value={String(params[k])} onChange={(e) => setParams({ ...params, [k]: Number(e.target.value) })}>
                <option value="4">IPv4</option>
                <option value="6">IPv6</option>
              </select>
            </div>
          )
        if (k === 'payload_sizes')
          return (
            <div key={k} className="col-span-2">
              <label htmlFor={id} className="label">Payload sizes (bytes, comma-separated, ≤6)</label>
              <input
                id={id}
                className="field h-8 font-mono text-[12.5px]"
                defaultValue={((params[k] as number[]) ?? []).join(', ')}
                onChange={(e) => setParams({ ...params, [k]: e.target.value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)) })}
              />
            </div>
          )
        return (
          <div key={k}>
            <label htmlFor={id} className="label capitalize">
              {label}
              {spec.maximum != null && <span className="ml-1 font-mono text-faint">≤{spec.maximum}</span>}
            </label>
            <input id={id} type="number" min={spec.minimum} max={spec.maximum} className="field h-8 font-mono text-[12.5px]" value={String(params[k] ?? '')} onChange={(e) => setParams({ ...params, [k]: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </div>
        )
      })}
    </div>
  )
}

export function TargetFields({ cat, action, target, setTarget }: { cat: Catalog; action: CatalogAction; target: Target; setTarget: (t: Target) => void }) {
  const keys = targetKeys(action)
  return (
    <div className={clsx('grid gap-2', keys.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
      {keys.map((k) => {
        const opts = optionsFor(cat, action.key, k)
        const id = `t-${action.key}-${k}`
        return (
          <div key={k}>
            <label htmlFor={id} className="label capitalize">
              {k === 'src' ? 'Source' : k === 'dst' ? 'Destination' : k}
            </label>
            <select id={id} className="field h-8 py-0 font-mono text-[12.5px]" value={target[k] ?? ''} onChange={(e) => setTarget({ ...target, [k]: e.target.value })}>
              {opts.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        )
      })}
    </div>
  )
}

export function ActionPalette({ inv, cat, selection, onEvidence, disabledReason }: { inv: Investigation; cat: Catalog; selection: Selection; onEvidence: (e: Evidence) => void; disabledReason?: string | null }) {
  const mode = inv.execution.source_mode
  const actions = useMemo(
    () => cat.diagnostics.filter((a) => a.modes.includes(mode)).sort((a, b) => LAYER_ORDER.indexOf(a.layer ?? '') - LAYER_ORDER.indexOf(b.layer ?? '')),
    [cat, mode],
  )
  const [active, setActive] = useState<string | null>(null)
  const [target, setTarget] = useState<Target>({})
  const [params, setParams] = useState<Params>({})
  const act = actions.find((a) => a.key === active)
  useEffect(() => {
    if (act) {
      setTarget(defaultTarget(cat, act, selection, inv.focus))
      setParams(defaultParams(act))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
  useEffect(() => {
    if (!act) return
    if (selection?.kind === 'interface' && targetKeys(act).includes('interface') && optionsFor(cat, act.key, 'interface').includes(selection.id)) setTarget((t) => ({ ...t, interface: selection.id }))
    if (selection?.kind === 'device' && targetKeys(act).includes('device') && cat.targets.devices.includes(selection.id)) setTarget((t) => ({ ...t, device: selection.id }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])
  const run = useInvMutation(inv.id, async (_: void) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined))
    const r = await api.diagnostic(inv.id, act!.key, target, clean)
    onEvidence(r.evidence)
    return r
  })

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2 rounded-lg border border-line bg-canvas/70 px-2.5 py-2 text-[11.5px] leading-relaxed text-muted">
        <Terminal className="mt-0.5 size-3.5 shrink-0 text-faint" aria-hidden />
        <span>
          Structured, allowlisted actions only — no free-form terminal. Each run records evidence with its equivalent command, parameters and source.
        </span>
      </div>
      {disabledReason && <div className="rounded-lg border border-warn/30 bg-warn-soft px-2.5 py-2 text-[12px] text-warn">{disabledReason}</div>}
      <ul className="space-y-1">
        {actions.map((a) => {
          const Icon = ACTION_ICON[a.icon ?? ''] ?? Activity
          const open = a.key === active
          return (
            <li key={a.key} className={clsx('overflow-hidden rounded-lg border transition-colors', open ? 'border-accent/40 bg-white shadow-[var(--shadow-panel)]' : 'border-transparent hover:border-line hover:bg-white')}>
              <button type="button" onClick={() => setActive(open ? null : a.key)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left">
                <span className={clsx('grid size-7 shrink-0 place-items-center rounded-md transition-colors', open ? 'bg-accent text-white' : 'bg-canvas text-muted')}>
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{a.label}</span>
                </span>
                <Badge tone="outline" className="font-mono">{a.layer}</Badge>
                <ChevronRight className={clsx('size-3.5 text-faint transition-transform', open && 'rotate-90')} aria-hidden />
              </button>
              <AnimatePresence initial={false}>
                {open && act && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
                    <form
                      className="space-y-2.5 border-t border-line-2 px-2.5 pb-3 pt-2.5"
                      onSubmit={(e) => {
                        e.preventDefault()
                        run.mutate()
                      }}
                    >
                      <p className="text-[12px] leading-relaxed text-muted">{a.purpose}</p>
                      <TargetFields cat={cat} action={a} target={target} setTarget={setTarget} />
                      <ParamFields action={a} params={params} setParams={setParams} />
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10.5px] text-faint">{mode === 'SIMULATED' ? 'Output will be labeled SIMULATED' : 'Runs on owned lab resources'}</span>
                        <Button type="submit" variant="primary" size="sm" loading={run.isPending} disabled={!!disabledReason} icon={<Play className="size-3.5" aria-hidden />}>
                          Run
                        </Button>
                      </div>
                      <InlineError error={run.error} />
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
