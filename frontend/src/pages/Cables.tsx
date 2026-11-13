import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import clsx from 'clsx'
import { AlertTriangle, ArrowRight, Cable as CableIcon, CheckCircle2, Info, MousePointerClick, Plus, Printer, Search, SearchX, Unplug, X, XCircle } from 'lucide-react'
import { Page } from '../components/AppShell'
import { Button, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { useTopology } from '../lib/hooks'
import { CableDetail } from '../components/cables/CableDetail'
import { AddCableDialog } from '../components/cables/AddCableDialog'
import { PrintLabels } from '../components/cables/PrintLabels'
import { LabelBadge, ProvenanceBadge } from '../components/cables/badges'
import { MEDIA_LABEL, OPERATOR_SOURCE, fmtLen, splitEp } from '../components/cables/model'

type Audit = { severity: string; code: string; message: string; cable_id: string | null; interface_id: string | null }

const AUDIT_META: Record<string, { title: string; hint: string }> = {
  label_missing: { title: 'Label missing', hint: 'Re-label before any move/add/change work — an unlabeled cord is the classic wrong-port pull.' },
  label_mismatch: { title: 'Label mismatch', hint: 'Physical label disagrees with records. Verify by tracing before trusting either.' },
  open_end: { title: 'Open end', hint: 'One endpoint is unrecorded. The path is not inferred past this point.' },
  unpatched_front: { title: 'Unpatched front port', hint: 'Rear is trunked but nothing is patched on the front — spare capacity, not a fault.' },
}

const SEV_STYLE = {
  error: { icon: XCircle, icon_cls: 'text-crit', title: 'text-crit' },
  warning: { icon: AlertTriangle, icon_cls: 'text-warn', title: 'text-warn' },
  info: { icon: Info, icon_cls: 'text-faint', title: 'text-ink' },
} as const
const sevOf = (s: string) => SEV_STYLE[(s as keyof typeof SEV_STYLE) in SEV_STYLE ? (s as keyof typeof SEV_STYLE) : 'info']

function AuditStrip({ audit, onSelect }: { audit: Audit[]; onSelect: (id: string) => void }) {
  const order = { error: 0, warning: 1, info: 2 } as Record<string, number>
  const sorted = [...audit].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3))
  const attention = audit.filter((a) => a.severity !== 'info').length
  return (
    <section aria-labelledby="audit-h" className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 id="audit-h" className="eyebrow">
          Inventory audit
        </h2>
        <span className="text-[12px] text-muted">
          {attention ? `${attention} need${attention === 1 ? 's' : ''} attention` : 'No label or endpoint problems'} · {audit.length} finding{audit.length === 1 ? '' : 's'} from recorded fields
        </span>
      </div>
      {sorted.length === 0 ? (
        <div className="flex items-center gap-2 border-y border-line py-2.5 text-[13px] text-ok">
          <CheckCircle2 className="size-4" aria-hidden /> All cables labeled; no open ends recorded.
        </div>
      ) : (
        <ul className="divide-y divide-line-2 border-y border-line">
          {sorted.map((a) => {
            const s = sevOf(a.severity)
            const meta = AUDIT_META[a.code]
            const Icon = s.icon
            const body = (
              <>
                <Icon className={clsx('mt-0.5 size-4 shrink-0', s.icon_cls)} aria-hidden />
                <div className="min-w-0 flex-1 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-4">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className={clsx('text-[13px] font-semibold', s.title)}>{meta?.title ?? a.code}</span>
                    <span className="font-mono text-[10.5px] uppercase text-faint">{a.severity}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink">{a.message}</div>
                    {meta && <div className="mt-0.5 text-[12px] leading-snug text-muted">{meta.hint}</div>}
                  </div>
                </div>
                {a.cable_id && <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />}
              </>
            )
            return (
              <li key={a.code + (a.cable_id ?? a.interface_id)}>
                {a.cable_id ? (
                  <button onClick={() => onSelect(a.cable_id!)} className="group flex w-full items-start gap-2.5 px-1 py-2.5 text-left transition-colors hover:bg-panel" aria-label={`${meta?.title ?? a.code}: ${a.message} — open ${a.cable_id}`}>
                    {body}
                  </button>
                ) : (
                  <div className="flex items-start gap-2.5 px-1 py-2.5">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v)
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms)
    return () => clearTimeout(t)
  }, [v, ms])
  return d
}

function Ep({ id }: { id: string | null }) {
  const ep = splitEp(id)
  if (!ep) return <span className="text-[12.5px] font-medium text-crit">not recorded</span>
  return (
    <span className="block min-w-0">
      <span className="block text-[11.5px] text-muted">{ep.dev}</span>
      <span className="block truncate font-mono text-[12.5px] font-medium text-ink">{ep.port}</span>
    </span>
  )
}

function Check({ checked, onChange, label, indeterminate }: { checked: boolean; onChange: (v: boolean) => void; label: string; indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      className="size-4 cursor-pointer rounded border-line accent-[var(--color-accent)]"
    />
  )
}

export default function Cables() {
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('id')
  const [q, setQ] = useState('')
  const [dev, setDev] = useState(() => params.get('device') ?? '')
  const dq = useDebounced(q.trim(), 250)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [printing, setPrinting] = useState(false)
  const detailRef = useRef<HTMLDivElement>(null)

  const topo = useTopology()
  const all = useQuery({ queryKey: ['cables', '', ''], queryFn: () => api.cables() })
  const list = useQuery({ queryKey: ['cables', dq, dev], queryFn: () => api.cables(dq || undefined, dev || undefined), placeholderData: keepPreviousData })
  const rows = list.data?.cables ?? []
  const filtering = !!(dq || dev)
  const selected = all.data?.cables.find((c) => c.id === selectedId) ?? null

  const select = (id: string | null) => {
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (id) n.set('id', id)
        else n.delete('id')
        return n
      },
      { replace: true },
    )
    if (id && window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }

  // Scroll a QR-linked record into view on mobile on first load.
  const scrolled = useRef(false)
  useEffect(() => {
    if (selected && !scrolled.current) {
      scrolled.current = true
      if (window.matchMedia('(max-width: 1023px)').matches) detailRef.current?.scrollIntoView({ block: 'start' })
    }
  }, [selected])

  const togglePick = (id: string, v: boolean) =>
    setPicked((s) => {
      const n = new Set(s)
      if (v) n.add(id)
      else n.delete(id)
      return n
    })
  const allVisiblePicked = rows.length > 0 && rows.every((r) => picked.has(r.id))
  const someVisiblePicked = rows.some((r) => picked.has(r.id))
  const toPrint = (all.data?.cables ?? []).filter((c) => picked.has(c.id))

  const devices = useMemo(() => (topo.data?.devices ?? []).slice().sort((a, b) => a.id.localeCompare(b.id)), [topo.data])
  const audit = all.data?.audit ?? []
  const operatorCount = (all.data?.cables ?? []).filter((c) => c.source === OPERATOR_SOURCE).length

  return (
    <Page wide>
      <div className="no-print">
        <PageHeader
          title="Cable registry"
          description="Documented cables, endpoints and patch-panel paths — shown as recorded, never inferred."
          actions={
            <>
              <Button icon={<Printer className="size-4" />} disabled={!picked.size} onClick={() => setPrinting(true)}>
                Print labels{picked.size ? ` (${picked.size})` : ''}
              </Button>
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
                Add cable record
              </Button>
            </>
          }
        />

        {/* provenance line */}
        <p className="-mt-3 mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
          <span>
            <span className="font-medium text-ink">Source:</span> documented inventory (seed fixture){operatorCount ? ` + ${operatorCount} operator-entered record${operatorCount === 1 ? '' : 's'}` : ''}
          </span>
          <span className="text-faint" aria-hidden>
            ·
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Unplug className="size-3.5 text-faint" aria-hidden />
            PP-01, PP-02 and TRK-0102 are modeled — passive, no telemetry
          </span>
          {all.data && (
            <>
              <span className="text-faint" aria-hidden>
                ·
              </span>
              <span className="tnum">{all.data.total} records</span>
            </>
          )}
        </p>

        {all.isError ? (
          <ErrorState error={all.error} onRetry={() => all.refetch()} />
        ) : (
          <>
            {all.isLoading ? <Skeleton className="mb-6 h-20 w-full" /> : <AuditStrip audit={audit} onSelect={(id) => select(id)} />}

            <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_440px]">
              {/* ---------------------------------------------------------------- list */}
              <section aria-label="Cable records" className="min-w-0">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
                    <label htmlFor="cable-q" className="sr-only">
                      Search cables
                    </label>
                    <input id="cable-q" type="search" className="field pl-9 pr-8" placeholder="Search ID, endpoint, fiber type, connector, trunk…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
                    {q && (
                      <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-ink" aria-label="Clear search">
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="cable-dev" className="sr-only">
                      Endpoint device
                    </label>
                    <select id="cable-dev" className="field w-full sm:w-52" value={dev} onChange={(e) => setDev(e.target.value)}>
                      <option value="">All endpoint devices</option>
                      {devices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.id} — {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mb-2 flex min-h-5 items-center justify-between gap-2 px-0.5 text-[12px] text-muted">
                  <span className="tnum" aria-live="polite">
                    {list.isFetching && !list.isLoading ? 'Searching…' : `${rows.length} of ${all.data?.total ?? '—'} cables${filtering ? ' match' : ''}`}
                  </span>
                  {picked.size > 0 && (
                    <button className="font-medium text-accent-strong hover:underline" onClick={() => setPicked(new Set())}>
                      Clear {picked.size} selected for labels
                    </button>
                  )}
                </div>

                {list.isLoading ? (
                  <div className="panel space-y-3 p-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-9 w-full" />
                    ))}
                  </div>
                ) : list.isError ? (
                  <ErrorState error={list.error} onRetry={() => list.refetch()} />
                ) : rows.length === 0 ? (
                  <div className="panel">
                    <EmptyState
                      icon={<SearchX className="size-5" />}
                      title="No cables match"
                      action={
                        <Button
                          size="sm"
                          onClick={() => {
                            setQ('')
                            setDev('')
                          }}
                        >
                          Clear filters
                        </Button>
                      }
                    >
                      Search covers cable ID, endpoints, fiber type, connector and trunk.
                    </EmptyState>
                  </div>
                ) : (
                  <>
                    {/* desktop / tablet table */}
                    <div className={clsx('panel hidden overflow-hidden md:block', list.isFetching && 'opacity-80 transition-opacity')}>
                      <div className="scroll-thin max-h-[min(640px,calc(100dvh-220px))] overflow-auto">
                        <table className="w-full border-separate border-spacing-0 text-left text-[13px]">
                          <caption className="sr-only">Cable records — select a row to see the full record and documented path</caption>
                          <thead className="sticky top-0 z-10 bg-stage">
                            <tr className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                              <th scope="col" className="w-10 border-b border-line py-2.5 pl-4 pr-1">
                                <Check
                                  checked={allVisiblePicked}
                                  indeterminate={!allVisiblePicked && someVisiblePicked}
                                  onChange={(v) => setPicked((s) => { const n = new Set(s); rows.forEach((r) => (v ? n.add(r.id) : n.delete(r.id))); return n })}
                                  label="Select all visible cables for label printing"
                                />
                              </th>
                              <th scope="col" className="border-b border-line px-3 py-2.5">Cable</th>
                              <th scope="col" className="border-b border-line px-3 py-2.5">End A</th>
                              <th scope="col" className="border-b border-line px-3 py-2.5">End B</th>
                              <th scope="col" className="border-b border-line px-3 py-2.5">Media</th>
                              <th scope="col" className="border-b border-line px-3 py-2.5 text-right">Length</th>
                              <th scope="col" className="border-b border-line px-3 py-2.5 pr-4">Label</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((c) => {
                              const sel = c.id === selectedId
                              return (
                                <tr
                                  key={c.id}
                                  onClick={() => select(sel ? null : c.id)}
                                  aria-selected={sel}
                                  className={clsx('group cursor-pointer transition-colors', sel ? 'bg-accent-soft' : 'hover:bg-stage')}
                                >
                                  <td className={clsx('relative border-b border-line-2 py-2.5 pl-4 pr-1 align-middle')}>
                                    {sel && <span className="absolute inset-y-0 left-0 w-[3px] bg-accent" aria-hidden />}
                                    <Check checked={picked.has(c.id)} onChange={(v) => togglePick(c.id, v)} label={`Select ${c.id} for label printing`} />
                                  </td>
                                  <th scope="row" className="border-b border-line-2 px-3 py-2.5 text-left align-middle font-normal">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        select(sel ? null : c.id)
                                      }}
                                      aria-pressed={sel}
                                      className="block text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                                    >
                                      <span className={clsx('block font-mono text-[13px] font-semibold', sel ? 'text-accent-strong' : 'text-ink')}>{c.id}</span>
                                      {(c.source === OPERATOR_SOURCE || c.trunk_id) && (
                                        <span className="mt-0.5 flex items-center gap-1.5">
                                          {c.source === OPERATOR_SOURCE && <ProvenanceBadge source={c.source} short className="!px-1 !py-0 !text-[10px]" />}
                                          {c.trunk_id && <span className="font-mono text-[10.5px] text-faint">{c.trunk_id}</span>}
                                        </span>
                                      )}
                                    </button>
                                  </th>
                                  <td className="max-w-[180px] border-b border-line-2 px-3 py-2.5 align-middle">
                                    <Ep id={c.a} />
                                  </td>
                                  <td className="max-w-[180px] border-b border-line-2 px-3 py-2.5 align-middle">
                                    <Ep id={c.b} />
                                  </td>
                                  <td className="border-b border-line-2 px-3 py-2.5 align-middle">
                                    <span className="block text-[12.5px] font-medium text-ink">{MEDIA_LABEL[c.media] ?? c.media}</span>
                                    <span className="block max-w-[180px] truncate text-[11.5px] text-muted" title={c.fiber_type ?? c.connector_a}>
                                      {c.fiber_type ? c.fiber_type.replace(' 50/125 µm', '').replace(' 9/125 µm', '') : c.connector_a}
                                    </span>
                                  </td>
                                  <td className="tnum border-b border-line-2 px-3 py-2.5 text-right align-middle font-mono text-[12.5px]">
                                    {fmtLen(c.nominal_length_m) ?? <span className="font-sans italic text-faint">unknown</span>}
                                  </td>
                                  <td className="border-b border-line-2 px-3 py-2.5 pr-4 align-middle">
                                    <LabelBadge status={c.label_status} />
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* mobile cards */}
                    <ul className="panel divide-y divide-line-2 overflow-hidden md:hidden" aria-label="Cable records">
                      {rows.map((c) => {
                        const sel = c.id === selectedId
                        const len = fmtLen(c.nominal_length_m)
                        return (
                          <li key={c.id}>
                            <div className={clsx('relative flex gap-3 p-3 transition-colors', sel && 'bg-accent-soft')}>
                              {sel && <span className="absolute inset-y-0 left-0 w-[3px] bg-accent" aria-hidden />}
                              <div className="pt-0.5">
                                <Check checked={picked.has(c.id)} onChange={(v) => togglePick(c.id, v)} label={`Select ${c.id} for label printing`} />
                              </div>
                              <button onClick={() => select(sel ? null : c.id)} aria-pressed={sel} className="min-w-0 flex-1 text-left">
                                <div className="flex items-center justify-between gap-2">
                                  <span className={clsx('font-mono text-[14px] font-semibold', sel ? 'text-accent-strong' : 'text-ink')}>{c.id}</span>
                                  <LabelBadge status={c.label_status} />
                                </div>
                                <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                                  <Ep id={c.a} />
                                  <ArrowRight className="size-3.5 text-faint" aria-hidden />
                                  <Ep id={c.b} />
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
                                  <span className="font-medium text-ink">{MEDIA_LABEL[c.media] ?? c.media}</span>
                                  {c.fiber_type && <span>· {c.fiber_type.split(' ')[0]}</span>}
                                  <span>· {len ?? 'length unknown'}</span>
                                  {c.source === OPERATOR_SOURCE && <ProvenanceBadge source={c.source} short className="ml-auto !px-1 !py-0 !text-[10px]" />}
                                </div>
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}
              </section>

              {/* ---------------------------------------------------------------- detail */}
              <div ref={detailRef} className="min-w-0 scroll-mt-4 lg:sticky lg:top-6">
                <AnimatePresence mode="wait" initial={false}>
                  {selected ? (
                    <CableDetail key={selected.id} cable={selected} onClose={() => select(null)} onDeleted={() => select(null)} />
                  ) : selectedId && !all.isLoading ? (
                    <motion.div key="missing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="panel">
                      <EmptyState icon={<CableIcon className="size-5" />} title={`No record for ${selectedId}`} action={<Button size="sm" onClick={() => select(null)}>Clear selection</Button>}>
                        This cable ID is not in the registry. It may have been an operator-entered record that was deleted.
                      </EmptyState>
                    </motion.div>
                  ) : (
                    <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hidden rounded-lg border border-dashed border-line lg:block">
                      <EmptyState icon={<MousePointerClick className="size-5" />} title="Select a cable">
                        Its record and documented end-to-end path appear here.
                      </EmptyState>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </>
        )}
      </div>

      <AddCableDialog open={adding} onOpenChange={setAdding} onCreated={(id) => select(id)} />
      <AnimatePresence>{printing && <PrintLabels cables={toPrint} onClose={() => setPrinting(false)} />}</AnimatePresence>
    </Page>
  )
}
