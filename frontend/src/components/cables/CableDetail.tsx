import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import clsx from 'clsx'
import { ArrowDown, Lock, Route, Trash2, X } from 'lucide-react'
import { api } from '../../lib/api'
import { qk, useTopology } from '../../lib/hooks'
import type { Cable } from '../../lib/types'
import { Button, Dialog, ErrorState, InlineError, LoadingBlock, Tip } from '../ui'
import { PathChain, PathSummary } from './PathChain'
import { LabelBadge, ProvenanceBadge } from './badges'
import { KIND_LABEL, MEDIA_LABEL, fmtLen, isOperator, splitEp, traceStartsFor } from './model'

function Endpoint({ side, id, connector }: { side: 'A' | 'B'; id: string | null; connector: string }) {
  const ep = splitEp(id)
  return (
    <div className="min-w-0 flex-1 rounded-md border border-line-2 bg-stage px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="grid size-5 place-items-center rounded bg-nav font-mono text-[10.5px] font-bold text-white">{side}</span>
        <span className="truncate text-[11px] text-faint" title={connector}>
          {connector || 'connector not recorded'}
        </span>
      </div>
      {ep ? (
        <div className="mt-1.5">
          <Link to={`/devices/${ep.dev}`} className="text-[12.5px] font-medium text-muted hover:text-accent-strong hover:underline underline-offset-2">
            {ep.dev}
          </Link>
          <div className="break-all font-mono text-[13.5px] font-semibold text-ink">{ep.port}</div>
        </div>
      ) : (
        <div className="mt-1.5 text-[13px] font-medium text-crit">Not recorded</div>
      )}
    </div>
  )
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-line-2 py-2 text-[13px] last:border-0">
      <dt className="text-muted">{k}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  )
}

const Unknown = ({ children = 'Unknown — not recorded' }: { children?: ReactNode }) => <span className="italic text-faint">{children}</span>

function TraceOne({ cable, start, label, index }: { cable: Cable; start: string; label?: string; index: number }) {
  const trace = useQuery({ queryKey: ['trace', start], queryFn: () => api.trace(start) })
  const mappings = trace.data?.hops.filter((h) => h.kind === 'patch_mapping') ?? []
  if (trace.isLoading) return <LoadingBlock rows={4} label="Tracing documented path…" />
  if (trace.isError) return <ErrorState error={trace.error} onRetry={() => trace.refetch()} />
  if (!trace.data) return null
  return (
    <div className="min-w-0">
      <div className="mb-3">
        {label && <div className="mb-1 flex items-baseline justify-between gap-2"><span className="eyebrow text-[10px]">{label}</span><span className="truncate font-mono text-[11px] text-faint">from {start}</span></div>}
        <PathSummary path={trace.data} />
      </div>
      <PathChain key={`${cable.id}-${start}`} path={trace.data} orientation="vertical" highlight={cable.id} linkCables delay={0.1 + index * 0.4} />
      <div className="mt-3 border-t border-line-2 pt-2.5">
        <div className="eyebrow mb-1 text-[10px]">Intermediate patch mappings</div>
        {mappings.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {mappings.map((m) => (
              <li key={m.id} className="rounded border border-dashed border-[#cfcad6] bg-stage px-1.5 py-0.5 font-mono text-[11.5px] text-ink">
                {m.label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-muted">None on this path.</p>
        )}
      </div>
    </div>
  )
}

function TraceSection({ cable }: { cable: Cable }) {
  const topo = useTopology()
  const starts = topo.isLoading ? [] : traceStartsFor(cable, topo.data)
  return (
    <section aria-labelledby="trace-h" className="mt-5 border-t border-line-2 pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="trace-h" className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Route className="size-4 text-faint" aria-hidden /> Trace path
        </h3>
        {starts.length === 1 && <span className="truncate font-mono text-[11px] text-faint">from {starts[0]}</span>}
      </div>
      {topo.isLoading ? (
        <LoadingBlock rows={4} label="Loading topology…" />
      ) : starts.length === 0 ? (
        <p className="text-[13px] text-muted">No endpoints recorded — nothing to trace.</p>
      ) : (
        <div className="space-y-4">
          {starts.length > 1 && <p className="text-[12px] leading-relaxed text-muted">Both ends terminate on passive panels and no documented link uses this cable, so it is traced in each direction.</p>}
          {starts.map((s, n) => (
            <TraceOne key={s} cable={cable} start={s} index={n} label={starts.length > 1 ? (n === 0 ? 'Toward end B' : 'Toward end A') : undefined} />
          ))}
          <p className="text-[11.5px] leading-relaxed text-faint">Patch panels and trunk TRK-0102 are modeled; mappings come from inventory records, not a physical inspection.</p>
        </div>
      )}
    </section>
  )
}

export function CableDetail({ cable, onClose, onDeleted }: { cable: Cable; onClose: () => void; onDeleted: () => void }) {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const del = useMutation({
    mutationFn: () => api.deleteCable(cable.id),
    onSuccess: () => {
      setConfirm(false)
      qc.invalidateQueries({ queryKey: ['cables'] })
      qc.invalidateQueries({ queryKey: qk.topology })
      qc.invalidateQueries({ queryKey: ['trace'] })
      onDeleted()
    },
  })
  const op = isOperator(cable)
  const len = fmtLen(cable.nominal_length_m)
  return (
    <motion.article
      key={cable.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      aria-labelledby="cable-detail-title"
      className="panel overflow-hidden"
    >
      <header className="relative border-b border-line-2 px-4 pb-3.5 pt-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow mb-1 text-[10.5px]">{KIND_LABEL[cable.kind] ?? cable.kind} · {MEDIA_LABEL[cable.media] ?? cable.media}</div>
            <h2 id="cable-detail-title" className="break-all font-mono text-[20px] font-semibold leading-tight tracking-tight text-ink">
              {cable.id}
            </h2>
          </div>
          <button onClick={onClose} className="-mr-1 rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink" aria-label="Close cable detail">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <LabelBadge status={cable.label_status} />
          <ProvenanceBadge source={cable.source} />
          {cable.is_modeled_only && (
            <Tip content="This record describes the modeled lab plant. No physical cable was inspected.">
              <span className="inline-flex cursor-help items-center rounded-md border border-line bg-white px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-muted">Modeled</span>
            </Tip>
          )}
        </div>
      </header>

      <div className="px-4 py-4">
        <div className="flex flex-col items-stretch gap-1.5 sm:flex-row">
          <Endpoint side="A" id={cable.a} connector={cable.connector_a} />
          <ArrowDown className="mx-auto size-3.5 shrink-0 self-center text-faint sm:-rotate-90" aria-hidden />
          <Endpoint side="B" id={cable.b} connector={cable.connector_b} />
        </div>

        <dl className="mt-4">
          <Row k="Media">{MEDIA_LABEL[cable.media] ?? cable.media}</Row>
          <Row k="Fiber type">{cable.fiber_type ?? <Unknown>{cable.media === 'fiber' ? 'Unknown — not recorded' : 'n/a (not fiber)'}</Unknown>}</Row>
          <Row k="Connectors">
            <span className="font-mono text-[12.5px]">A: {cable.connector_a || '—'}</span>
            <br />
            <span className="font-mono text-[12.5px]">B: {cable.connector_b || '—'}</span>
          </Row>
          <Row k="Nominal length">{len ? <span className="tnum">{len}</span> : <Unknown />}</Row>
          <Row k="Label status">
            {cable.label_status === 'labeled' ? 'Labeled at both ends' : cable.label_status === 'missing' ? <span className="text-warn">Label missing — re-label before work</span> : <span className="text-crit">Label does not match records</span>}
          </Row>
          {cable.trunk_id && (
            <Row k="Trunk">
              <span className="font-mono text-[12.5px]">{cable.trunk_id}</span> <span className="text-muted">(modeled)</span>
            </Row>
          )}
          <Row k="Install notes">{cable.notes ? cable.notes : <Unknown>No notes recorded</Unknown>}</Row>
          <Row k="Source">{cable.source ?? 'documented inventory (seed fixture)'}</Row>
        </dl>

        <TraceSection cable={cable} />

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-line-2 pt-4">
          {op ? (
            <>
              <span className="text-[12px] text-muted">Operator-entered — can be removed.</span>
              <Button variant="danger" size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirm(true)}>
                Delete record
              </Button>
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-[12px] text-muted">
              <Lock className="size-3.5 text-faint" aria-hidden /> Seeded inventory record — protected from deletion.
            </span>
          )}
        </div>
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm} title={`Delete ${cable.id}?`} description="This removes the operator-entered record and frees both endpoints. Seeded inventory is unaffected.">
        <InlineError error={del.error} />
        <div className={clsx('flex justify-end gap-2', del.error ? 'mt-4' : '')}>
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={del.isPending} icon={<Trash2 className="size-4" />} onClick={() => del.mutate()}>
            Delete record
          </Button>
        </div>
      </Dialog>
    </motion.article>
  )
}
